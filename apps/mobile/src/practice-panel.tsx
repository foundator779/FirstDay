import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Attempt, BeeSource, ChangeProposal, CreateAttemptResponse, CreatePracticeSetResponse, ExtractInstructionsResponse, InstructionCard, SourceConversation, SourceEvidence } from "@firstday/contracts";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import { SYNTHETIC_UPDATES, type PracticeClient } from "./synthetic-client";
import { Action, EvidenceNotes, Loading, TrainerQuestions, ui } from "./learner-panels";
import { practiceRecap } from "./practice-recap";
import { Portrait } from "./design-assets";
import { VoiceRehearsal } from "./voice-rehearsal";

type Props = { isVisible?: boolean; aiMode?: "offline" | "bedrock"; client: PracticeClient; extraction: ExtractInstructionsResponse; source: SourceConversation; onActiveChange(active: boolean): void; onStepChange?(): void; onExit(): void };
export const PracticeButton = Action;

export function PracticePanel({ client, extraction, source, onActiveChange, onStepChange, onExit, aiMode = "offline", isVisible = true }: Props) {
  const [practice, setPractice] = useState<CreatePracticeSetResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [feedback, setFeedback] = useState<CreateAttemptResponse | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showRecapEvidence, setShowRecapEvidence] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [update, setUpdate] = useState<BeeSource | null>(null);
  const updateImport = useRef<{ source: SourceConversation; extracted: boolean } | null>(null);
  const [comparison, setComparison] = useState<{ change: ChangeProposal; evidence: SourceEvidence[] } | null>(null);
  const [changePair, setChangePair] = useState<{ before: InstructionCard; after: InstructionCard } | null>(null);
  const [oldSetStale, setOldSetStale] = useState(false);
  const updateId = source.sourceKind === "fixture" ? SYNTHETIC_UPDATES[source.beeSourceId] : undefined;
  const confirmed = extraction.items.filter((item) => item.status === "confirmed");
  const scenario = practice?.scenarios[index];
  const complete = practice?.practiceSet.status === "complete";
  const currentRules = practice?.practiceSet.kind === "changeDrill" && changePair ? [changePair.after] : confirmed;
  const recap = practiceRecap(currentRules, attempts);

  async function run(label: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(null);
    try { await operation(); } catch { setError("This step couldn’t finish. Please try again."); }
    finally { lock.current = false; setBusy(null); }
  }
  async function start() {
    const created = await client.createPractice({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, instructionIds: confirmed.map((item) => item.id), title: "First shift practice" });
    setPractice(created); onActiveChange(true);
  }
  async function submit() {
    if (!practice || !scenario || !answer.trim() || voiceBusy) return;
    const response = await client.submitAttempt({ scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, responseText: answer.trim(), inputMode });
    setFeedback(response); setAttempts((values) => [...values, response.attempt]); setPractice({ ...practice, practiceSet: response.practiceSet });
  }
  async function compare() {
    if (!update) return;
    if (!updateImport.current) {
      const imported = await client.importConversation({ beeSourceId: update.id, sourceKind: update.sourceKind, sourceRevision: update.revision, consent: { confirmed: true } });
      updateImport.current = { source: imported.sourceConversation, extracted: false };
    }
    if (!updateImport.current.extracted) {
      await client.extractInstructions({ sourceConversationId: updateImport.current.source.id, sourceRevision: update.revision, excludedRanges: [] });
      updateImport.current.extracted = true;
    }
    const response = await client.compareSources({ sourceConversationId: source.id, newSourceConversationId: updateImport.current.source.id, previousInstructionRevision: extraction.instructionRevision });
    if (!response.changes[0]) throw new Error("No explicit changed rule found.");
    setComparison({ change: response.changes[0], evidence: response.sourceEvidence });
    onStepChange?.();
  }
  async function confirm() {
    if (!comparison) return;
    const response = await client.confirmChange({ changeId: comparison.change.id, sourceRevision: comparison.change.sourceRevision });
    setChangePair({ before: response.previousInstruction, after: response.replacementInstruction });
    setOldSetStale(response.stalePracticeSetIds.length > 0);
    setPractice({ ...response.changeDrill, sourceEvidence: response.sourceEvidence });
    setIndex(0); setAnswer(""); setFeedback(null); setComparison(null); setUpdate(null); setShowEvidence(false); setShowRecap(false);
    onStepChange?.();
  }
  function continuePractice() {
    if (feedback?.attempt.result === "covered") {
      if (complete) setShowRecap(true); else setIndex((value) => value + 1);
    }
    setFeedback(null); setAnswer(""); setShowEvidence(false);
    onStepChange?.();
  }
  if (!practice && confirmed.length !== 3) return null;
  const before = comparison ? confirmed.find((r) => r.id === comparison.change.previousInstructionId) : undefined;
  return <View style={ui.section}>
    {!practice && <View style={ui.paper}>
      <Text style={ui.label}>Try your first shift</Text>
      <Text style={ui.body}>Three situations. Space to get it wrong. A source-backed explanation after each answer.</Text>
      <Text style={ui.meta}>{aiMode === "bedrock" ? "Use your own words. AI checks the meaning against your confirmed training." : "Offline preview: use the action wording from the instruction. AI feedback is available in the Bedrock demo."}</Text>
      <Action label="Start practice · 3 situations" disabled={!!busy} onPress={() => void run("Preparing your situations…", start)} />
    </View>}
    {practice && !showRecap && scenario && <>
      <View style={styles.practiceTop}><Text style={ui.label}>{practice.practiceSet.kind === "changeDrill" ? "Change Drill" : "Your first shift"}</Text><Text style={ui.meta}>{index + 1} / {practice.scenarios.length}</Text></View>
      {oldSetStale && <View style={styles.changedNotice}><Text style={ui.label}>The earlier practice is out of date.</Text><Text style={ui.body}>This situation uses the new instruction you just confirmed.</Text></View>}
      <View style={styles.situation}>
        <View style={styles.characterRow}><Portrait person={scenario.characterId === "guide-maya" ? "maya" : "rowan"} size={44} /><View style={ui.flex}><Text style={styles.characterName}>{scenario.characterId === "guide-maya" ? "Maya · trainer" : "Rowan · practice partner"}</Text><Text style={styles.characterNote}>A situation to rehearse</Text></View></View>
        <View style={styles.message}><Text style={ui.inkBody}>{scenario.context}</Text><Text accessibilityRole="header" style={styles.prompt}>{scenario.prompt}</Text></View>
      </View>
      <View style={styles.composer}>
        <Text style={ui.blueLabel}>Your response</Text>
        {!feedback && <VoiceRehearsal key={scenario.id} active={isVisible && !busy} prompt={scenario.context + " " + scenario.prompt} onTranscript={(text) => { setAnswer(text); setInputMode("voice"); }} onBusy={setVoiceBusy} />}
        <Text style={ui.meta}>{inputMode === "voice" && answer ? "Your spoken answer · review before submitting" : "Or type your answer"}</Text>
        <TextInput accessibilityLabel="Your action" value={answer} onChangeText={(text) => { setAnswer(text); setInputMode("text"); }} multiline maxLength={4000} editable={!busy && !feedback && !voiceBusy} placeholder="I would…" placeholderTextColor={theme.colors.tertiaryInk} style={[ui.input, styles.answer]} />
      </View>
      {!feedback && <Action label="Check my answer" disabled={!!busy || voiceBusy || !answer.trim()} onPress={() => void run("Checking your answer against the training…", submit)} />}
      {feedback && <View accessibilityLiveRegion="polite" style={[styles.feedback, feedback.attempt.result === "covered" ? styles.covered : styles.retry]}>
        <Text style={ui.label}>{feedback.attempt.result === "covered" ? "✓ You’ve got this step." : feedback.attempt.result === "partial" ? "You have part of it." : feedback.attempt.result === "needsReview" ? "Let’s check the source." : "Try that step again."}</Text>
        <Text style={ui.inkBody}>{feedback.attempt.feedback}</Text>
        <EvidenceNotes items={feedback.sourceEvidence} />
        <Action label={feedback.attempt.result === "covered" ? complete ? "See my practice recap" : "Next situation →" : "Try again in my own words"} onPress={continuePractice} />
      </View>}
      {!feedback && <><Action secondary label={showEvidence ? "Hide the training note" : "Need a reminder? View the source"} onPress={() => setShowEvidence(!showEvidence)} />{showEvidence && <EvidenceNotes items={practice.sourceEvidence.filter((e) => scenario.sourceEvidence.includes(e.id))} />}</>}
    </>}
    {practice && showRecap && !update && <>
      <View style={ui.gap}><Text accessibilityRole="header" style={ui.title}>{practice.practiceSet.kind === "changeDrill" ? "You practised the update." : "A little more prepared."}</Text><Text style={ui.body}>{practice.practiceSet.kind === "changeDrill" ? "Your rehearsal now reflects the new instruction. The earlier version stays marked out of date." : "Here’s what you covered in this rehearsal. Keep the questions for your trainer."}</Text></View>
      <View style={styles.summary}>
        {recap.map(({ instruction, covered, tries, retried }) => <View key={instruction.id} style={styles.summaryRow}><Portrait size={46} /><View style={ui.flex}><Text style={ui.blueLabel}>{instruction.situation}</Text><Text style={ui.body}>{instruction.expectedAction}</Text><Text style={ui.meta}>{covered ? retried ? "Covered after retrying" : "Covered on your first try" : "Not yet covered"}{tries ? " · " + tries + (tries === 1 ? " attempt" : " attempts") : ""}</Text></View></View>)}
        <Text style={ui.meta}>This records your practice, not a prediction of performance at work.</Text>
      </View>
      {changePair && <ChangeComparison before={changePair.before.expectedAction} after={changePair.after.expectedAction} />}
      <TrainerQuestions questions={extraction.openQuestions} evidence={extraction.sourceEvidence} />
      <Action secondary label={showRecapEvidence ? "Hide my source notes" : "Review my source notes"} onPress={() => setShowRecapEvidence(!showRecapEvidence)} />
      {showRecapEvidence && <EvidenceNotes items={practice.sourceEvidence} />}
      {updateId && practice.practiceSet.kind === "standard" && !update && <View style={styles.changeInvite}>
        <Text style={ui.label}>Now your trainer changes an instruction.</Text><Text style={ui.body}>What happens to what you just learned? Try a fictional update and see exactly what changes.</Text>
        <Action label="Try a training update →" disabled={!!busy} onPress={() => void run("Opening the trainer’s update…", async () => { const response = await client.getConversation({ beeSourceId: updateId, sourceKind: "fixture" }); setUpdate(response.conversation); onStepChange?.(); })} />
      </View>}
    </>}
    {update && !comparison && <View style={ui.paper}>
      <Text style={ui.label}>A new note from your trainer</Text><Text style={ui.meta}>Fictional update · separate conversation</Text>
      {update.utterances.map((u) => <Text key={u.id} selectable style={ui.inkBody}>“{u.text}”</Text>)}
      <Text style={ui.body}>Use this update to compare the instruction you practised. Nothing changes until you confirm it.</Text>
      <Action label="Use this update and compare" disabled={!!busy} onPress={() => void run("Comparing the two sources…", compare)} />
      <Action secondary label="Back to my recap" disabled={!!busy} onPress={() => { setUpdate(null); onStepChange?.(); }} />
    </View>}
    {comparison && <View style={ui.paper}>
      <Text accessibilityRole="header" style={ui.title}>One instruction changed.</Text>
      <ChangeComparison before={before?.expectedAction ?? "See the earlier source below."} after={comparison.change.replacementInstruction.expectedAction} />
      <Text style={ui.body}>Confirming marks the earlier practice out of date and creates one new situation.</Text>
      <EvidenceNotes items={comparison.evidence} />
      <Action label="Confirm update & practise it" disabled={!!busy} onPress={() => void run("Updating your practice…", confirm)} />
    </View>}
    {busy && <Loading label={busy} />}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    {practice && <Pressable accessibilityRole="button" disabled={!!busy} onPress={onExit} style={ui.textButton}><Text style={ui.link}>Back to training</Text></Pressable>}
  </View>;
}
function ChangeComparison({ before, after }: { before: string; after: string }) {
  return <View style={styles.comparison}><View style={styles.before}><Text style={ui.meta}>Earlier instruction</Text><Text selectable style={ui.body}>{before}</Text></View><View style={styles.after}><Text style={ui.label}>Updated instruction</Text><Text selectable style={ui.inkBody}>{after}</Text></View></View>;
}
const styles = StyleSheet.create({
  practiceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  situation: { gap: 18 },
  characterRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, backgroundColor: theme.colors.action },
  characterName: { fontFamily: theme.type.display, fontSize: 19, lineHeight: 24, color: "white" }, characterNote: { fontFamily: theme.type.body, fontSize: 14, color: "white" },
  message: { marginRight: 22, backgroundColor: theme.colors.surface, borderRadius: 22, borderBottomLeftRadius: 4, padding: 20, gap: 16 },
  prompt: { fontFamily: theme.type.display, fontSize: 22, lineHeight: 28, color: theme.colors.ink },
  composer: { gap: 10, backgroundColor: theme.colors.inset, padding: 16, borderRadius: 22, borderBottomRightRadius: 4, marginLeft: 16 }, answer: { minHeight: 110 },
  feedback: { borderRadius: 20, padding: 20, gap: 18 }, covered: { backgroundColor: theme.colors.surface }, retry: { backgroundColor: theme.colors.surface },
  summary: { gap: 14 }, summaryRow: { flexDirection: "row", gap: 12, padding: 18, borderRadius: 20, backgroundColor: theme.colors.inset },
  changedNotice: { borderLeftWidth: 3, borderLeftColor: theme.colors.action, paddingLeft: 14, gap: 6 },
  changeInvite: { backgroundColor: theme.colors.inset, padding: 20, gap: 14, borderRadius: 20 },
  comparison: { gap: 12 }, before: { padding: 16, backgroundColor: "white", borderRadius: 16, gap: 8 }, after: { padding: 16, backgroundColor: theme.colors.inset, borderRadius: 16, gap: 8 },
});
