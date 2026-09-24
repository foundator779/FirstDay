import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import type { BeeUtterance, CreateOpenQuestionRequestInput, InstructionCard, OpenQuestion, SourceEvidence, SourceKind, UpdateInstructionRequestInput } from "@firstday/contracts";
import type { PickerState, PreviewState, ReviewState } from "./state";
import { isConversationSelectable } from "./state";
import { Portrait, DesignIcon } from "./design-assets";
import { filterTrainingConversations } from "./training-list";
import { formatEvidenceSpan, isUtteranceExcluded } from "./review-evidence";

export function Action({ label, onPress, secondary = false, disabled = false }: { label: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.button, secondary && ui.secondary, pressed && { opacity: 0.8 }, disabled && { opacity: 0.45 }]}>
    <Text style={[ui.buttonText, secondary && { color: theme.colors.ink }]}>{label}</Text>
  </Pressable>;
}

export function EvidenceNotes({ items }: { items: readonly SourceEvidence[] }) {
  return <View style={ui.evidence}>
    <Text style={ui.label}>From the training</Text>
    {items.map((item) => <View key={item.id} style={ui.gap}>
      <Text selectable style={ui.body}>“{item.quote}”</Text>
      <Text style={ui.meta}>{item.speakerLabel ?? "Trainer"} · {formatEvidenceSpan(item)}</Text>
    </View>)}
  </View>;
}

export function TrainerQuestions({ questions, evidence }: { questions: readonly OpenQuestion[]; evidence: readonly SourceEvidence[] }) {
  const [expanded, setExpanded] = useState(false);
  if (questions.length === 0) return null;
  return <View style={ui.questions}>
    <Text style={ui.label}>Ask your trainer</Text>
    <Text style={ui.body}>These details weren’t clear enough to turn into practice.</Text>
    {questions.map((question) => <View key={question.id} style={ui.questionRow}>
      <Text selectable style={ui.inkBody}>{question.question}</Text>
      {expanded && <EvidenceNotes items={evidence.filter((e) => question.sourceEvidence.includes(e.id))} />}
    </View>)}
    <Action secondary label={expanded ? "Hide question sources" : "Why is this uncertain?"} onPress={() => setExpanded(!expanded)} />
  </View>;
}

export function ConversationPicker({ state, onLoad, onSelect, onContinue }: { state: PickerState; onLoad(kind: SourceKind): void; onSelect(id: string): void; onContinue(): void }) {
  const [query, setQuery] = useState("");
  const training = filterTrainingConversations(state.conversations, query);
  const [help, setHelp] = useState(false);
  return <View style={ui.section}>
    <View style={ui.tabs} accessibilityRole="radiogroup">
      {(["fixture", "bee"] as const).map((kind) => <Pressable key={kind} accessibilityRole="radio" aria-checked={state.sourceKind === kind} accessibilityState={{ checked: state.sourceKind === kind }} onPress={() => { setQuery(""); onLoad(kind); }} style={[ui.tab, state.sourceKind === kind && ui.tabActive]}>
        <Text style={[ui.tabText, state.sourceKind === kind && { color: "white" }]}>{kind === "fixture" ? "Try an example" : "My Bee training"}</Text>
      </Pressable>)}
    </View>
    <View style={ui.search}><TextInput accessibilityLabel="Search training conversations" placeholder="Search your training" placeholderTextColor={theme.colors.tertiaryInk} value={query} onChangeText={setQuery} style={ui.searchInput} /><DesignIcon name="search" /></View>
    <View style={ui.journeyBand}>
      <View style={ui.journeySteps}>{["Choose", "Review", "Confirm", "Practise"].map((label, index) => <View key={label} style={[ui.journeyStep, index === 0 && ui.journeyActive]}><Text style={[ui.stepNumber, index === 0 && { color: "white" }]}>{index + 1}</Text><Text style={[ui.stepCaption, index === 0 && { color: "white" }]}>{label}</Text></View>)}</View>
      <View style={ui.sessionCard}><Text style={ui.blueLabel}>Your first shift, rehearsed.</Text><View style={ui.sessionRow}><Text style={ui.sessionTime}>3 situations</Text><View style={ui.sessionNote}><Text style={ui.label}>Learn it. Try it. Keep the source.</Text><Text style={ui.body}>Choose a training conversation to get started.</Text></View></View></View>
    </View>
    <View style={ui.row}><Text accessibilityRole="header" style={[ui.blueLabel, { flex: 1 }]}>Training conversations</Text><Text style={ui.meta}>{state.sourceKind === "fixture" ? "Fictional examples" : "From Bee"}</Text></View>
    {state.phase === "checking" ? <Loading label="Loading your conversations…" /> : state.phase !== "ready" ? <View style={ui.paper}>
      <Text style={ui.label}>{state.sourceKind === "bee" ? "Connect your Bee training" : "Examples aren’t available"}</Text>
      <Text style={ui.body}>{state.message ?? "Record a conversation with Bee and connect the local Bee bridge. You can try a fictional example now."}</Text>
      <Action label={state.sourceKind === "bee" ? "Try an example" : "Try again"} onPress={() => onLoad("fixture")} />
    </View> : <View style={ui.list}>
      {training.length === 0 && <View style={ui.paper}><Text style={ui.body}>No conversations match your search.</Text><Action secondary label="Clear search" onPress={() => setQuery("")} /></View>}
      {training.map((item, index) => {
        const selected = state.selectedConversationId === item.id;
        return <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.title} aria-checked={selected} accessibilityState={{ checked: selected, disabled: !isConversationSelectable(item) }} disabled={!isConversationSelectable(item)} onPress={() => onSelect(item.id)} style={[ui.sourceRow, selected && ui.selectedRow]}>
          <Portrait person={index % 2 === 0 ? "maya" : "rowan"} size={58} />
          <View style={ui.flex}><View style={ui.sourceName}><Text style={ui.sourceTitle}>{item.title.replace(/^Fixture - /, "").replace(/ - synthetic training$/, "")}</Text><Text style={ui.sourceDescription}>First shift training</Text></View><View style={ui.row}><Text style={ui.sourceStatus}>{item.status === "processed" ? "Ready to review" : "Processing"}</Text>{selected && <Text style={ui.sourceStatus}>Selected</Text>}</View></View>
        </Pressable>;
      })}
      <Action label="Review this conversation" disabled={!training.some((item) => item.id === state.selectedConversationId && isConversationSelectable(item))} onPress={onContinue} />
    </View>}
    <Pressable accessibilityRole="button" aria-expanded={help} accessibilityState={{ expanded: help }} onPress={() => setHelp(!help)} style={ui.textButton}><Text style={ui.link}>{help ? "Hide how FirstDay works" : "How does FirstDay work?"}</Text></Pressable>
    {help && <Text style={ui.body}>Bee captures your training. FirstDay turns clear guidance into practice. When your trainer changes an instruction, Change Drill lets you compare both versions and rehearse the update.</Text>}
  </View>;
}

export function Loading({ label }: { label: string }) {
  return <View accessibilityLiveRegion="polite" style={ui.loading}><ActivityIndicator color={theme.colors.action} /><Text style={ui.body}>{label}</Text></View>;
}

export function TranscriptCheck({ preview, review, aiMode, onBack, onRetry, onToggle, onConsent, onExtract }: { preview: PreviewState; review: ReviewState; aiMode: boolean; onBack(): void; onRetry(): void; onToggle(u: BeeUtterance): void; onConsent(value: boolean): void; onExtract(): void }) {
  const [details, setDetails] = useState(false);
  if (preview.phase === "loading") return <Loading label="Opening the transcript…" />;
  if (!preview.source) return <View style={ui.section}><Text style={ui.body}>{preview.message ?? "Could not open this conversation."}</Text><Action label="Try again" onPress={onRetry} /><Action secondary label="Back to training" onPress={onBack} /></View>;
  const source = preview.source;
  const included = source.utterances.filter((u) => !isUtteranceExcluded(u, preview.excludedRanges)).length;
  return <View style={ui.section}>
    <Action secondary label="‹ Back to training" onPress={onBack} />
    <View style={ui.gap}><Text accessibilityRole="header" style={ui.title}>Choose what to learn.</Text><Text style={ui.body}>Keep the useful guidance. Tap any line to leave it out.</Text></View>
    <Text style={ui.label}>{source.title.replace(/ - synthetic training$/, "")}</Text>
    <Text style={ui.meta}>{included} of {source.utterances.length} passages included{source.sourceKind === "fixture" ? " · Fictional conversation" : ""}</Text>
    <View style={ui.list}>{source.utterances.map((u) => {
      const selected = !isUtteranceExcluded(u, preview.excludedRanges);
      return <Pressable key={u.id} accessibilityRole="checkbox" accessibilityLabel={u.text} aria-checked={selected} accessibilityState={{ checked: selected }} onPress={() => onToggle(u)} style={[ui.transcriptRow, !selected && { backgroundColor: theme.colors.inset }]}>
        <Text accessible={false} style={ui.check}>{selected ? "✓" : "−"}</Text><View style={ui.flex}>
          <Text style={ui.meta}>{u.speaker?.name ?? u.speaker?.label ?? "Speaker"} · {formatEvidenceSpan(u)}{!selected ? " · Excluded" : ""}</Text>
          <Text style={[ui.inkBody, !selected && { color: theme.colors.tertiaryInk }]}>{u.text}</Text>
        </View>
      </Pressable>;
    })}</View>
    <View style={ui.paper}>
      <View style={ui.row}><View style={ui.flex}><Text style={ui.label}>I have permission to use this conversation</Text><Text style={ui.meta}>For my private FirstDay practice.</Text></View><Switch accessibilityLabel="Confirm permission to use this conversation" value={preview.consentConfirmed} onValueChange={onConsent} trackColor={{ true: theme.colors.confirmed }} /></View>
      <Text style={ui.meta}>{aiMode ? "Included passages and your practice answers are sent to Amazon Bedrock for AI processing. Excluded passages are not sent." : "This example is processed on this device. No model request is made."}</Text>
    </View>
    {review.message && <Text accessibilityRole="alert" style={ui.error}>{review.message}</Text>}
    <Action label="Find the instructions" onPress={onExtract} disabled={!preview.consentConfirmed || included === 0} />
    <Pressable accessibilityRole="button" aria-expanded={details} accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={ui.textButton}><Text style={ui.link}>Source details {details ? "−" : "+"}</Text></Pressable>
    {details && <View style={ui.gap}><Text selectable style={ui.meta}>Conversation: {source.id}</Text><Text selectable style={ui.meta}>Revision: {source.revision}</Text></View>}
  </View>;
}

function RuleEditor({ rule, evidence, busy, onUpdate, onQuestion }: { rule: InstructionCard; evidence: SourceEvidence[]; busy: boolean; onUpdate(input: UpdateInstructionRequestInput): Promise<void>; onQuestion(input: CreateOpenQuestionRequestInput): Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState(rule.expectedAction);
  const [situation, setSituation] = useState(rule.situation);
  const [exceptions, setExceptions] = useState(rule.exceptions.join("\n"));
  const [question, setQuestion] = useState("");
  const [ask, setAsk] = useState(false);
  const update = (status: "confirmed" | "rejected") => { void onUpdate({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status,
    ...(edit && status === "confirmed" ? { text: `When ${situation.trim()}, ${action.trim()}`, situation: situation.trim(), expectedAction: action.trim(), exceptions: exceptions.split("\n").map((v) => v.trim()).filter(Boolean) } : {}) }).catch(() => undefined); };
  return <View style={ui.paper}>
    <Text style={ui.meta}>Check this against what was said</Text>
    <Text style={ui.label}>{rule.situation}</Text>
    <Text style={ui.ruleAction}>{rule.expectedAction}</Text>
    {rule.exceptions.map((text) => <Text key={text} style={ui.body}>Exception: {text}</Text>)}
    <EvidenceNotes items={evidence} />
    {edit && <View style={ui.gap}>{[["Situation", situation, setSituation], ["Action", action, setAction], ["Exceptions (one per line)", exceptions, setExceptions]].map(([label, value, setter]) => <View key={String(label)} style={ui.gap}><Text style={ui.label}>{String(label)}</Text><TextInput accessibilityLabel={String(label)} multiline value={String(value)} onChangeText={setter as (text: string) => void} style={ui.input} /></View>)}</View>}
    {ask ? <View style={ui.gap}>
      <Text style={ui.label}>What would you ask your trainer?</Text><TextInput accessibilityLabel="Question for your trainer" value={question} onChangeText={setQuestion} multiline style={ui.input} />
      <Action label="Save private question" disabled={busy || !question.trim()} onPress={() => { void onQuestion({ sourceConversationId: rule.sourceConversationId, sourceRevision: rule.sourceRevision, instructionId: rule.id, question: question.trim(), sourceEvidence: rule.sourceEvidence, shareConsent: false }).then(() => { setAsk(false); }).catch(() => undefined); }} />
      <Action secondary label="Cancel question" onPress={() => setAsk(false)} />
    </View> : <>
      <Action label={busy ? "Saving…" : edit ? "Save and confirm" : "Yes, this matches the training"} disabled={busy || !action.trim() || !situation.trim() || !!rule.supersedesId} onPress={() => update("confirmed")} />
      <View style={ui.row}><Pressable accessibilityRole="button" onPress={() => setEdit(!edit)} disabled={busy} style={ui.textButton}><Text style={ui.link}>{edit ? "Cancel edit" : "Edit wording"}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setAsk(true)} disabled={busy} style={ui.textButton}><Text style={ui.link}>Ask trainer</Text></Pressable><Pressable accessibilityRole="button" onPress={() => update("rejected")} disabled={busy} style={ui.textButton}><Text style={ui.link}>Leave out</Text></Pressable></View>
    </>}
  </View>;
}

export function RuleCheck({ review, busy, error, onBack, onUpdate, onQuestion }: { review: ReviewState; busy: boolean; error: string | null; onBack(): void; onUpdate(input: UpdateInstructionRequestInput): Promise<void>; onQuestion(input: CreateOpenQuestionRequestInput): Promise<void> }) {
  const [showConfirmed, setShowConfirmed] = useState(false);
  if (review.phase === "loading") return <Loading label="Finding the instructions and anything that needs clarification…" />;
  const extraction = review.extraction;
  if (!extraction) return <View style={ui.section}><Text style={ui.error}>{review.message ?? "No instructions found."}</Text><Action label="Choose another conversation" onPress={onBack} /></View>;
  const pending = extraction.items.filter((r) => r.status === "needsReview");
  const confirmed = extraction.items.filter((r) => r.status === "confirmed");
  const focus = pending[0];
  return <View style={ui.section}>
    <Action secondary label="‹ Back to training" disabled={busy} onPress={onBack} />
    <View style={ui.gap}><Text accessibilityRole="header" style={ui.title}>{focus ? "Does this match your training?" : confirmed.length ? "Your instructions are ready." : "Ask before you practise."}</Text>
      <Text style={ui.body}>{focus ? `${confirmed.length} confirmed · ${pending.length} left to review. Only confirmed instructions become practice.` : confirmed.length ? "You’ve checked the rules. Now try them in a realistic situation." : "There isn’t enough confirmed guidance for three situations. Try another conversation or clarify the questions below."}</Text></View>
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    {focus && <RuleEditor key={focus.id} rule={focus} evidence={extraction.sourceEvidence.filter((e) => focus.sourceEvidence.includes(e.id))} busy={busy} onUpdate={onUpdate} onQuestion={onQuestion} />}
    {!focus && confirmed.length !== 3 && <View style={ui.paper}><Text style={ui.body}>This rehearsal needs three confirmed instructions. You have {confirmed.length}. Choose another conversation with enough clear guidance.</Text><Action label="Choose another conversation" onPress={onBack} /></View>}
    {confirmed.length > 0 && <View style={ui.divider}><Pressable accessibilityRole="button" aria-expanded={showConfirmed} accessibilityState={{ expanded: showConfirmed }} onPress={() => setShowConfirmed(!showConfirmed)} style={ui.textButton}><Text style={ui.link}>{confirmed.length} confirmed {confirmed.length === 1 ? "instruction" : "instructions"} {showConfirmed ? "−" : "+"}</Text></Pressable>
      {showConfirmed && confirmed.map((r) => <View key={r.id} style={ui.questionRow}><Text style={ui.label}>✓ {r.situation}</Text><Text style={ui.body}>{r.expectedAction}</Text><EvidenceNotes items={extraction.sourceEvidence.filter((e) => r.sourceEvidence.includes(e.id))} /></View>)}
    </View>}
    <TrainerQuestions questions={extraction.openQuestions} evidence={extraction.sourceEvidence} />
  </View>;
}

export const ui = StyleSheet.create({
  section: { gap: 20 }, gap: { gap: 8 }, flex: { flex: 1, gap: 7 }, row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { color: theme.colors.action, fontFamily: theme.type.display, fontSize: 27, lineHeight: 32 },
  label: { color: theme.colors.ink, fontFamily: theme.type.utility, fontSize: 17, lineHeight: 22 },
  blueLabel: { color: theme.colors.action, fontFamily: theme.type.display, fontSize: 19, lineHeight: 24 },
  ruleAction: { color: theme.colors.action, fontFamily: theme.type.display, fontSize: 23, lineHeight: 29 },
  body: { color: theme.colors.secondaryInk, fontFamily: theme.type.body, fontSize: 16, lineHeight: 22 }, inkBody: { color: theme.colors.ink, fontFamily: theme.type.body, fontSize: 17, lineHeight: 23 },
  meta: { color: theme.colors.tertiaryInk, fontFamily: theme.type.body, fontSize: 14, lineHeight: 19 },
  paper: { padding: 20, gap: 17, backgroundColor: theme.colors.surface, borderRadius: 20 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", padding: 13, borderRadius: 25, backgroundColor: theme.colors.action },
  buttonText: { fontFamily: theme.type.utility, fontSize: 18, color: "white", textAlign: "center" },
  secondary: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.rule },
  textButton: { minHeight: 44, justifyContent: "center", paddingVertical: 10 }, link: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 16, lineHeight: 21 },
  tabs: { flexDirection: "row", gap: 8 }, tab: { flex: 1, minHeight: 44, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface }, tabActive: { backgroundColor: theme.colors.action }, tabText: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 16 },
  search: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.inset, borderRadius: 25, paddingHorizontal: 16, minHeight: 46, gap: 10 }, searchInput: { flex: 1, minHeight: 46, color: theme.colors.ink, fontFamily: theme.type.body, fontSize: 17 },
  journeyBand: { marginHorizontal: -24, padding: 24, backgroundColor: theme.colors.inset, gap: 14 }, journeySteps: { flexDirection: "row", gap: 12 }, journeyStep: { flex: 1, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "white", minHeight: 68, gap: 4 }, journeyActive: { backgroundColor: theme.colors.action }, stepNumber: { fontFamily: theme.type.utility, fontSize: 27, color: theme.colors.ink }, stepCaption: { fontFamily: theme.type.body, fontSize: 13, color: theme.colors.ink },
  sessionCard: { padding: 17, borderRadius: 20, backgroundColor: "white", gap: 15 }, sessionRow: { flexDirection: "row", alignItems: "center", gap: 10 }, sessionTime: { fontFamily: theme.type.body, fontSize: 13, color: theme.colors.action, width: 57 }, sessionNote: { flex: 1, padding: 12, gap: 5, borderRadius: 13, backgroundColor: theme.colors.surface },
  list: { gap: 10 }, sourceRow: { minHeight: 106, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderColor: theme.colors.inset, borderRadius: 18, backgroundColor: theme.colors.inset }, selectedRow: { borderColor: theme.colors.action }, sourceName: { backgroundColor: "white", borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8, gap: 3 }, sourceTitle: { fontFamily: theme.type.utility, fontSize: 17, color: theme.colors.action }, sourceDescription: { fontFamily: theme.type.body, fontSize: 14, color: theme.colors.secondaryInk }, sourceStatus: { fontFamily: theme.type.body, color: theme.colors.actionPressed, fontSize: 13 },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.rule, paddingTop: 18, gap: 10 },
  transcriptRow: { flexDirection: "row", gap: 10, padding: 16, backgroundColor: theme.colors.surface, borderRadius: 18 }, check: { color: theme.colors.action, fontSize: 20, width: 22 },
  evidence: { borderLeftWidth: 2, borderLeftColor: theme.colors.action, paddingLeft: 13, gap: 10 },
  questions: { padding: 18, backgroundColor: theme.colors.surface, borderRadius: 18, gap: 10 }, questionRow: { paddingVertical: 10, gap: 10 },
  input: { borderWidth: 1, borderColor: theme.colors.rule, borderRadius: 18, backgroundColor: "white", padding: 14, fontFamily: theme.type.body, fontSize: 17, lineHeight: 23, minHeight: 80, textAlignVertical: "top", color: theme.colors.ink },
  loading: { minHeight: 140, justifyContent: "center", alignItems: "center", gap: 16 }, error: { color: theme.colors.danger, fontFamily: theme.type.body, fontSize: 16, lineHeight: 22 },
});
