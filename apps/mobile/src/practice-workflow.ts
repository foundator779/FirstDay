import { beeSourceSchema, compareSourceResponseSchema, extractInstructionsRequestSchema, type BeeSource, type ExcludedRange, type InstructionCard, type SourceConversation, type SourceSessionResponse } from "@firstday/contracts";
import type { PracticeClient } from "./synthetic-client";
import { countIncludedUtterances } from "./review-evidence";

export type UpdateCheckpoint = { source?: SourceConversation; extracted?: boolean; reviewIdentity?: string; excludedRanges?: ExcludedRange[]; confirmedCount?: number };
export type UpdateReview = {
  previousSource: SourceConversation;
  previousInstructionRevision: string;
  update: BeeSource;
  excludedRanges: ExcludedRange[];
  consentConfirmed: boolean;
};

export function practiceSelection(rules: readonly InstructionCard[], selection: readonly string[] | null) {
  const confirmed = rules.filter((rule) => rule.status === "confirmed");
  const available = new Set(confirmed.map((rule) => rule.id));
  const requested = selection ?? (confirmed.length <= 3 ? [...available] : []);
  const ids = [...new Set(requested)].filter((id) => available.has(id));
  return { ready: ids.length === 3, remaining: Math.max(0, 3 - ids.length), ids };
}

export function rehearsedInstructions(rules: readonly InstructionCard[], scenarios: readonly { expectedRuleIds: string[] }[]): InstructionCard[] {
  const ids = new Set(scenarios.flatMap((scenario) => scenario.expectedRuleIds));
  return rules.filter((rule) => ids.has(rule.id));
}

export function updateCandidates<T extends { id: string; sourceKind: string; status: string }>(items: readonly T[], source: Pick<SourceConversation, "beeSourceId" | "sourceKind">): T[] {
  return items.filter((item) => item.id !== source.beeSourceId && item.sourceKind === source.sourceKind && item.status === "processed");
}

export function restoredComparison(session: SourceSessionResponse, previousSourceId: string, previousInstructionRevision: string) {
  const relevant = session.changes.filter((change) => change.previousSourceEvidence.some((id) => session.sourceEvidence.some((e) => e.id === id && e.sourceConversationId === previousSourceId)));
  const newest = relevant.at(-1);
  if (!newest) return null;
  const group = relevant.filter((c) => c.replacementInstruction.sourceConversationId === newest.replacementInstruction.sourceConversationId);
  const changes = group.filter((c) => c.status === "needsReview");
  const references = new Set(changes.flatMap((c) => [...c.previousSourceEvidence, ...c.replacementInstruction.sourceEvidence]));
  return { comparison: compareSourceResponseSchema.parse({ previousSourceConversationId: previousSourceId, newSourceConversationId: newest.replacementInstruction.sourceConversationId, previousInstructionRevision, changes, sourceEvidence: session.sourceEvidence.filter((e) => references.has(e.id)) }), confirmedCount: group.filter((c) => c.status === "confirmed").length };
}

/** Successful stages survive a later failure; completed extraction is never repeated. */
export async function compareTrainingUpdate(client: PracticeClient, review: UpdateReview, checkpoint: UpdateCheckpoint): ReturnType<PracticeClient["compareSources"]> {
  if (!review.consentConfirmed) throw new Error("Confirm permission to use this conversation first.");
  const update = beeSourceSchema.parse(review.update);
  const previous = review.previousSource;
  if (update.id === previous.beeSourceId || update.sourceKind !== previous.sourceKind) throw new Error("Choose a different processed conversation of the same source kind.");
  extractInstructionsRequestSchema.parse({ sourceConversationId: previous.id, sourceRevision: update.revision, excludedRanges: review.excludedRanges });
  if (countIncludedUtterances(update.utterances, review.excludedRanges) === 0) throw new Error("Include at least one training passage.");
  const reviewIdentity = JSON.stringify([previous.id, review.previousInstructionRevision, update.id, update.sourceKind, update.revision, review.excludedRanges]);
  if (checkpoint.reviewIdentity !== undefined && checkpoint.reviewIdentity !== reviewIdentity) throw new Error("The review changed. Choose the conversation again before comparing.");
  checkpoint.reviewIdentity = reviewIdentity;
  if (!checkpoint.source) {
    const imported = await client.importConversation({ beeSourceId: update.id, sourceKind: update.sourceKind, sourceRevision: update.revision, consent: { confirmed: true } });
    checkpoint.source = imported.sourceConversation;
  }
  if (!checkpoint.extracted) {
    const saved = await client.getSourceSession(checkpoint.source.id);
    if (saved.extraction) {
      checkpoint.excludedRanges = saved.excludedRanges;
      const canonicalRanges = (ranges: ExcludedRange[]) => JSON.stringify([...ranges].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs));
      if (canonicalRanges(saved.excludedRanges) !== canonicalRanges(review.excludedRanges)) {
        delete checkpoint.reviewIdentity;
        throw new Error("This conversation already has a saved review. Check its saved passages before comparing.");
      }
      const restored = restoredComparison(saved, previous.id, review.previousInstructionRevision);
      if (restored) {
        checkpoint.extracted = true; checkpoint.confirmedCount = restored.confirmedCount;
        return restored.comparison;
      }
    } else {
      await client.extractInstructions(extractInstructionsRequestSchema.parse({ sourceConversationId: checkpoint.source.id, sourceRevision: update.revision, excludedRanges: review.excludedRanges }));
    }
    checkpoint.extracted = true;
  }
  return client.compareSources({ sourceConversationId: previous.id, newSourceConversationId: checkpoint.source.id, previousInstructionRevision: review.previousInstructionRevision });
}
