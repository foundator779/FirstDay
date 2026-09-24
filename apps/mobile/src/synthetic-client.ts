import {
  beeSourceSchema, createTranscriptHash, importConversationRequestSchema, importConversationResponseSchema,
  extractInstructionsRequestSchema, extractInstructionsResponseSchema, updateInstructionRequestSchema,
  updateInstructionResponseSchema, instructionCardSchema, createOpenQuestionRequestSchema, createOpenQuestionResponseSchema,
  createPracticeSetRequestSchema, getPracticeSetResponseSchema, createAttemptRequestSchema,
  createAttemptResponseSchema, compareSourceRequestSchema, compareSourceResponseSchema,
  confirmChangeRequestSchema, confirmChangeResponseSchema, createPracticeSetResponseSchema,
  listBeeConversationsRequestSchema, listBeeConversationsResponseSchema, getBeeConversationRequestSchema,
  getBeeConversationResponseSchema, type BeeSource, type SourceConversation, type ExtractInstructionsResponse,
  type InstructionCard, type SourceEvidence, type ChangeProposal, type CreatePracticeSetResponse,
  type CreateAttemptResponse, type CreatePracticeSetRequestInput, type CreateAttemptRequestInput,
  type CompareSourceRequestInput, type ConfirmChangeRequestInput,
} from "@firstday/contracts";
import { extractSyntheticInstructions, extractFixtureInstructions, generateSyntheticPractice,
  normalizeSyntheticAnswer, BOOKSHOP_FIXTURE_IDS } from "@firstday/scenario-engine";
import onboarding from "../../../fixtures/transcripts/bookshop-onboarding.json";
import bookshopUpdate from "../../../fixtures/transcripts/bookshop-policy-update.json";
import library from "../../../fixtures/transcripts/library-onboarding.json";
import libraryUpdate from "../../../fixtures/transcripts/library-policy-update.json";
import studio from "../../../fixtures/transcripts/studio-onboarding.json";
import studioUpdate from "../../../fixtures/transcripts/studio-policy-update.json";
import { FirstDayClientError, type FirstDayClient } from "./api";

export type PracticeClient = FirstDayClient & {
  createPractice(input: CreatePracticeSetRequestInput): Promise<CreatePracticeSetResponse>;
  getPractice(id: string): Promise<ReturnType<typeof getPracticeSetResponseSchema.parse>>;
  submitAttempt(input: CreateAttemptRequestInput): Promise<CreateAttemptResponse>;
  compareSources(input: CompareSourceRequestInput): Promise<ReturnType<typeof compareSourceResponseSchema.parse>>;
  confirmChange(input: ConfirmChangeRequestInput): Promise<ReturnType<typeof confirmChangeResponseSchema.parse>>;
};

export const SYNTHETIC_SOURCES = [library, libraryUpdate, studio, studioUpdate, onboarding, bookshopUpdate].map((source) => beeSourceSchema.parse(source));
export const SYNTHETIC_UPDATES: Readonly<Record<string, string>> = {
  [library.id]: libraryUpdate.id, [studio.id]: studioUpdate.id, [onboarding.id]: bookshopUpdate.id,
};
const LEARNER = "70000000-0000-4000-8000-000000000001";

function fail(code: ConstructorParameters<typeof FirstDayClientError>[0], message: string): never {
  throw new FirstDayClientError(code, message);
}

/** Session-only fixture implementation. All returned objects are schema-parsed copies. */
export function createSyntheticFirstDayClient(options: { sources?: readonly BeeSource[]; updates?: Readonly<Record<string, string>> } = {}): PracticeClient {
  const sources = (options.sources ?? SYNTHETIC_SOURCES).map((source) => beeSourceSchema.parse(source));
  if (sources.some((source) => source.sourceKind !== "fixture") || new Set(sources.map((source) => source.id)).size !== sources.length) fail("INVALID_STATE", "Synthetic sources must have unique IDs and fixture provenance.");
  const updates = options.updates ?? SYNTHETIC_UPDATES;
  const imports = new Map<string, SourceConversation>();
  const extractions = new Map<string, ExtractInstructionsResponse>();
  const practices = new Map<string, CreatePracticeSetResponse>();
  const attempts = new Map<string, CreateAttemptResponse["attempt"][]>();
  const proposals = new Map<string, ChangeProposal>();
  const comparisonResults = new Map<string, ReturnType<typeof compareSourceResponseSchema.parse>>();
  let sequence = 1;
  const id = () => `90000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const now = () => new Date().toISOString();
  const sourceFor = (sourceId: string) => sources.find((source) => source.id === sourceId) ?? fail("BEE_SOURCE_NOT_FOUND", "Synthetic conversation not found.");
  const importedFor = (sourceId: string) => imports.get(sourceId) ?? fail("RESOURCE_NOT_FOUND", "Import this conversation first.");
  const extractionFor = (sourceId: string) => extractions.get(sourceId) ?? fail("RESOURCE_NOT_FOUND", "Extract this conversation first.");
  const revision = (actual: string, requested: string) => { if (actual !== requested) fail("REVISION_CONFLICT", "This source revision has changed."); };
  const instructionFor = (instructionId: string) => [...extractions.values()].flatMap((value) => value.items).find((item) => item.id === instructionId) ?? fail("RESOURCE_NOT_FOUND", "Instruction not found.");
  const evidenceFor = (references: readonly string[]): SourceEvidence[] => {
    const all = [...extractions.values()].flatMap((value) => value.sourceEvidence);
    return [...new Set(references)].map((ref) => all.find((item) => item.id === ref) ?? fail("INVALID_STATE", "Source evidence is missing."));
  };
  const practiceFor = (practiceId: string) => practices.get(practiceId) ?? fail("RESOURCE_NOT_FOUND", "Practice not found.");

  const client: PracticeClient = {
    async health() { return { ok: true, service: "firstday-api", version: "0.2.0", beeBridge: "unavailable" }; },
    async listConversations(input) {
      const request = listBeeConversationsRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") fail("INVALID_STATE", "Synthetic mode cannot access live Bee data.");
      const offset = request.cursor === undefined ? 0 : Number(request.cursor);
      if (!Number.isSafeInteger(offset) || offset < 0 || (request.cursor !== undefined && String(offset) !== request.cursor)) fail("VALIDATION_ERROR", "Invalid fixture page.");
      const matches = sources.filter((source) => !request.query || source.title.toLowerCase().includes(request.query.toLowerCase()));
      const end = offset + (request.limit ?? 20);
      return listBeeConversationsResponseSchema.parse({ items: matches.slice(offset, end).map(({ id: sourceId, sourceKind, title, startedAt, status, revision: sourceRevision }) => ({ id: sourceId, sourceKind, title, startedAt, status, revision: sourceRevision })), nextCursor: end < matches.length ? String(end) : null });
    },
    async getConversation(input) {
      const request = getBeeConversationRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") fail("INVALID_STATE", "Synthetic mode cannot access live Bee data.");
      return getBeeConversationResponseSchema.parse({ conversation: sourceFor(request.beeSourceId) });
    },
    async importConversation(input) {
      if (input?.consent?.confirmed !== true) fail("CONSENT_REQUIRED", "Confirm consent before importing.");
      const request = importConversationRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") fail("INVALID_STATE", "Synthetic mode cannot import live Bee data.");
      const source = sourceFor(request.beeSourceId);
      revision(source.revision, request.sourceRevision);
      const existing = [...imports.values()].find((item) => item.beeSourceId === source.id);
      const timestamp = now();
      const result = importConversationResponseSchema.parse({ sourceConversation: existing ?? {
        id: id(), learnerId: LEARNER, beeSourceId: source.id, sourceKind: "fixture", title: source.title,
        startedAt: source.startedAt, ...(source.endedAt ? { endedAt: source.endedAt } : {}),
        transcriptHash: createTranscriptHash(source.transcript), sourceRevision: source.revision,
        consentStatus: "confirmed", consentConfirmedAt: timestamp, status: "ready", importedAt: timestamp, updatedAt: timestamp,
      } });
      imports.set(result.sourceConversation.id, result.sourceConversation);
      return importConversationResponseSchema.parse(result);
    },
    async extractInstructions(input) {
      const request = extractInstructionsRequestSchema.parse(input);
      const imported = importedFor(request.sourceConversationId);
      revision(imported.sourceRevision, request.sourceRevision);
      if (extractions.has(imported.id)) fail("INVALID_STATE", "This snapshot was already extracted. Reset the demo to start again.");
      const source = sourceFor(imported.beeSourceId);
      const priorBeeId = Object.entries(updates).find(([, updateId]) => updateId === source.id)?.[0];
      const previous = priorBeeId ? [...imports.values()].find((item) => item.beeSourceId === priorBeeId) : undefined;
      const previousExtraction = previous ? extractions.get(previous.id) : undefined;
      const legacy = source.id === onboarding.id || source.id === bookshopUpdate.id;
      let extraction = legacy ? extractFixtureInstructions(source, {
        sourceConversationId: imported.id, sourceRevision: source.revision, excludedRanges: request.excludedRanges,
        instructionRevision: source.id === onboarding.id ? BOOKSHOP_FIXTURE_IDS.initialInstructionRevision : BOOKSHOP_FIXTURE_IDS.updateInstructionRevision,
        instructionIds: Array.from({ length: source.id === onboarding.id ? 3 : 1 }, id),
        ...(source.id === bookshopUpdate.id && previousExtraction?.items[0] ? { supersedesInstructionId: previousExtraction.items[0].id } : {}), timestamp: now(),
      }) : extractSyntheticInstructions({ source, sourceConversationId: imported.id, excludedRanges: request.excludedRanges, idFactory: id, timestamp: now() });
      if (priorBeeId) {
        if (!previousExtraction) fail("INVALID_STATE", "Review the original training before its policy update.");
        for (const candidate of extraction.items) {
          const matches = previousExtraction.items.filter((item) => item.status === "confirmed" && (candidate.supersedesId === item.id || normalizeSyntheticAnswer(item.situation) === normalizeSyntheticAnswer(candidate.situation)));
          if (matches.length !== 1) fail("INVALID_STATE", "The update must match exactly one confirmed original instruction.");
          candidate.supersedesId = matches[0]!.id;
        }
        // Non-bookshop updates must be explicit in the source, not inferred from unrelated training.
        if (!legacy && extraction.sourceEvidence.some((item) => !/^Update:/i.test(item.quote))) fail("INVALID_STATE", "Mark the synthetic policy change explicitly with Update:.");
      }
      extraction = extractInstructionsResponseSchema.parse(extraction);
      extractions.set(imported.id, extraction);
      return extractInstructionsResponseSchema.parse(extraction);
    },
    async updateInstruction(input) {
      const request = updateInstructionRequestSchema.parse(input);
      const current = instructionFor(request.instructionId);
      revision(current.sourceRevision, request.sourceRevision);
      if (current.status !== "needsReview" || current.supersedesId) fail("INVALID_STATE", "Use change confirmation for updates; reviewed rules are immutable.");
      const { instructionId: _instructionId, sourceRevision: _sourceRevision, ...edits } = request;
      void _instructionId; void _sourceRevision;
      if (Object.entries(edits).every(([key, value]) => JSON.stringify(current[key as keyof InstructionCard]) === JSON.stringify(value))) fail("INVALID_STATE", "Choose a different review decision.");
      const result = updateInstructionResponseSchema.parse({ instruction: { ...current, ...edits, updatedAt: now() } });
      Object.assign(current, result.instruction);
      return updateInstructionResponseSchema.parse(result);
    },
    async createOpenQuestion(input) {
      const request = createOpenQuestionRequestSchema.parse(input);
      const extraction = extractionFor(request.sourceConversationId);
      revision(extraction.sourceRevision, request.sourceRevision);
      if (request.sourceEvidence.some((ref) => !extraction.sourceEvidence.some((item) => item.id === ref))) fail("VALIDATION_ERROR", "Use evidence from this source.");
      if (request.instructionId && !extraction.items.some((item) => item.id === request.instructionId)) fail("RESOURCE_NOT_FOUND", "Instruction not found in this source.");
      const timestamp = now();
      const result = createOpenQuestionResponseSchema.parse({ openQuestion: { ...request, id: id(), status: "open", createdAt: timestamp, updatedAt: timestamp } });
      extraction.openQuestions.push(result.openQuestion);
      return createOpenQuestionResponseSchema.parse(result);
    },
    async createPractice(input) {
      const request = createPracticeSetRequestSchema.parse(input);
      const extraction = extractionFor(request.sourceConversationId);
      revision(extraction.sourceRevision, request.sourceRevision);
      if ([...practices.values()].some((value) => value.practiceSet.sourceConversationId === request.sourceConversationId && value.practiceSet.kind === "standard")) fail("INVALID_STATE", "This training already has a practice set.");
      const instructions = request.instructionIds.map((instructionId) => instructionFor(instructionId));
      const result = generateSyntheticPractice({ ...request, learnerId: LEARNER, sourceKind: "fixture",
        instructionRevision: extraction.instructionRevision, instructions, sourceEvidence: evidenceFor(instructions.flatMap((item) => item.sourceEvidence)),
        practiceSetId: id(), scenarioIds: [id(), id(), id()], timestamp: now() });
      practices.set(result.practiceSet.id, result);
      return createPracticeSetResponseSchema.parse(result);
    },
    async getPractice(practiceId) {
      const practice = practiceFor(practiceId);
      const instructionIds = [...new Set(practice.scenarios.flatMap((scenario) => scenario.expectedRuleIds))];
      let changeProposal: ChangeProposal | undefined;
      if (practice.practiceSet.kind === "changeDrill") {
        const proposal = [...proposals.values()].find((item) => instructionIds.includes(item.replacementInstruction.id));
        if (proposal) { instructionIds.push(proposal.previousInstructionId); changeProposal = proposal; }
      }
      const completed = new Set((attempts.get(practiceId) ?? []).filter((attempt) => attempt.result === "covered").map((attempt) => attempt.scenarioId)).size;
      return getPracticeSetResponseSchema.parse({ ...practice, ...(changeProposal ? { changeProposal } : {}), instructions: instructionIds.map(instructionFor), progress: { completed, total: practice.scenarios.length } });
    },
    async submitAttempt(input) {
      const request = createAttemptRequestSchema.parse(input);
      const practice = [...practices.values()].find((value) => value.scenarios.some((scenario) => scenario.id === request.scenarioId)) ?? fail("RESOURCE_NOT_FOUND", "Scenario not found.");
      const scenario = practice.scenarios.find((item) => item.id === request.scenarioId)!;
      const set = practice.practiceSet;
      revision(set.sourceRevision, request.sourceRevision); revision(set.instructionRevision, request.instructionRevision);
      if (set.status === "stale") fail("STALE_PRACTICE_SET", "The instruction changed. Open the updated drill.");
      if (set.status === "complete") fail("INVALID_STATE", "This practice is complete.");
      const prior = attempts.get(set.id) ?? [];
      if (prior.some((attempt) => attempt.scenarioId === scenario.id && attempt.result === "covered")) fail("INVALID_STATE", "This scenario is already covered.");
      const rule = instructionFor(scenario.expectedRuleIds[0]!);
      const proposal = scenario.kind === "changeDrill" ? [...proposals.values()].find((item) => item.status === "confirmed" && item.replacementInstruction.id === rule.id) : undefined;
      const instructions = proposal ? [instructionFor(proposal.previousInstructionId), rule] : [rule];
      const covered = normalizeSyntheticAnswer(request.responseText) === normalizeSyntheticAnswer(rule.expectedAction);
      const outdated = proposal !== undefined && normalizeSyntheticAnswer(request.responseText) === normalizeSyntheticAnswer(instructionFor(proposal.previousInstructionId).expectedAction);
      const missed = outdated || /^(?:i (?:do not|don't) know|skip)$/i.test(request.responseText.trim());
      const result = covered ? "covered" : missed ? "missed" : "needsReview";
      const completed = new Set(prior.filter((attempt) => attempt.result === "covered").map((attempt) => attempt.scenarioId));
      if (covered) completed.add(scenario.id);
      const timestamp = now();
      const response = createAttemptResponseSchema.parse({ practiceSet: { ...set,
        status: completed.size === set.scenarioIds.length ? "complete" : completed.size ? "inProgress" : "ready", updatedAt: timestamp },
        scenario, instructions, ...(proposal ? { changeProposal: proposal } : {}), sourceEvidence: evidenceFor(scenario.sourceEvidence),
        attempt: { id: id(), scenarioId: scenario.id, sourceRevision: set.sourceRevision, instructionRevision: set.instructionRevision,
          responseText: request.responseText, inputMode: request.inputMode, matchedRuleIds: covered ? [rule.id] : [], missedRuleIds: covered ? [] : [rule.id],
          sourceEvidence: scenario.sourceEvidence, result, feedback: covered ? `Covered the confirmed action: ${rule.expectedAction}` :
            `${outdated ? "That is the previous rule. " : ""}Review the confirmed action: ${rule.expectedAction}. ${missed ? "Try it again." : "This offline demo cannot confidently assess different wording."}`, createdAt: timestamp },
        nextAction: covered ? completed.size === set.scenarioIds.length ? "complete" : "continue" : missed ? "retry" : "reviewSource" });
      practice.practiceSet = response.practiceSet;
      attempts.set(set.id, [...prior, response.attempt]);
      return createAttemptResponseSchema.parse(response);
    },
    async compareSources(input) {
      const request = compareSourceRequestSchema.parse(input);
      const previous = extractionFor(request.sourceConversationId);
      const next = extractionFor(request.newSourceConversationId);
      revision(previous.instructionRevision, request.previousInstructionRevision);
      const oldSource = importedFor(request.sourceConversationId);
      const newSource = importedFor(request.newSourceConversationId);
      if (updates[oldSource.beeSourceId] !== newSource.beeSourceId) fail("INVALID_STATE", "These synthetic sources are not an explicit training/update pair.");
      const key = `${previous.sourceConversationId}:${next.sourceConversationId}`;
      const cached = comparisonResults.get(key);
      if (cached) return compareSourceResponseSchema.parse(cached);
      const changes: ChangeProposal[] = [];
      for (const candidate of next.items) {
        const old = previous.items.find((item) => item.id === candidate.supersedesId && item.status === "confirmed");
        if (!old || candidate.status !== "needsReview") fail("INVALID_STATE", "An update needs a current confirmed original instruction.");
        if (normalizeSyntheticAnswer(old.expectedAction) === normalizeSyntheticAnswer(candidate.expectedAction)) continue;
        const timestamp = now();
        changes.push({ id: id(), previousInstructionId: old.id, previousSourceRevision: old.sourceRevision,
          previousSourceEvidence: [...old.sourceEvidence], replacementInstruction: instructionCardSchema.parse(candidate),
          sourceRevision: candidate.sourceRevision, status: "needsReview", createdAt: timestamp, updatedAt: timestamp });
      }
      const result = compareSourceResponseSchema.parse({ previousSourceConversationId: previous.sourceConversationId,
        newSourceConversationId: next.sourceConversationId, previousInstructionRevision: previous.instructionRevision, changes,
        sourceEvidence: evidenceFor(changes.flatMap((item) => [...item.previousSourceEvidence, ...item.replacementInstruction.sourceEvidence])) });
      for (const proposal of result.changes) proposals.set(proposal.id, proposal);
      comparisonResults.set(key, result);
      return compareSourceResponseSchema.parse(result);
    },
    async confirmChange(input) {
      const request = confirmChangeRequestSchema.parse(input);
      const proposal = proposals.get(request.changeId) ?? fail("RESOURCE_NOT_FOUND", "Change not found.");
      revision(proposal.sourceRevision, request.sourceRevision);
      const old = instructionFor(proposal.previousInstructionId);
      const candidate = instructionFor(proposal.replacementInstruction.id);
      if (proposal.status !== "needsReview" || old.status !== "confirmed" || candidate.status !== "needsReview") fail("INVALID_STATE", "This change was already decided.");
      const timestamp = now();
      const previousInstruction = { ...old, status: "changed" as const, updatedAt: timestamp };
      const replacementInstruction = { ...candidate, status: "confirmed" as const, updatedAt: timestamp };
      const changeProposal = { ...proposal, replacementInstruction, status: "confirmed" as const, updatedAt: timestamp };
      const practiceId = id(); const scenarioId = id();
      const references = [...old.sourceEvidence, ...candidate.sourceEvidence];
      const stalePracticeSetIds = [...practices.values()].filter((value) => value.scenarios.some((scenario) => scenario.expectedRuleIds.includes(old.id))).map((value) => value.practiceSet.id);
      const response = confirmChangeResponseSchema.parse({ changeProposal, previousInstruction, replacementInstruction, stalePracticeSetIds,
        changeDrill: { practiceSet: { id: practiceId, learnerId: LEARNER, sourceConversationId: candidate.sourceConversationId,
          sourceRevision: candidate.sourceRevision, sourceKind: "fixture", title: "What changed?", kind: "changeDrill",
          instructionRevision: extractionFor(candidate.sourceConversationId).instructionRevision, status: "ready", scenarioIds: [scenarioId], createdAt: timestamp, updatedAt: timestamp },
          scenarios: [{ id: scenarioId, practiceSetId: practiceId, sourceRevision: candidate.sourceRevision, kind: "changeDrill", characterId: "guide-maya",
            prompt: `${candidate.situation.replace(/[.!?]+$/, "")}. What is the updated action?`, context: "The earlier instruction changed. Use the new confirmed source.",
            expectedRuleIds: [candidate.id], acceptableSignals: [candidate.expectedAction], criticalMisses: [old.expectedAction], retryPrompt: "Compare the earlier and updated source, then try again.", sourceEvidence: references, order: 1 }] },
        sourceEvidence: evidenceFor(references) });
      Object.assign(old, previousInstruction); Object.assign(candidate, replacementInstruction); Object.assign(proposal, changeProposal);
      for (const staleId of stalePracticeSetIds) { const set = practiceFor(staleId).practiceSet; set.status = "stale"; set.updatedAt = timestamp; }
      practices.set(practiceId, { ...response.changeDrill, sourceEvidence: response.sourceEvidence });
      return confirmChangeResponseSchema.parse(response);
    },
  };
  return client;
}
