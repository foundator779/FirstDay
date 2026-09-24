import type {
  BeeSource,
  CreateOpenQuestionRequestInput,
  ExtractInstructionsResponse,
  InstructionCard,
  OpenQuestion,
  SourceEvidence,
  UpdateInstructionRequestInput,
} from "@firstday/contracts";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";

import {
  buildReviewSections,
  evidenceSourceIdentity,
  evidenceTranscriptRows,
  formatEvidenceSpan,
  resolveEvidence,
} from "./review-evidence";
import type { ReviewState } from "./state";

type ReviewPanelProps = {
  review: ReviewState;
  source: BeeSource | null;
  busyInstructionId: string | null;
  actionError: string | null;
  onChooseAnotherSource(): void;
  onCreateQuestion(request: CreateOpenQuestionRequestInput): Promise<void>;
  onUpdateInstruction(request: UpdateInstructionRequestInput): Promise<void>;
};

type EditDraft = {
  text: string;
  situation: string;
  expectedAction: string;
  exceptions: string;
};

function statusCopy(status: InstructionCard["status"]): string {
  switch (status) {
    case "confirmed":
      return "CONFIRMED";
    case "rejected":
      return "REJECTED";
    case "changed":
      return "CHANGED";
    case "needsReview":
      return "NEEDS YOUR REVIEW";
  }
}

function ReviewStatus({ status }: { status: InstructionCard["status"] }) {
  return (
    <View
      style={[
        styles.status,
        status === "confirmed" && styles.statusConfirmed,
        status === "rejected" && styles.statusRejected,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === "confirmed" && styles.statusTextConfirmed,
          status === "rejected" && styles.statusTextRejected,
        ]}
      >
        {statusCopy(status)}
      </Text>
    </View>
  );
}

function TranscriptEvidenceFold({
  evidence,
  source,
  onClose,
}: {
  evidence: SourceEvidence[];
  source: BeeSource;
  onClose(): void;
}) {
  const rows = evidenceTranscriptRows(source.utterances, evidence);
  const highlightedCount = rows.filter(({ highlighted }) => highlighted).length;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Transcript evidence from ${source.title}`}
      style={styles.transcriptFold}
    >
      <View style={styles.transcriptFoldHeader}>
        <View style={styles.flexCopy}>
          <Text style={styles.transcriptFoldKicker}>MATCHING TRANSCRIPT</Text>
          <Text style={styles.transcriptFoldTitle}>The source stays open beside the rule.</Text>
          <Text style={styles.transcriptFoldMeta}>
            {highlightedCount} {highlightedCount === 1 ? "line" : "lines"} highlighted · full
            selected transcript shown for context
          </Text>
        </View>
        <View style={styles.matchStamp}>
          <Text style={styles.matchStampText}>{highlightedCount} MATCH</Text>
        </View>
      </View>

      <View style={styles.transcriptRows}>
        {rows.map(({ utterance, highlighted }) => {
          const speaker =
            utterance.speaker?.name ?? utterance.speaker?.label ?? "Speaker";
          return (
            <View
              key={utterance.id}
              accessibilityLabel={`${highlighted ? "Evidence match" : "Context"}: ${speaker}, ${formatEvidenceSpan(utterance)}, ${utterance.text}`}
              style={[styles.transcriptRow, highlighted && styles.transcriptRowHighlighted]}
            >
              <View style={[styles.transcriptTick, highlighted && styles.transcriptTickHighlighted]} />
              <View style={styles.flexCopy}>
                <View style={styles.transcriptRowMeta}>
                  <Text style={[styles.transcriptSpeaker, highlighted && styles.transcriptSpeakerHighlighted]}>
                    {speaker.toLocaleUpperCase()}
                  </Text>
                  <Text selectable style={styles.transcriptTime}>
                    {formatEvidenceSpan(utterance)}
                  </Text>
                  {highlighted && <Text style={styles.matchLabel}>EVIDENCE MATCH</Text>}
                </View>
                <Text selectable style={[styles.transcriptText, highlighted && styles.transcriptTextHighlighted]}>
                  {utterance.text}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.returnButton, pressed && styles.actionPressed]}
      >
        <Text style={styles.returnButtonText}>↑ Return to review</Text>
      </Pressable>
    </View>
  );
}

function EvidenceThread({
  evidence,
  source,
  revealed,
  onToggleReveal,
}: {
  evidence: SourceEvidence[];
  source: BeeSource;
  revealed: boolean;
  onToggleReveal(): void;
}) {
  const firstEvidence = evidence[0];
  if (firstEvidence === undefined) return null;
  const identity = evidenceSourceIdentity(source, firstEvidence);

  return (
    <View style={styles.evidenceBlock}>
      <View style={styles.evidenceHeading}>
        <Text style={styles.evidenceLabel}>SOURCE EVIDENCE</Text>
        <Text style={styles.evidencePrivacy}>PRIVATE · EXACT SOURCE</Text>
      </View>
      <View
        accessibilityLabel={`Exact source identity, ${identity.sourceKind}, ${identity.beeSourceId}, FirstDay source ${identity.sourceConversationId}, revision ${identity.sourceRevision}`}
        style={styles.sourceIdentity}
      >
        <Text selectable style={styles.sourceTitle}>{identity.title}</Text>
        <Text selectable style={styles.sourceIdentityLine}>
          {identity.sourceKind.toLocaleUpperCase()} · {identity.beeSourceId}
        </Text>
        <Text selectable style={styles.sourceIdentityLine}>
          FIRSTDAY SOURCE · {identity.sourceConversationId}
        </Text>
        <Text selectable style={styles.sourceIdentityLine}>
          REVISION · {identity.sourceRevision}
        </Text>
      </View>
      {evidence.map((item, index) => (
        <View key={item.id} style={styles.evidenceRow}>
          <View style={styles.threadColumn}>
            <View style={styles.threadDot} />
            {index < evidence.length - 1 && <View style={styles.threadRule} />}
          </View>
          <View style={styles.evidencePaper}>
            <Text style={styles.evidenceMeta}>
              {(item.speakerLabel ?? "speaker").toLocaleUpperCase()} · SPAN {formatEvidenceSpan(item)}
            </Text>
            <Text selectable style={styles.evidenceQuote}>“{item.quote}”</Text>
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: revealed }}
        aria-expanded={revealed}
        onPress={onToggleReveal}
        style={({ pressed }) => [styles.revealButton, pressed && styles.revealButtonPressed]}
      >
        <Text style={styles.revealButtonMark}>{revealed ? "↑" : "↳"}</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.revealButtonText}>
            {revealed ? "Return to review" : "Reveal in transcript"}
          </Text>
          <Text style={styles.revealButtonHint}>
            {revealed ? "Close the source fold without losing this review." : "Highlight the exact matching transcript lines."}
          </Text>
        </View>
      </Pressable>
      {revealed && (
        <TranscriptEvidenceFold evidence={evidence} source={source} onClose={onToggleReveal} />
      )}
    </View>
  );
}

function QuestionEvidenceCard({
  question,
  evidence,
  source,
  standalone,
  revealed,
  onToggleReveal,
}: {
  question: OpenQuestion;
  evidence: SourceEvidence[];
  source: BeeSource;
  standalone: boolean;
  revealed: boolean;
  onToggleReveal(): void;
}) {
  return (
    <View style={[styles.questionCard, standalone && styles.questionCardStandalone]}>
      <View style={styles.questionTopline}>
        <Text style={styles.questionReceiptLabel}>
          {standalone ? "SOURCE QUESTION · PRIVATE" : "QUESTION SAVED · PRIVATE"}
        </Text>
        <Text style={styles.privateStatus}>SHARING OFF</Text>
      </View>
      <Text selectable style={styles.questionReceiptText}>{question.question}</Text>
      {standalone && (
        <Text style={styles.questionContext}>
          This came from the source itself and is not attached to one instruction card.
        </Text>
      )}
      <EvidenceThread
        evidence={evidence}
        source={source}
        revealed={revealed}
        onToggleReveal={onToggleReveal}
      />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  minHeight = 72,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  minHeight?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.disabledInk}
        style={[styles.input, { minHeight }]}
        textAlignVertical="top"
      />
    </View>
  );
}

function ActionButton({
  label,
  tone,
  disabled = false,
  onPress,
}: {
  label: string;
  tone: "primary" | "secondary" | "danger" | "quiet";
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        tone === "primary" && styles.actionPrimary,
        tone === "secondary" && styles.actionSecondary,
        tone === "danger" && styles.actionDanger,
        tone === "quiet" && styles.actionQuiet,
        disabled && styles.actionDisabled,
        pressed && styles.actionPressed,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          tone === "primary" && styles.actionTextLight,
          tone === "danger" && styles.actionTextDanger,
          tone === "quiet" && styles.actionTextQuiet,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InstructionReviewCard({
  instruction,
  index,
  evidence,
  evidenceBundle,
  questions,
  source,
  revealedEvidenceKey,
  busy,
  showBusy,
  onToggleEvidence,
  onCreateQuestion,
  onUpdateInstruction,
}: {
  instruction: InstructionCard;
  index: number;
  evidence: SourceEvidence[];
  evidenceBundle: SourceEvidence[];
  questions: ExtractInstructionsResponse["openQuestions"];
  source: BeeSource;
  revealedEvidenceKey: string | null;
  busy: boolean;
  showBusy: boolean;
  onToggleEvidence(key: string): void;
  onCreateQuestion(request: CreateOpenQuestionRequestInput): Promise<void>;
  onUpdateInstruction(request: UpdateInstructionRequestInput): Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "question" | "reject">("idle");
  const [draft, setDraft] = useState<EditDraft>({
    text: instruction.text,
    situation: instruction.situation,
    expectedAction: instruction.expectedAction,
    exceptions: instruction.exceptions.join("\n"),
  });
  const [question, setQuestion] = useState("");
  const pending = instruction.status === "needsReview";

  async function confirm(): Promise<void> {
    try {
      await onUpdateInstruction({
        instructionId: instruction.id,
        sourceRevision: instruction.sourceRevision,
        status: "confirmed",
      });
    } catch {
      // The parent renders the canonical error while this card stays unchanged.
    }
  }

  async function saveEdit(): Promise<void> {
    const exceptions = draft.exceptions
      .split("\n")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    try {
      await onUpdateInstruction({
        instructionId: instruction.id,
        sourceRevision: instruction.sourceRevision,
        text: draft.text,
        situation: draft.situation,
        expectedAction: draft.expectedAction,
        exceptions,
        status: "confirmed",
      });
      setMode("idle");
    } catch {
      // The parent renders the canonical error and keeps the draft available.
    }
  }

  async function reject(): Promise<void> {
    try {
      await onUpdateInstruction({
        instructionId: instruction.id,
        sourceRevision: instruction.sourceRevision,
        status: "rejected",
      });
      setMode("idle");
    } catch {
      // The parent renders the canonical error while this card stays unchanged.
    }
  }

  async function ask(): Promise<void> {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    try {
      await onCreateQuestion({
        sourceConversationId: instruction.sourceConversationId,
        sourceRevision: instruction.sourceRevision,
        instructionId: instruction.id,
        question: trimmed,
        sourceEvidence: instruction.sourceEvidence,
        shareConsent: false,
      });
      setQuestion("");
      setMode("idle");
    } catch {
      // The parent renders the canonical error and keeps the question available.
    }
  }

  return (
    <View style={[styles.instructionCard, !pending && styles.instructionCardReviewed]}>
      <View style={styles.cardTopline}>
        <Text style={styles.cardNumber}>FIELD RULE · {String(index + 1).padStart(2, "0")}</Text>
        <View style={styles.statusRow}>
          <Text style={styles.confidence}>{Math.round(instruction.confidence * 100)}% SOURCE MATCH</Text>
          <ReviewStatus status={instruction.status} />
        </View>
      </View>

      <Text style={styles.instructionText}>{instruction.text}</Text>
      <View style={styles.ruleGrid}>
        <View style={styles.ruleCell}>
          <Text style={styles.ruleLabel}>WHEN</Text>
          <Text style={styles.ruleValue}>{instruction.situation}</Text>
        </View>
        <View style={styles.ruleCell}>
          <Text style={styles.ruleLabel}>DO</Text>
          <Text style={styles.ruleValue}>{instruction.expectedAction}</Text>
        </View>
      </View>
      {instruction.exceptions.length > 0 && (
        <View style={styles.exceptionNote}>
          <Text style={styles.exceptionLabel}>EXCEPTIONS</Text>
          <Text style={styles.exceptionText}>{instruction.exceptions.join(" · ")}</Text>
        </View>
      )}

      <EvidenceThread
        evidence={evidence}
        source={source}
        revealed={revealedEvidenceKey === `instruction:${instruction.id}`}
        onToggleReveal={() => onToggleEvidence(`instruction:${instruction.id}`)}
      />

      {questions.map((question) => (
        <QuestionEvidenceCard
          key={question.id}
          question={question}
          evidence={resolveEvidence(question.sourceEvidence, evidenceBundle)}
          source={source}
          standalone={false}
          revealed={revealedEvidenceKey === `question:${question.id}`}
          onToggleReveal={() => onToggleEvidence(`question:${question.id}`)}
        />
      ))}

      {pending && mode === "idle" && (
        <View style={styles.cardActions}>
          <ActionButton label="Confirm instruction" tone="primary" disabled={busy} onPress={() => void confirm()} />
          <ActionButton label="Edit first" tone="secondary" disabled={busy} onPress={() => setMode("edit")} />
          <ActionButton label="Ask trainer" tone="quiet" disabled={busy} onPress={() => setMode("question")} />
          <ActionButton label="Reject" tone="danger" disabled={busy} onPress={() => setMode("reject")} />
          {showBusy && <ActivityIndicator color={theme.colors.action} />}
        </View>
      )}

      {pending && mode === "edit" && (
        <View style={styles.formPanel}>
          <Text style={styles.formTitle}>Edit the card, then confirm it.</Text>
          <Field label="Instruction" value={draft.text} onChangeText={(text) => setDraft((value) => ({ ...value, text }))} />
          <Field label="Situation" value={draft.situation} onChangeText={(situation) => setDraft((value) => ({ ...value, situation }))} />
          <Field label="Expected action" value={draft.expectedAction} onChangeText={(expectedAction) => setDraft((value) => ({ ...value, expectedAction }))} />
          <Field label="Exceptions, one per line" value={draft.exceptions} onChangeText={(exceptions) => setDraft((value) => ({ ...value, exceptions }))} minHeight={54} />
          <View style={styles.cardActions}>
            <ActionButton
              label="Save & confirm"
              tone="primary"
              disabled={busy || draft.text.trim().length === 0 || draft.situation.trim().length === 0 || draft.expectedAction.trim().length === 0}
              onPress={() => void saveEdit()}
            />
            <ActionButton label="Cancel" tone="quiet" disabled={busy} onPress={() => setMode("idle")} />
            {showBusy && <ActivityIndicator color={theme.colors.action} />}
          </View>
        </View>
      )}

      {pending && mode === "question" && (
        <View style={styles.formPanel}>
          <Text style={styles.formTitle}>Keep the evidence attached to your question.</Text>
          <Text style={styles.formHint}>It is saved privately with sharing consent off.</Text>
          <Field label="Question for the trainer" value={question} onChangeText={setQuestion} />
          <View style={styles.cardActions}>
            <ActionButton label="Save question" tone="primary" disabled={busy || question.trim().length === 0} onPress={() => void ask()} />
            <ActionButton label="Cancel" tone="quiet" disabled={busy} onPress={() => setMode("idle")} />
            {showBusy && <ActivityIndicator color={theme.colors.action} />}
          </View>
        </View>
      )}

      {pending && mode === "reject" && (
        <View style={styles.rejectPanel}>
          <Text style={styles.rejectTitle}>Reject this instruction?</Text>
          <Text style={styles.rejectBody}>
            This decision is terminal for this source revision. Its evidence stays visible here for
            the audit trail.
          </Text>
          <View style={styles.cardActions}>
            <ActionButton label="Reject instruction" tone="danger" disabled={busy} onPress={() => void reject()} />
            <ActionButton label="Keep reviewing" tone="quiet" disabled={busy} onPress={() => setMode("idle")} />
            {showBusy && <ActivityIndicator color={theme.colors.action} />}
          </View>
        </View>
      )}
    </View>
  );
}

export function ReviewPanel({
  review,
  source,
  busyInstructionId,
  actionError,
  onChooseAnotherSource,
  onCreateQuestion,
  onUpdateInstruction,
}: ReviewPanelProps) {
  const [revealedEvidenceKey, setRevealedEvidenceKey] = useState<string | null>(null);

  if (review.phase === "loading" || review.phase === "idle") {
    return (
      <View style={styles.paperCard}>
        <Text style={styles.folio}>REVIEW NOTE · 03</Text>
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={theme.colors.action} />
          <View style={styles.flexCopy}>
            <Text style={styles.loadingTitle}>Finding evidence-backed instructions…</Text>
            <Text style={styles.loadingBody}>Only included transcript ranges can become cards.</Text>
          </View>
        </View>
      </View>
    );
  }

  const extraction = review.extraction;
  if (review.phase === "error" || extraction === null || source === null) {
    return (
      <View style={styles.paperCard}>
        <Text style={styles.folio}>REVIEW NOTE · 03</Text>
        <Text style={styles.title}>The instruction review is unavailable.</Text>
        <Text style={styles.body}>{review.message ?? "Return to the source and try again."}</Text>
        <ActionButton label="Choose another source" tone="secondary" onPress={onChooseAnotherSource} />
      </View>
    );
  }

  const sections = buildReviewSections(extraction.items, extraction.openQuestions);
  const confirmed = extraction.items.filter(({ status }) => status === "confirmed").length;
  const rejected = extraction.items.filter(({ status }) => status === "rejected").length;
  const pending = extraction.items.length - confirmed - rejected;

  return (
    <View style={styles.paperCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.flexCopy}>
          {source.sourceKind === "fixture" && (
            <View style={styles.fixturePill} accessibilityLabel="Demo fixture, not live Bee data">
              <View style={styles.fixtureDot} />
              <Text style={styles.fixtureText}>DEMO FIXTURE · NOT LIVE BEE</Text>
            </View>
          )}
          <Text style={styles.kicker}>READ THE RULE. FOLLOW THE THREAD.</Text>
          <Text style={styles.title}>Check each instruction against what was said.</Text>
          <Text style={styles.body}>
            Confirm, edit, reject, or save a grounded question. A decision applies only to this exact
            source revision.
          </Text>
        </View>
        <View style={styles.countStamp}>
          <Text style={styles.countNumber}>{pending}</Text>
          <Text style={styles.countLabel}>LEFT TO REVIEW</Text>
        </View>
      </View>

      <View style={styles.reviewReceipt}>
        <Text style={styles.receiptItem}>{confirmed} CONFIRMED</Text>
        <Text style={styles.receiptDot}>•</Text>
        <Text style={styles.receiptItem}>{rejected} REJECTED</Text>
        <Text style={styles.receiptDot}>•</Text>
        <Text style={styles.receiptItem}>{extraction.openQuestions.length} OPEN QUESTIONS</Text>
      </View>

      {actionError !== null && (
        <View style={styles.errorBanner} accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>That decision was not saved.</Text>
          <Text style={styles.errorBody}>{actionError}</Text>
        </View>
      )}

      <View style={styles.cardList}>
        {sections.cards.map(({ instruction, questions }, index) => (
          <InstructionReviewCard
            key={instruction.id}
            instruction={instruction}
            index={index}
            evidence={resolveEvidence(instruction.sourceEvidence, extraction.sourceEvidence)}
            evidenceBundle={extraction.sourceEvidence}
            questions={questions}
            source={source}
            revealedEvidenceKey={revealedEvidenceKey}
            busy={busyInstructionId !== null}
            showBusy={busyInstructionId === instruction.id}
            onToggleEvidence={(key) =>
              setRevealedEvidenceKey((current) => (current === key ? null : key))
            }
            onCreateQuestion={onCreateQuestion}
            onUpdateInstruction={onUpdateInstruction}
          />
        ))}
      </View>

      {sections.standaloneQuestions.length > 0 && (
        <View style={styles.standaloneQuestions}>
          <View style={styles.standaloneHeading}>
            <View style={styles.questionSeal}>
              <Text style={styles.questionSealText}>?</Text>
            </View>
            <View style={styles.flexCopy}>
              <Text style={styles.standaloneKicker}>PRIVATE SOURCE QUESTIONS</Text>
              <Text style={styles.standaloneTitle}>Keep the uncertain parts visible.</Text>
              <Text style={styles.standaloneBody}>
                These questions came from this source but are not attached to one instruction.
                Sharing stays off unless you choose otherwise later.
              </Text>
            </View>
          </View>
          <View style={styles.standaloneQuestionList}>
            {sections.standaloneQuestions.map((question) => (
              <QuestionEvidenceCard
                key={question.id}
                question={question}
                evidence={resolveEvidence(question.sourceEvidence, extraction.sourceEvidence)}
                source={source}
                standalone
                revealed={revealedEvidenceKey === `question:${question.id}`}
                onToggleReveal={() =>
                  setRevealedEvidenceKey((current) =>
                    current === `question:${question.id}` ? null : `question:${question.id}`,
                  )
                }
              />
            ))}
          </View>
        </View>
      )}

      <View style={[styles.completionNote, pending === 0 && styles.completionNoteDone]}>
        <View style={[styles.completionMark, pending === 0 && styles.completionMarkDone]}>
          <Text style={styles.completionMarkText}>{pending === 0 ? "✓" : pending}</Text>
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.completionTitle}>
            {pending === 0 ? "This source review is complete." : `${pending} decisions still need you.`}
          </Text>
          <Text style={styles.completionBody}>
            {pending === 0
              ? confirmed > 0
                ? "Confirmed instructions are ready for the next practice-building step."
                : "No instructions were confirmed. Choose another source when you are ready."
              : "Every card keeps its evidence close, so take them one at a time."}
          </Text>
        </View>
        {pending === 0 && confirmed === 0 && (
          <ActionButton label="Choose another source" tone="secondary" onPress={onChooseAnotherSource} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  paperCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.rule, borderRadius: theme.radius.large, borderCurve: "continuous", padding: 20, boxShadow: Platform.select({ web: "0 18px 54px rgba(63, 48, 34, 0.10)", default: "0 10px 30px rgba(63, 48, 34, 0.10)" }) },
  folio: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  reviewHeader: { flexDirection: "row", gap: 20, alignItems: "flex-start", flexWrap: "wrap" },
  flexCopy: { flex: 1, minWidth: 0 },
  kicker: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  title: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 30, lineHeight: 35, fontWeight: "600", letterSpacing: -0.7 },
  body: { color: theme.colors.secondaryInk, fontSize: 14, lineHeight: 22, marginTop: 8, marginBottom: 18, maxWidth: 660 },
  countStamp: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.actionWash, alignItems: "center", justifyContent: "center", transform: [{ rotate: "2deg" }] },
  countNumber: { color: theme.colors.action, fontFamily: theme.type.display, fontSize: 34, lineHeight: 38, fontWeight: "700" },
  countLabel: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 7, fontWeight: "700", letterSpacing: 0.6 },
  reviewReceipt: { backgroundColor: theme.colors.inset, borderRadius: theme.radius.small, minHeight: 42, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  receiptItem: { color: theme.colors.secondaryInk, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  receiptDot: { color: theme.colors.disabledInk },
  cardList: { gap: 18, marginTop: 20 },
  instructionCard: { backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: theme.colors.rule, borderRadius: theme.radius.medium, borderCurve: "continuous", padding: 18 },
  instructionCardReviewed: { borderColor: "#C8D0B8" },
  cardTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
  cardNumber: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  confidence: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700" },
  status: { minHeight: 26, borderRadius: theme.radius.pill, backgroundColor: theme.colors.warningWash, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  statusConfirmed: { backgroundColor: theme.colors.confirmedWash },
  statusRejected: { backgroundColor: theme.colors.dangerWash },
  statusText: { color: theme.colors.warning, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.5 },
  statusTextConfirmed: { color: theme.colors.confirmed },
  statusTextRejected: { color: theme.colors.danger },
  instructionText: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 23, lineHeight: 29, fontWeight: "600", marginTop: 16 },
  ruleGrid: { flexDirection: "row", gap: 1, backgroundColor: theme.colors.rule, borderWidth: 1, borderColor: theme.colors.rule, borderRadius: theme.radius.small, overflow: "hidden", marginTop: 16, flexWrap: "wrap" },
  ruleCell: { flex: 1, minWidth: 220, backgroundColor: theme.colors.surface, padding: 13 },
  ruleLabel: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.8 },
  ruleValue: { color: theme.colors.secondaryInk, fontSize: 13, lineHeight: 19, marginTop: 5 },
  exceptionNote: { backgroundColor: theme.colors.warningWash, borderLeftWidth: 3, borderLeftColor: theme.colors.warning, padding: 12, marginTop: 12 },
  exceptionLabel: { color: theme.colors.warning, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700" },
  exceptionText: { color: theme.colors.secondaryInk, fontSize: 12, lineHeight: 17, marginTop: 3 },
  evidenceBlock: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.rule },
  evidenceHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  evidenceLabel: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  evidencePrivacy: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.5 },
  sourceIdentity: { backgroundColor: theme.colors.inset, borderRadius: theme.radius.small, padding: 12, marginBottom: 10, gap: 3 },
  sourceTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  sourceIdentityLine: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8, lineHeight: 13 },
  evidenceRow: { flexDirection: "row", gap: 10 },
  threadColumn: { width: 12, alignItems: "center" },
  threadDot: { width: 9, height: 9, borderRadius: 5, marginTop: 12, backgroundColor: theme.colors.action },
  threadRule: { flex: 1, width: 1, backgroundColor: "#E4B5A8" },
  evidencePaper: { flex: 1, minWidth: 0, backgroundColor: theme.colors.actionWash, borderRadius: theme.radius.small, padding: 12, marginBottom: 8 },
  evidenceMeta: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.6 },
  evidenceQuote: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 14, lineHeight: 20, fontStyle: "italic", marginTop: 5 },
  revealButton: { minHeight: theme.control.minimumHeight, backgroundColor: theme.colors.action, borderRadius: theme.radius.small, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  revealButtonPressed: { backgroundColor: theme.colors.actionPressed, transform: [{ scale: 0.99 }] },
  revealButtonMark: { color: theme.colors.surface, fontFamily: theme.type.display, fontSize: 17, fontWeight: "700" },
  revealButtonText: { color: theme.colors.surface, fontSize: 12, fontWeight: "800" },
  revealButtonHint: { color: theme.colors.actionWash, fontSize: 9, lineHeight: 13, marginTop: 1 },
  transcriptFold: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.action, borderRadius: theme.radius.medium, borderCurve: "continuous", padding: 14, marginTop: 10 },
  transcriptFoldHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  transcriptFoldKicker: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  transcriptFoldTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 17, lineHeight: 22, fontWeight: "700", marginTop: 3 },
  transcriptFoldMeta: { color: theme.colors.tertiaryInk, fontSize: 10, lineHeight: 15, marginTop: 3 },
  matchStamp: { minHeight: 28, borderRadius: theme.radius.pill, backgroundColor: theme.colors.actionWash, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  matchStampText: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700" },
  transcriptRows: { borderTopWidth: 1, borderTopColor: theme.colors.rule, marginTop: 12 },
  transcriptRow: { minHeight: 60, flexDirection: "row", gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.rule, opacity: 0.64 },
  transcriptRowHighlighted: { backgroundColor: theme.colors.actionWash, opacity: 1, paddingHorizontal: 8 },
  transcriptTick: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: theme.colors.rule },
  transcriptTickHighlighted: { backgroundColor: theme.colors.action },
  transcriptRowMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  transcriptSpeaker: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700" },
  transcriptSpeakerHighlighted: { color: theme.colors.action },
  transcriptTime: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8 },
  matchLabel: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 7, fontWeight: "700", letterSpacing: 0.4 },
  transcriptText: { color: theme.colors.secondaryInk, fontSize: 11, lineHeight: 17, marginTop: 3 },
  transcriptTextHighlighted: { color: theme.colors.ink, fontWeight: "600" },
  returnButton: { minHeight: theme.control.minimumHeight, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4, marginTop: 8 },
  returnButtonText: { color: theme.colors.action, fontSize: 11, fontWeight: "800" },
  cardActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9, marginTop: 16 },
  actionButton: { minHeight: theme.control.minimumHeight, borderRadius: theme.radius.small, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  actionPrimary: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  actionSecondary: { backgroundColor: theme.colors.surface, borderColor: theme.colors.ink },
  actionDanger: { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger },
  actionQuiet: { backgroundColor: theme.colors.inset, borderColor: theme.colors.inset },
  actionDisabled: { opacity: 0.42 },
  actionPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  actionText: { color: theme.colors.ink, fontSize: 12, fontWeight: "800" },
  actionTextLight: { color: theme.colors.surface },
  actionTextDanger: { color: theme.colors.danger },
  actionTextQuiet: { color: theme.colors.secondaryInk },
  formPanel: { backgroundColor: theme.colors.inset, borderRadius: theme.radius.medium, padding: 15, marginTop: 16, gap: 12 },
  formTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 17, fontWeight: "700" },
  formHint: { color: theme.colors.tertiaryInk, fontSize: 11, marginTop: -7 },
  field: { gap: 5 },
  fieldLabel: { color: theme.colors.secondaryInk, fontSize: 11, fontWeight: "800" },
  input: { backgroundColor: theme.colors.surface, color: theme.colors.ink, borderWidth: 1, borderColor: theme.colors.rule, borderRadius: theme.radius.small, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 19 },
  rejectPanel: { backgroundColor: theme.colors.dangerWash, borderLeftWidth: 3, borderLeftColor: theme.colors.danger, padding: 14, marginTop: 16 },
  rejectTitle: { color: theme.colors.danger, fontFamily: theme.type.display, fontSize: 17, fontWeight: "700" },
  rejectBody: { color: theme.colors.secondaryInk, fontSize: 12, lineHeight: 18, marginTop: 4 },
  questionCard: { backgroundColor: theme.colors.infoWash, borderLeftWidth: 3, borderLeftColor: theme.colors.info, borderRadius: theme.radius.small, padding: 12, marginTop: 12 },
  questionCardStandalone: { backgroundColor: theme.colors.surface, marginTop: 0 },
  questionTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  questionReceiptLabel: { color: theme.colors.info, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.6 },
  privateStatus: { color: theme.colors.info, fontFamily: theme.type.utility, fontSize: 7, fontWeight: "700", letterSpacing: 0.5 },
  questionReceiptText: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 16, lineHeight: 22, fontWeight: "600", marginTop: 6 },
  questionContext: { color: theme.colors.secondaryInk, fontSize: 11, lineHeight: 17, marginTop: 4 },
  standaloneQuestions: { backgroundColor: theme.colors.infoWash, borderRadius: theme.radius.medium, borderCurve: "continuous", padding: 16, marginTop: 20 },
  standaloneHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  questionSeal: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.info, alignItems: "center", justifyContent: "center" },
  questionSealText: { color: theme.colors.surface, fontFamily: theme.type.display, fontSize: 19, fontWeight: "700" },
  standaloneKicker: { color: theme.colors.info, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  standaloneTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 20, lineHeight: 25, fontWeight: "700", marginTop: 4 },
  standaloneBody: { color: theme.colors.secondaryInk, fontSize: 11, lineHeight: 17, marginTop: 4 },
  standaloneQuestionList: { gap: 12, marginTop: 14 },
  errorBanner: { backgroundColor: theme.colors.dangerWash, borderLeftWidth: 3, borderLeftColor: theme.colors.danger, padding: 13, marginTop: 16 },
  errorTitle: { color: theme.colors.danger, fontSize: 13, fontWeight: "800" },
  errorBody: { color: theme.colors.secondaryInk, fontSize: 12, lineHeight: 18, marginTop: 3 },
  completionNote: { backgroundColor: theme.colors.inset, borderRadius: theme.radius.medium, padding: 16, marginTop: 20, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 },
  completionNoteDone: { backgroundColor: theme.colors.confirmedWash },
  completionMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" },
  completionMarkDone: { backgroundColor: theme.colors.confirmed },
  completionMarkText: { color: theme.colors.surface, fontFamily: theme.type.display, fontSize: 16, fontWeight: "700" },
  completionTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 16, fontWeight: "700" },
  completionBody: { color: theme.colors.secondaryInk, fontSize: 12, lineHeight: 18, marginTop: 3 },
  fixturePill: { alignSelf: "flex-start", minHeight: 28, borderRadius: theme.radius.pill, backgroundColor: theme.colors.infoWash, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  fixtureDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.info },
  fixtureText: { color: theme.colors.info, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.7 },
  loadingPanel: { minHeight: 220, alignItems: "center", flexDirection: "row", gap: 14 },
  loadingTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 19, fontWeight: "600" },
  loadingBody: { color: theme.colors.secondaryInk, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
