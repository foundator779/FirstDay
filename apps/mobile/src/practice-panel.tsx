import { UnderstandingPanel } from "./understanding-panel";
import { hasUnderstandingClient } from "./understanding-client";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Attempt, ConfirmChangeResponse, CreateAttemptResponse, CreatePracticeSetResponse, ExtractInstructionsResponse, InstructionCard, OpenQuestion, SourceConversation, SourceSessionResponse } from "@firstday/contracts";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import type { PracticeClient } from "./synthetic-client";
import { Action, EvidenceNotes, Loading, TrainerQuestions, ui } from "./learner-panels";
import { practiceRecap } from "./practice-recap";
import { Portrait } from "./design-assets";
import { VoiceRehearsal } from "./voice-rehearsal";
import { practiceSelection, rehearsedInstructions } from "./practice-workflow";
import { TrainingUpdatePanel } from "./training-update-panel";
import { restorePractice } from "./session-recovery";
import { useDraftStorage } from "./draft-context";
import type { DraftContext } from "./draft-store";

type Props = { restoredSession?: SourceSessionResponse | undefined; isVisible?: boolean; aiMode?: "offline" | "bedrock"; client: PracticeClient; extraction: ExtractInstructionsResponse; source: SourceConversation; onActiveChange(active: boolean): void; onStepChange?(): void; onExit(): void; onQuestionSaved?(question:OpenQuestion):void; onCorrect?():void; withheldInstructionIds?:readonly string[] };
export const PracticeButton = Action;

export function PracticePanel({ client, extraction, source, onActiveChange, onStepChange, onExit, aiMode = "offline", isVisible = true, restoredSession, onQuestionSaved, onCorrect, withheldInstructionIds=[] }: Props) {
  const draftStorage=useDraftStorage();
  const [restored] = useState(() => restoredSession ? restorePractice(restoredSession) : null);
  const [practice, setPractice] = useState<CreatePracticeSetResponse | null>(restored?.practice ?? null);
  const [index, setIndex] = useState(restored?.index ?? 0);
  const [answer, setAnswer] = useState(restored?.feedback?.attempt.responseText ?? "");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CreateAttemptResponse | null>(restored?.feedback ?? null);
  const [attempts, setAttempts] = useState<Attempt[]>(restored?.attempts ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showRecapEvidence, setShowRecapEvidence] = useState(false);
  const [showRecap, setShowRecap] = useState(restored?.showRecap ?? false);
  const [reviewingUpdate, setReviewingUpdate] = useState(false);
  const [understandingActive,setUnderstandingActive]=useState(false);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [changePair, setChangePair] = useState<{ before: InstructionCard; after: InstructionCard } | null>(restored?.changePair ?? null);
  const [oldSetStale, setOldSetStale] = useState(restoredSession?.practices.some((p) => p.practice.practiceSet.status === "stale") ?? false);
  const confirmed = extraction.items.filter((item) => item.status === "confirmed"&&!withheldInstructionIds.includes(item.id));
  const selection = practiceSelection(extraction.items.filter(i=>!withheldInstructionIds.includes(i.id)), selectedIds?.filter(id=>!withheldInstructionIds.includes(id))??null);
  const scenario = practice?.scenarios[index];
  const draftContext: DraftContext | null = practice && scenario && practice.practiceSet.status !== "stale" && practice.practiceSet.status !== "complete" ? { learnerId: source.learnerId, sourceConversationId: source.id, practiceSetId: practice.practiceSet.id, scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision } : null;
  const draftKey = draftContext ? JSON.stringify(draftContext) : "";
  useEffect(() => {
    let cancelled = false;
    setDraftReady(false); setDraftMessage(null);
    if (!draftKey || feedback) { setDraftReady(true); return; }
    const context = JSON.parse(draftKey) as DraftContext;
    void draftStorage.load(context).then((draft) => {
      if (cancelled) return;
      if (draft) { setAnswer(draft.text); setInputMode(draft.inputMode); setDraftMessage("Your unsubmitted answer was restored from this device."); }
    }).catch(() => { if (!cancelled) setDraftMessage("Your local draft couldn’t be read. You can type an answer or clear local drafts in About."); }).finally(() => { if (!cancelled) setDraftReady(true); });
    return () => { cancelled = true; };
  }, [draftKey, feedback]);

  function editAnswer(text: string, mode: "text" | "voice") {
    setAnswer(text); setInputMode(mode);
    if (draftContext) void draftStorage.save(draftContext, text, mode).then(() => setDraftMessage("Answer draft saved on this device.")).catch(() => setDraftMessage("Your answer is here, but its device draft couldn’t be saved. Keep this screen open or submit when ready."));
  }
  const complete = practice?.practiceSet.status === "complete";
  const restoredRules = practice?.practiceSet.id === restored?.practice.practiceSet.id ? restored?.practice.instructions : undefined;
  const currentRules = practice?.practiceSet.kind === "changeDrill" && changePair ? [changePair.after] : rehearsedInstructions(restoredRules ?? confirmed, practice?.scenarios ?? []);
  const scenarioIds = new Set(practice?.scenarios.map((item) => item.id));
  const recap = practiceRecap(currentRules, attempts.filter((attempt) => scenarioIds.has(attempt.scenarioId)));

  async function run(label: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(null);
    try { await operation(); } catch { setError("This step couldn’t finish. Please try again."); }
    finally { lock.current = false; setBusy(null); }
  }
  async function start() {
    if (!selection.ready) return;
    const created = await client.createPractice({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, instructionIds: selection.ids, title: "First shift practice" });
    setPractice(created); setAttempts([]); setChangePair(null); setOldSetStale(false); onActiveChange(true);
  }
  async function submit() {
    if (!practice || !scenario || !answer.trim() || voiceBusy) return;
    const response = await client.submitAttempt({ scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, responseText: answer.trim(), inputMode });
    setFeedback(response); setAttempts((values) => [...values, response.attempt]); setPractice({ ...practice, practiceSet: response.practiceSet });
    if (draftContext) await draftStorage.save(draftContext, "", "text").catch(() => setDraftMessage("Your answer was submitted, but the old device draft couldn’t be cleared."));
  }
  function confirmedUpdate(response: ConfirmChangeResponse) {
    setChangePair({ before: response.previousInstruction, after: response.replacementInstruction });
    setOldSetStale(response.stalePracticeSetIds.length > 0);
    setPractice({ ...response.changeDrill, sourceEvidence: response.sourceEvidence });
    setAttempts([]);
    setIndex(0); setAnswer(""); setFeedback(null); setReviewingUpdate(false); setShowEvidence(false); setShowRecap(false);
    setInputMode("text"); setShowRecapEvidence(false); setError(null);
    onStepChange?.();
  }
  function continuePractice() {
    if (feedback?.attempt.result === "covered") {
      if (complete) setShowRecap(true); else setIndex((value) => value + 1);
    }
    setFeedback(null); setAnswer(""); setShowEvidence(false);
    onStepChange?.();
  }
  if(understandingActive)return <UnderstandingPanel questions={extraction.openQuestions} client={client} source={source} instructions={confirmed} instructionRevision={extraction.instructionRevision} isVisible={isVisible} aiMode={aiMode} onExit={()=>setUnderstandingActive(false)} {...(onCorrect?{onCorrect}:{})} {...(onQuestionSaved?{onQuestionSaved}:{})}/>;
  return <View style={ui.section}>
    {extraction.items.filter(i=>withheldInstructionIds.includes(i.id)).map(i=><View key={i.id} style={ui.paper}><Text style={ui.label}>{i.text}</Text><Text style={ui.error}>Grading paused by source correction</Text><Text style={ui.body}>{i.expectedAction}</Text>{onCorrect&&<Action secondary label="Review this source correction" onPress={onCorrect}/>}</View>)}
    {!!confirmed.length&&hasUnderstandingClient(client)&&<Action secondary label="Check what I understood" disabled={!!busy||voiceBusy} onPress={()=>setUnderstandingActive(true)}/>}
    {!practice && <View style={ui.paper}>
      <Text style={ui.label}>Try your first shift</Text>
      {confirmed.length < 3 && <>
        <Text style={ui.body}>{confirmed.length === 0 ? "Confirm 3 instructions to start this practice." : `Confirm ${3 - confirmed.length} more instruction${confirmed.length === 1 ? "s" : ""} to start this practice.`}</Text>
        <Text style={ui.meta}>Review the remaining cards above. Keep uncertain instructions as questions for your trainer. If this conversation has fewer than three clear instructions, choose another training conversation.</Text>
        <Action secondary label="Choose another training conversation" onPress={onExit} />
      </>}
      {confirmed.length > 3 && <>
        <Text style={ui.label}>Choose 3 instructions for this practice</Text>
        <Text accessibilityLiveRegion="polite" style={ui.meta}>{selection.ids.length} of 3 selected. Clear one selection to choose another instruction.</Text>
        {confirmed.map((rule) => {
          const selected = selection.ids.includes(rule.id);
          const disabled = !!busy || (!selected && selection.ids.length >= 3);
          return <Pressable key={rule.id} accessibilityRole="checkbox" accessibilityLabel={`Practise ${rule.situation}`} aria-checked={selected} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={() => setSelectedIds(selected ? selection.ids.filter((id) => id !== rule.id) : [...selection.ids, rule.id])} style={ui.transcriptRow}>
            <Text accessible={false} style={ui.check}>{selected ? "✓" : "○"}</Text><View style={ui.flex}><Text style={ui.label}>{rule.situation}</Text><Text style={ui.body}>{rule.expectedAction}</Text></View>
          </Pressable>;
        })}
      </>}
      <Text style={ui.body}>Three situations. Space to get it wrong. A source-backed explanation after each answer.</Text>
      <Text style={ui.meta}>{aiMode === "bedrock" ? "Use your own words. AI checks the meaning against your confirmed training." : "Offline preview: use the action wording from the instruction. AI feedback is available in the Bedrock demo."}</Text>
      <Action label="Start practice · 3 situations" disabled={!!busy || !selection.ready} onPress={() => void run("Preparing your situations…", start)} />
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
        {!feedback && <VoiceRehearsal key={scenario.id} active={isVisible && !busy && draftReady} prompt={scenario.context + " " + scenario.prompt} onTranscript={(text) => editAnswer(text, "voice")} onBusy={setVoiceBusy} />}
        <Text style={ui.meta}>{inputMode === "voice" && answer ? "Your spoken answer · review before submitting" : "Or type your answer"}</Text>
        <TextInput accessibilityLabel="Your action" value={answer} onChangeText={(text) => editAnswer(text, "text")} multiline maxLength={4000} editable={draftReady && !busy && !feedback && !voiceBusy} placeholder="I would…" placeholderTextColor={theme.colors.tertiaryInk} style={[ui.input, styles.answer]} />
        {draftMessage && <Text accessibilityLiveRegion="polite" style={ui.meta}>{draftMessage}</Text>}
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
    {practice && showRecap && !reviewingUpdate && <>
      {practice.practiceSet.status === "stale" && <View style={styles.changedNotice}><Text style={ui.label}>This earlier practice is out of date.</Text><Text style={ui.body}>These are your historical attempts. Review a later conversation before rehearsing this rule again.</Text></View>}
      <View style={ui.gap}><Text accessibilityRole="header" style={ui.title}>{practice.practiceSet.status === "stale" ? "Your earlier practice history." : practice.practiceSet.kind === "changeDrill" ? "You practised the update." : "A little more prepared."}</Text><Text style={ui.body}>{practice.practiceSet.status === "stale" ? "Earlier answers are preserved here. These instructions need review before further practice." : practice.practiceSet.kind === "changeDrill" ? "Your rehearsal now reflects the new instruction. The earlier version stays marked out of date." : "Here’s what you covered in this rehearsal. Keep the questions for your trainer."}</Text></View>
      <View style={styles.summary}>
        {recap.map(({ instruction, covered, tries, retried }) => <View key={instruction.id} style={styles.summaryRow}><Portrait size={46} /><View style={ui.flex}><Text style={ui.blueLabel}>{instruction.situation}</Text><Text style={ui.body}>{instruction.expectedAction}</Text><Text style={ui.meta}>{covered ? retried ? "Covered after retrying" : "Covered on your first try" : "Not yet covered"}{tries ? " · " + tries + (tries === 1 ? " attempt" : " attempts") : ""}</Text></View></View>)}
        <Text style={ui.meta}>This records your practice, not a prediction of performance at work.</Text>
      </View>
      {changePair && <ChangeComparison before={changePair.before.expectedAction} after={changePair.after.expectedAction} />}
      <TrainerQuestions questions={extraction.openQuestions} evidence={extraction.sourceEvidence} />
      <Action secondary label={showRecapEvidence ? "Hide my source notes" : "Review my source notes"} onPress={() => setShowRecapEvidence(!showRecapEvidence)} />
      {showRecapEvidence && <EvidenceNotes items={practice.sourceEvidence} />}
      {practice.practiceSet.status==='stale'&&<View style={ui.paper}><Text style={ui.body}>After source review, prepare a fresh set from three currently eligible instructions. Earlier scenarios and attempts stay in history.</Text><Action secondary label='Choose current instructions for fresh practice' disabled={!!busy} onPress={()=>{setPractice(null);setAttempts([]);setChangePair(null);setShowRecap(false);setFeedback(null);setAnswer('');setIndex(0);setSelectedIds(null);onStepChange?.();}}/></View>}
      <View style={styles.changeInvite}>
        <Text style={ui.label}>Did your trainer change an instruction?</Text><Text style={ui.body}>{source.sourceKind === "fixture" ? "Choose a fictional update and compare both sources before confirming the change." : "Choose a second processed Bee conversation to review what changed."}</Text>
        <Action label={source.sourceKind === "fixture" ? "Try a training update →" : "Choose a later Bee conversation →"} disabled={!!busy} onPress={() => { setReviewingUpdate(true); onStepChange?.(); }} />
      </View>
    </>}
    <TrainingUpdatePanel restoredSession={restoredSession} visible={reviewingUpdate && isVisible} client={client} source={source} instructionRevision={extraction.instructionRevision} previousRules={extraction.items} aiMode={aiMode === "bedrock"} onClose={() => { setReviewingUpdate(false); onStepChange?.(); }} onConfirmed={confirmedUpdate} {...(onStepChange ? { onStepChange } : {})} />
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
