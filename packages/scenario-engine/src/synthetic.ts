import {
  beeSourceSchema, sourceEvidenceForUtterance, transcriptSelectionsOverlap, excludedRangesMatchSource, extractInstructionsResponseSchema,
  createPracticeSetResponseSchema, type BeeSource, type ExcludedRange,
  type ExtractInstructionsResponse, type InstructionCard, type SourceEvidence,
} from "@firstday/contracts";
import { ScenarioEngineError, type GenerateStandardPracticeSetInput } from "./index.js";

export function normalizeSyntheticAnswer(text: string): string {
  return text.toLowerCase().trim().replace(/^i (?:will|would)\s+/, "")
    .replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

/** Deliberately bounded offline grammar, not a live speech/LLM extractor. */
export function extractSyntheticInstructions(input: {
  source: BeeSource; sourceConversationId: string; excludedRanges: ExcludedRange[];
  idFactory: () => string; timestamp: string;
}): ExtractInstructionsResponse {
  const source = beeSourceSchema.parse(input.source);
  if (source.sourceKind !== "fixture") throw new ScenarioEngineError("INVALID_STATE", "Synthetic extraction requires fixture data.");
  if (!excludedRangesMatchSource(source, input.excludedRanges)) throw new ScenarioEngineError("INVALID_STATE", "Excluded selections do not match source timing.");
  const sourceEvidence: SourceEvidence[] = [];
  const items: InstructionCard[] = [];
  const openQuestions: ExtractInstructionsResponse["openQuestions"] = [];
  for (const utterance of source.utterances) {
    if (input.excludedRanges.some((range) => transcriptSelectionsOverlap(utterance, range))) continue;
    const match = /^(?:Update:\s*)?(?:When|If|Whenever)\s+([^,]+),\s+(.+?)[.!]?$/i.exec(utterance.text);
    if (!match) continue;
    const evidence = sourceEvidenceForUtterance(input.sourceConversationId, source.revision, utterance);
    sourceEvidence.push(evidence);
    if (/\b(maybe|might|usually|sometimes|probably|not sure)\b/i.test(utterance.text)) {
      openQuestions.push({ id: input.idFactory(), sourceConversationId: input.sourceConversationId,
        sourceRevision: source.revision, question: `What is the confirmed procedure when ${match[1]}?`,
        sourceEvidence: [evidence.id], status: "open", shareConsent: false,
        createdAt: input.timestamp, updatedAt: input.timestamp });
    } else {
      // Finite, visibly fictional reservation example; live extraction uses Nova.
      const conditional=/^(New reservations last (?:three|five) days\.)\s+(Reservations already made keep their original seven-day window\.?)$/i.exec(match[2]!);
      items.push({ id: input.idFactory(), sourceConversationId: input.sourceConversationId,
        sourceRevision: source.revision, text: utterance.text.replace(/^Update:\s*/i, ""),
        situation: match[1]!, expectedAction: conditional?.[1] ?? match[2]!, exceptions: conditional?.[2] ? [conditional[2].endsWith(".") ? conditional[2] : `${conditional[2]}.`] : [], sourceEvidence: [evidence.id],
        confidence: 1, status: "needsReview", createdAt: input.timestamp, updatedAt: input.timestamp });
    }
  }
  return extractInstructionsResponseSchema.parse({ sourceConversationId: input.sourceConversationId,
    sourceRevision: source.revision, instructionRevision: `synthetic:${source.revision}`,
    items, openQuestions, sourceEvidence });
}

export function generateSyntheticPractice(input: GenerateStandardPracticeSetInput) {
  if (input.sourceKind !== "fixture") throw new ScenarioEngineError("INVALID_STATE", "Synthetic practice requires fixture data.");
  if (input.instructions.length !== 3 || new Set(input.instructions.map((item) => item.id)).size !== 3 ||
      input.instructions.some((item) => item.status !== "confirmed" || item.sourceConversationId !== input.sourceConversationId || item.sourceRevision !== input.sourceRevision)) {
    throw new ScenarioEngineError("NO_CONFIRMED_INSTRUCTIONS", "Confirm exactly three instructions from this source.");
  }
  const references = new Set(input.instructions.flatMap((item) => item.sourceEvidence));
  if (new Set(input.sourceEvidence.map((item) => item.id)).size !== input.sourceEvidence.length ||
      [...references].some((id) => !input.sourceEvidence.some((item) => item.id === id && item.sourceConversationId === input.sourceConversationId && item.sourceRevision === input.sourceRevision))) {
    throw new ScenarioEngineError("INVALID_STATE", "Practice evidence must match the confirmed instructions.");
  }
  return createPracticeSetResponseSchema.parse({
    practiceSet: { id: input.practiceSetId, learnerId: input.learnerId,
      sourceConversationId: input.sourceConversationId, sourceRevision: input.sourceRevision,
      sourceKind: "fixture", instructionRevision: input.instructionRevision, title: input.title,
      kind: "standard", status: "ready", scenarioIds: [...input.scenarioIds], createdAt: input.timestamp, updatedAt: input.timestamp },
    scenarios: input.instructions.map((item, index) => ({ id: input.scenarioIds[index],
      practiceSetId: input.practiceSetId, sourceRevision: input.sourceRevision, kind: "standard",
      characterId: "customer-rowan", prompt: `${item.situation.replace(/[.!?]+$/, "")}. What do you do?`,
      context: "Practise the instruction you confirmed from the synthetic training conversation.",
      expectedRuleIds: [item.id], acceptableSignals: [item.expectedAction], criticalMisses: [],
      retryPrompt: "Review the source instruction, then try the action again.",
      sourceEvidence: [...item.sourceEvidence], order: index + 1 })),
    sourceEvidence: input.sourceEvidence.filter((item) => references.has(item.id)),
  });
}
