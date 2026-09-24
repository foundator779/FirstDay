import type {
  BeeSource,
  BeeUtterance,
  ExcludedRange,
  InstructionCard,
  OpenQuestion,
  SourceEvidence,
} from "@firstday/contracts";

type TimeRange = Pick<ExcludedRange, "startMs" | "endMs">;

export function halfOpenRangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

export function isUtteranceExcluded(
  utterance: BeeUtterance,
  excludedRanges: readonly ExcludedRange[],
): boolean {
  return excludedRanges.some((range) => halfOpenRangesOverlap(utterance, range));
}

export function countIncludedUtterances(
  utterances: readonly BeeUtterance[],
  excludedRanges: readonly ExcludedRange[],
): number {
  return utterances.filter((utterance) => !isUtteranceExcluded(utterance, excludedRanges)).length;
}

export function buildReviewSections(
  instructions: readonly InstructionCard[],
  questions: readonly OpenQuestion[],
): {
  cards: { instruction: InstructionCard; questions: OpenQuestion[] }[];
  standaloneQuestions: OpenQuestion[];
} {
  return {
    cards: instructions.map((instruction) => ({
      instruction,
      questions: questions.filter(({ instructionId }) => instructionId === instruction.id),
    })),
    standaloneQuestions: questions.filter(({ instructionId }) => instructionId === undefined),
  };
}

export function evidenceSourceIdentity(source: BeeSource, evidence: SourceEvidence) {
  return {
    title: source.title,
    sourceKind: source.sourceKind,
    beeSourceId: source.id,
    sourceConversationId: evidence.sourceConversationId,
    sourceRevision: evidence.sourceRevision,
  };
}

function formatTranscriptTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function formatEvidenceSpan(evidence: TimeRange): string {
  return `${formatTranscriptTime(evidence.startMs)}–${formatTranscriptTime(evidence.endMs)}`;
}

export function evidenceTranscriptRows(
  utterances: readonly BeeUtterance[],
  evidence: readonly SourceEvidence[],
): { utterance: BeeUtterance; highlighted: boolean }[] {
  return utterances.map((utterance) => ({
    utterance,
    highlighted: evidence.some((item) => halfOpenRangesOverlap(utterance, item)),
  }));
}

export function resolveEvidence(
  references: readonly SourceEvidence["id"][],
  bundle: readonly SourceEvidence[],
): SourceEvidence[] {
  const byId = new Map(bundle.map((evidence) => [evidence.id, evidence]));
  return references.flatMap((id) => {
    const evidence = byId.get(id);
    return evidence === undefined ? [] : [evidence];
  });
}
