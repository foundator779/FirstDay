import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  compareSourceRequestSchema, compareSourceResponseSchema, confirmChangeRequestSchema, confirmChangeResponseSchema,
  type ChangeProposal,
  attemptSchema,
  beeIdSchema,
  beeSourceSchema,
  createAttemptRequestSchema,
  createAttemptResponseSchema,
  createSourceEvidenceId,
  createOpenQuestionRequestSchema,
  createPracticeSetRequestSchema,
  createPracticeSetResponseSchema,
  extractInstructionsRequestSchema,
  extractInstructionsResponseSchema,
  getPracticeSetResponseSchema,
  instructionRevisionSchema,
  instructionCardSchema,
  isoUtcDateTimeSchema,
  openQuestionSchema,
  practiceSetSchema,
  revokeConsentResponseSchema,
  sourceConversationSchema,
  sourceEvidenceSchema,
  sourceKindSchema,
  sourceRevisionSchema,
  updateInstructionRequestSchema,
  updateOpenQuestionRequestSchema,
  uuidSchema,
  type Attempt,
  type BeeSource,
  type CreateAttemptRequest,
  type CreatePracticeSetRequest,
  type ExcludedRange,
  type ExtractInstructionsResponse,
  type InstructionCard,
  type OpenQuestion,
  type PracticeSet,
  type Scenario,
  type SourceEvidence,
  type SourceConversation,
} from "@firstday/contracts";
import { BOOKSHOP_FIXTURE_IDS } from "@firstday/scenario-engine";

import { ApiError, InvalidDependencyOutputError } from "./errors.js";
import type {
  AttemptContext,
  CreateOpenQuestionInput,
  ExtractionContext,
  ExtractionInstructionContext,
  FirstDayRepository,
  ImportSourceInput,
  PracticeSetLookup,
  PrepareAttemptInput,
  PrepareStandardPracticeInput,
  RevokeConsentInput,
  SaveExtractionInput,
  SaveAttemptInput,
  SourceLookup,
  SourceProcessingContext,
  SourceRevisionLookup,
  StandardPracticeContext,
  UpdateInstructionInput,
  UpdateOpenQuestionInput,
  SaveStandardPracticeInput,
} from "./repository.js";

type ConsentEvent = {
  learnerId: string;
  sourceConversationId: string;
  sourceRevision: string;
  status: "confirmed" | "revoked";
  reason?: string;
  timestamp: string;
};

type StoredExtraction = {
  learnerId: string;
  sourceConversationId: string;
  sourceRevision: string;
  instructionRevision: string;
  instructionIds: string[];
  openQuestionIds: string[];
  sourceEvidenceIds: string[];
  previousInstructionRevision?: string;
};

type StoredInstruction = {
  learnerId: string;
  instructionRevision: string;
  instruction: InstructionCard;
};

type StoredEvidence = {
  learnerId: string;
  evidence: SourceEvidence;
};

type StoredOpenQuestion = {
  learnerId: string;
  openQuestion: OpenQuestion;
};

type StoredPractice = {
  changeId?: string;
  learnerId: string;
  practiceSet: PracticeSet;
  instructionIds: string[];
  sourceEvidenceIds: string[];
};

type StoredScenario = {
  learnerId: string;
  scenario: Scenario;
};

type StoredAttempt = {
  learnerId: string;
  attempt: Attempt;
};

type MemoryState = {
  changes: Map<string, ChangeProposal>;
  sources: Map<string, SourceConversation>;
  sourceIdentity: Map<string, string>;
  sourceMaterials: Map<string, BeeSource>;
  extractionInputs: Map<string, { excludedRanges: ExcludedRange[] }>;
  extractions: Map<string, StoredExtraction>;
  instructions: Map<string, StoredInstruction>;
  evidence: Map<string, StoredEvidence>;
  openQuestions: Map<string, StoredOpenQuestion>;
  practiceSets: Map<string, StoredPractice>;
  standardPracticeBySource: Map<string, string>;
  scenarios: Map<string, StoredScenario>;
  attempts: Map<string, StoredAttempt>;
  attemptIdsByScenario: Map<string, string[]>;
  consentEvents: ConsentEvent[];
};

function initialState(): MemoryState {
  return {
    changes: new Map(),
    sources: new Map(),
    sourceIdentity: new Map(),
    sourceMaterials: new Map(),
    extractionInputs: new Map(),
    extractions: new Map(),
    instructions: new Map(),
    evidence: new Map(),
    openQuestions: new Map(),
    practiceSets: new Map(),
    standardPracticeBySource: new Map(),
    scenarios: new Map(),
    attempts: new Map(),
    attemptIdsByScenario: new Map(),
    consentEvents: [],
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function recordKey(learnerId: string, id: string): string {
  return JSON.stringify([learnerId, id]);
}

function standardPracticeKey(
  learnerId: string,
  sourceConversationId: string,
  sourceRevision: string,
): string {
  return JSON.stringify([learnerId, sourceConversationId, sourceRevision, "standard"]);
}

function identityKey(learnerId: string, source: BeeSource): string {
  return JSON.stringify([learnerId, source.sourceKind, source.id, source.revision]);
}

function transcriptHash(source: BeeSource): string {
  return createHash("sha256").update(source.transcript, "utf8").digest("hex");
}

function sourceOrNotFound(state: MemoryState, lookup: SourceLookup): SourceConversation {
  const source = state.sources.get(recordKey(lookup.learnerId, lookup.sourceConversationId));
  if (source === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return source;
}

function assertRevision(source: SourceConversation, revision: string): void {
  if (source.sourceRevision !== revision) throw new ApiError("REVISION_CONFLICT");
}

function sourceForProcessing(
  state: MemoryState,
  lookup: SourceRevisionLookup,
): SourceProcessingContext {
  const sourceConversation = sourceOrNotFound(state, lookup);
  assertRevision(sourceConversation, lookup.sourceRevision);
  if (sourceConversation.consentStatus === "revoked") {
    throw new ApiError("CONSENT_REVOKED");
  }
  if (sourceConversation.status !== "ready") throw new ApiError("SOURCE_NOT_READY");
  const source = state.sourceMaterials.get(
    recordKey(lookup.learnerId, lookup.sourceConversationId),
  );
  if (source === undefined) throw new ApiError("CONSENT_REVOKED");
  return { sourceConversation, source };
}

function instructionOrNotFound(
  state: MemoryState,
  learnerId: string,
  instructionId: string,
): StoredInstruction {
  const instruction = state.instructions.get(recordKey(learnerId, instructionId));
  if (instruction === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return instruction;
}

function questionOrNotFound(
  state: MemoryState,
  learnerId: string,
  openQuestionId: string,
): StoredOpenQuestion {
  const question = state.openQuestions.get(recordKey(learnerId, openQuestionId));
  if (question === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return question;
}

function evidenceOrNotFound(
  state: MemoryState,
  learnerId: string,
  evidenceId: string,
): StoredEvidence {
  const evidence = state.evidence.get(recordKey(learnerId, evidenceId));
  if (evidence === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return evidence;
}

function practiceOrNotFound(
  state: MemoryState,
  learnerId: string,
  practiceSetId: string,
): StoredPractice {
  const practice = state.practiceSets.get(recordKey(learnerId, practiceSetId));
  if (practice === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return practice;
}

function scenarioOrNotFound(
  state: MemoryState,
  learnerId: string,
  scenarioId: string,
): StoredScenario {
  const scenario = state.scenarios.get(recordKey(learnerId, scenarioId));
  if (scenario === undefined) throw new ApiError("RESOURCE_NOT_FOUND");
  return scenario;
}

function attemptsForScenario(
  state: MemoryState,
  learnerId: string,
  scenarioId: string,
): Attempt[] {
  return (state.attemptIdsByScenario.get(recordKey(learnerId, scenarioId)) ?? []).map(
    (attemptId) => {
      const stored = state.attempts.get(recordKey(learnerId, attemptId));
      if (
        stored === undefined ||
        stored.learnerId !== learnerId ||
        stored.attempt.scenarioId !== scenarioId
      ) {
        throw new InvalidDependencyOutputError();
      }
      return stored.attempt;
    },
  );
}

function hasCoveredAttempt(
  state: MemoryState,
  learnerId: string,
  scenarioId: string,
): boolean {
  return attemptsForScenario(state, learnerId, scenarioId).some(
    ({ result }) => result === "covered",
  );
}

function completedScenarioCount(
  state: MemoryState,
  learnerId: string,
  scenarioIds: readonly string[],
): number {
  return scenarioIds.filter((scenarioId) =>
    hasCoveredAttempt(state, learnerId, scenarioId)
  ).length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return values.size === left.length && right.every((value) => values.has(value));
}

function rangesOverlap(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function assertExtractionEvidenceLinks(extraction: ExtractInstructionsResponse): void {
  const availableIds = extraction.sourceEvidence.map(({ id }) => id);
  const referencedIds = [
    ...extraction.items,
    ...extraction.openQuestions,
  ].flatMap(({ sourceEvidence }) => sourceEvidence);
  if (!sameStringSet(availableIds, [...new Set(referencedIds)])) {
    throw new InvalidDependencyOutputError();
  }
}

function assertEvidenceMatchesSource(input: {
  evidence: SourceEvidence;
  source: BeeSource;
  sourceConversationId: string;
  sourceRevision: string;
  excludedRanges: readonly ExcludedRange[];
}): void {
  const { evidence, source, sourceConversationId, sourceRevision, excludedRanges } = input;
  if (
    evidence.sourceConversationId !== sourceConversationId ||
    evidence.sourceRevision !== sourceRevision ||
    excludedRanges.some((range) => rangesOverlap(evidence, range))
  ) {
    throw new InvalidDependencyOutputError();
  }

  const utterances = source.utterances.filter((utterance) => rangesOverlap(evidence, utterance));
  const first = utterances[0];
  const last = utterances.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    evidence.startMs !== first.startMs ||
    evidence.endMs !== last.endMs ||
    !sameStringSet(
      evidence.utteranceIds,
      utterances.map(({ id }) => id),
    ) ||
    evidence.utteranceIds.some((id, index) => id !== utterances[index]?.id) ||
    evidence.quote !== utterances.map(({ text }) => text).join("\n")
  ) {
    throw new InvalidDependencyOutputError();
  }

  const speakerLabels = new Set(utterances.map(({ speaker }) => speaker?.label));
  const expectedSpeakerLabel = speakerLabels.size === 1 ? first.speaker?.label : undefined;
  if (evidence.speakerLabel !== expectedSpeakerLabel) {
    throw new InvalidDependencyOutputError();
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseExtractionInstructionContext(value: unknown): ExtractionInstructionContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidDependencyOutputError();
  }
  const record = value as Record<string, unknown>;
  const sourceIdentityValue = record.sourceIdentity;
  if (
    typeof sourceIdentityValue !== "object" ||
    sourceIdentityValue === null ||
    Array.isArray(sourceIdentityValue)
  ) {
    throw new InvalidDependencyOutputError();
  }
  const sourceIdentityRecord = sourceIdentityValue as Record<string, unknown>;
  const instructionRevision = instructionRevisionSchema.safeParse(record.instructionRevision);
  const id = uuidSchema.safeParse(sourceIdentityRecord.id);
  const beeSourceId = beeIdSchema.safeParse(sourceIdentityRecord.beeSourceId);
  const sourceKind = sourceKindSchema.safeParse(sourceIdentityRecord.sourceKind);
  const sourceRevision = sourceRevisionSchema.safeParse(sourceIdentityRecord.sourceRevision);
  if (
    !instructionRevision.success ||
    !id.success ||
    !beeSourceId.success ||
    !sourceKind.success ||
    !sourceRevision.success ||
    !Array.isArray(record.sourceEvidence) ||
    record.sourceEvidence.length > 500
  ) {
    throw new InvalidDependencyOutputError();
  }
  const sourceEvidence = record.sourceEvidence.map((value) => {
    const parsed = sourceEvidenceSchema.safeParse(value);
    if (!parsed.success) throw new InvalidDependencyOutputError();
    return parsed.data;
  });
  return {
    instructionRevision: instructionRevision.data,
    sourceIdentity: {
      id: id.data,
      beeSourceId: beeSourceId.data,
      sourceKind: sourceKind.data,
      sourceRevision: sourceRevision.data,
    },
    sourceEvidence,
  };
}

function exactFixtureUpdateSupersedesId(
  trustedLineage: Readonly<Record<string, unknown>>,
): string {
  const candidates = Object.entries(trustedLineage).flatMap(([instructionIdValue, value]) => {
    const instructionId = uuidSchema.safeParse(instructionIdValue);
    if (!instructionId.success) throw new InvalidDependencyOutputError();
    const context = parseExtractionInstructionContext(value);
    if (
      context.instructionRevision !== BOOKSHOP_FIXTURE_IDS.initialInstructionRevision ||
      context.sourceIdentity.sourceKind !== "fixture" ||
      context.sourceIdentity.beeSourceId !== BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId ||
      context.sourceIdentity.sourceRevision !== BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision ||
      context.sourceEvidence.length !== 1
    ) {
      return [];
    }
    const expectedEvidenceId = createSourceEvidenceId({
      sourceConversationId: context.sourceIdentity.id,
      sourceRevision: context.sourceIdentity.sourceRevision,
      startMs: 10_800,
      endMs: 17_400,
    });
    return context.sourceEvidence[0]?.id === expectedEvidenceId ? [instructionId.data] : [];
  });
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new InvalidDependencyOutputError();
  }
  return candidates[0];
}

function assertSupersedesLineage(input: {
  grounded?: boolean;
  state: MemoryState;
  learnerId: string;
  currentSource: BeeSource;
  supersedesId: string;
  trustedContext: unknown;
}): string {
  const { state, learnerId, currentSource, supersedesId } = input;
  const trustedContext = parseExtractionInstructionContext(input.trustedContext);
  const previous = state.instructions.get(recordKey(learnerId, supersedesId));
  if (
    previous === undefined ||
    previous.instruction.status !== "confirmed" ||
    previous.instructionRevision !== trustedContext.instructionRevision ||
    previous.instruction.sourceConversationId !== trustedContext.sourceIdentity.id ||
    previous.instruction.sourceRevision !== trustedContext.sourceIdentity.sourceRevision
  ) {
    throw new InvalidDependencyOutputError();
  }

  if (input.grounded && (currentSource.sourceKind !== trustedContext.sourceIdentity.sourceKind || currentSource.id === trustedContext.sourceIdentity.beeSourceId)) throw new InvalidDependencyOutputError();
  if (!input.grounded && (
    currentSource.sourceKind !== "fixture" ||
    currentSource.id !== BOOKSHOP_FIXTURE_IDS.updateBeeSourceId ||
    currentSource.revision !== BOOKSHOP_FIXTURE_IDS.updateSourceRevision ||
    trustedContext.instructionRevision !== BOOKSHOP_FIXTURE_IDS.initialInstructionRevision ||
    trustedContext.sourceIdentity.sourceKind !== "fixture" ||
    trustedContext.sourceIdentity.beeSourceId !== BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId ||
    trustedContext.sourceIdentity.sourceRevision !== BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision
  )) {
    throw new InvalidDependencyOutputError();
  }

  const previousProcessing = sourceForProcessing(state, {
    learnerId,
    sourceConversationId: previous.instruction.sourceConversationId,
    sourceRevision: previous.instruction.sourceRevision,
  });
  const previousSource = previousProcessing.sourceConversation;
  if (
    previousSource.id !== trustedContext.sourceIdentity.id ||
    previousSource.beeSourceId !== trustedContext.sourceIdentity.beeSourceId ||
    previousSource.sourceKind !== trustedContext.sourceIdentity.sourceKind ||
    previousSource.sourceRevision !== trustedContext.sourceIdentity.sourceRevision
  ) {
    throw new InvalidDependencyOutputError();
  }

  const expectedEvidenceId = createSourceEvidenceId({
    sourceConversationId: previousSource.id,
    sourceRevision: previousSource.sourceRevision,
    startMs: 10_800,
    endMs: 17_400,
  });
  const trustedEvidenceIds = trustedContext.sourceEvidence.map(({ id }) => id);
  if (
    !sameStringArray(previous.instruction.sourceEvidence, trustedEvidenceIds) ||
    (!input.grounded && (trustedEvidenceIds.length !== 1 || trustedEvidenceIds[0] !== expectedEvidenceId))
  ) {
    throw new InvalidDependencyOutputError();
  }
  const previousInput = state.extractionInputs.get(recordKey(learnerId, previousSource.id));
  if (previousInput === undefined) throw new InvalidDependencyOutputError();
  for (const trustedEvidence of trustedContext.sourceEvidence) {
    const persistedEvidence = state.evidence.get(recordKey(learnerId, trustedEvidence.id));
    if (
      persistedEvidence === undefined ||
      !isDeepStrictEqual(persistedEvidence.evidence, trustedEvidence)
    ) {
      throw new InvalidDependencyOutputError();
    }
    assertEvidenceMatchesSource({
      evidence: persistedEvidence.evidence,
      source: previousProcessing.source,
      sourceConversationId: previousSource.id,
      sourceRevision: previousSource.sourceRevision,
      excludedRanges: previousInput.excludedRanges,
    });
  }
  return previous.instructionRevision;
}

function standardPracticeContext(
  state: MemoryState,
  learnerId: string,
  request: CreatePracticeSetRequest,
): StandardPracticeContext {
  const processing = sourceForProcessing(state, { learnerId, ...request });
  if (
    state.standardPracticeBySource.has(
      standardPracticeKey(learnerId, request.sourceConversationId, request.sourceRevision),
    )
  ) {
    throw new ApiError("INVALID_STATE");
  }

  const storedInstructions = request.instructionIds.map((instructionId) => {
    const stored = instructionOrNotFound(state, learnerId, instructionId);
    if (
      stored.instruction.sourceConversationId !== request.sourceConversationId ||
      stored.instruction.sourceRevision !== request.sourceRevision
    ) {
      throw new ApiError("RESOURCE_NOT_FOUND");
    }
    return stored;
  });
  if (storedInstructions.some(({ instruction }) => instruction.status !== "confirmed")) {
    throw new ApiError("NO_CONFIRMED_INSTRUCTIONS");
  }
  const instructionRevisions = new Set(
    storedInstructions.map(({ instructionRevision }) => instructionRevision),
  );
  const instructionRevision = storedInstructions[0]?.instructionRevision;
  if (instructionRevisions.size !== 1 || instructionRevision === undefined) {
    throw new ApiError("NO_CONFIRMED_INSTRUCTIONS");
  }

  const evidenceIds = [
    ...new Set(
      storedInstructions.flatMap(({ instruction }) => instruction.sourceEvidence),
    ),
  ];
  const sourceEvidence = evidenceIds.map((evidenceId) => {
    const { evidence } = evidenceOrNotFound(state, learnerId, evidenceId);
    if (
      evidence.sourceConversationId !== request.sourceConversationId ||
      evidence.sourceRevision !== request.sourceRevision
    ) {
      throw new InvalidDependencyOutputError();
    }
    return evidence;
  });
  return {
    learnerId,
    sourceConversationId: request.sourceConversationId,
    sourceRevision: request.sourceRevision,
    sourceKind: processing.sourceConversation.sourceKind,
    instructionRevision,
    instructions: storedInstructions.map(({ instruction }) => instruction),
    sourceEvidence,
  };
}

function attemptContext(
  state: MemoryState,
  learnerId: string,
  request: CreateAttemptRequest,
): AttemptContext {
  const { scenario } = scenarioOrNotFound(state, learnerId, request.scenarioId);
  const storedPractice = practiceOrNotFound(state, learnerId, scenario.practiceSetId);
  const { practiceSet } = storedPractice;
  const scenarioIndex = practiceSet.scenarioIds.indexOf(scenario.id);
  if (
    scenarioIndex === -1 ||
    scenario.order !== scenarioIndex + 1 ||
    scenario.kind !== practiceSet.kind ||
    scenario.sourceRevision !== practiceSet.sourceRevision
  ) {
    throw new InvalidDependencyOutputError();
  }
  if (practiceSet.status === "stale") throw new ApiError("STALE_PRACTICE_SET");
  if (practiceSet.status === "draft" || practiceSet.status === "complete") {
    throw new ApiError("INVALID_STATE");
  }
  if (
    request.sourceRevision !== practiceSet.sourceRevision ||
    request.sourceRevision !== scenario.sourceRevision ||
    request.instructionRevision !== practiceSet.instructionRevision
  ) {
    throw new ApiError("REVISION_CONFLICT");
  }
  sourceForProcessing(state, {
    learnerId,
    sourceConversationId: practiceSet.sourceConversationId,
    sourceRevision: practiceSet.sourceRevision,
  });
  if (hasCoveredAttempt(state, learnerId, scenario.id)) {
    throw new ApiError("INVALID_STATE");
  }
  if (practiceSet.kind === "changeDrill") {
    const change = storedPractice.changeId ? state.changes.get(recordKey(learnerId, storedPractice.changeId)) : undefined;
    if (!change || change.status !== "confirmed") throw new InvalidDependencyOutputError();
    const before = instructionOrNotFound(state, learnerId, change.previousInstructionId).instruction;
    const after = instructionOrNotFound(state, learnerId, change.replacementInstruction.id).instruction;
    sourceForProcessing(state, { learnerId, sourceConversationId: before.sourceConversationId, sourceRevision: before.sourceRevision });
    if (before.status !== "changed" || after.status !== "confirmed" || !isDeepStrictEqual(after, change.replacementInstruction) ||
      !sameStringSet(scenario.expectedRuleIds, [after.id]) || !sameStringSet(scenario.sourceEvidence, [...before.sourceEvidence, ...after.sourceEvidence])) throw new InvalidDependencyOutputError();
    const sourceEvidence = scenario.sourceEvidence.map((id) => evidenceOrNotFound(state, learnerId, id).evidence);
    return { practiceSet, scenario, instructions: [before, after], sourceEvidence, changeProposal: change };
  }

  const instructions = scenario.expectedRuleIds.map((instructionId) => {
    if (!storedPractice.instructionIds.includes(instructionId)) {
      throw new InvalidDependencyOutputError();
    }
    const stored = instructionOrNotFound(state, learnerId, instructionId);
    if (
      stored.instructionRevision !== practiceSet.instructionRevision ||
      stored.instruction.status !== "confirmed" ||
      stored.instruction.sourceConversationId !== practiceSet.sourceConversationId ||
      stored.instruction.sourceRevision !== practiceSet.sourceRevision
    ) {
      throw new InvalidDependencyOutputError();
    }
    return stored.instruction;
  });
  const instructionEvidenceIds = [
    ...new Set(instructions.flatMap(({ sourceEvidence }) => sourceEvidence)),
  ];
  if (!sameStringSet(instructionEvidenceIds, scenario.sourceEvidence)) {
    throw new InvalidDependencyOutputError();
  }
  const sourceEvidence = scenario.sourceEvidence.map((evidenceId) => {
    if (!storedPractice.sourceEvidenceIds.includes(evidenceId)) {
      throw new InvalidDependencyOutputError();
    }
    const { evidence } = evidenceOrNotFound(state, learnerId, evidenceId);
    if (
      evidence.sourceConversationId !== practiceSet.sourceConversationId ||
      evidence.sourceRevision !== practiceSet.sourceRevision
    ) {
      throw new InvalidDependencyOutputError();
    }
    return evidence;
  });
  return { practiceSet, scenario, instructions, sourceEvidence };
}

export class MemoryFirstDayRepository implements FirstDayRepository {
  constructor(private readonly groundedExtraction = false) {}
  private state = initialState();
  private transactionTail: Promise<void> = Promise.resolve();

  private async read<Result>(operation: (state: MemoryState) => Result): Promise<Result> {
    await this.transactionTail;
    return copy(operation(this.state));
  }

  private async transact<Result>(operation: (draft: MemoryState) => Result): Promise<Result> {
    const transaction = this.transactionTail.then(() => {
      const draft = copy(this.state);
      const result = operation(draft);
      this.state = draft;
      return copy(result);
    });
    this.transactionTail = transaction.then(() => undefined, () => undefined);
    return transaction;
  }

  async importSource(input: ImportSourceInput): Promise<SourceConversation> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const sourceConversationId = uuidSchema.parse(input.sourceConversationId);
    const source = beeSourceSchema.parse(input.source);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const hash = transcriptHash(source);

    return this.transact((draft) => {
      const identity = identityKey(learnerId, source);
      const existingId = draft.sourceIdentity.get(identity);
      if (existingId !== undefined) {
        const existing = sourceOrNotFound(draft, {
          learnerId,
          sourceConversationId: existingId,
        });
        if (existing.transcriptHash !== hash) throw new ApiError("REVISION_CONFLICT");
        if (existing.consentStatus === "revoked") throw new ApiError("CONSENT_REVOKED");
        return existing;
      }

      const key = recordKey(learnerId, sourceConversationId);
      if (draft.sources.has(key)) throw new ApiError("INVALID_STATE");
      const record = sourceConversationSchema.parse({
        id: sourceConversationId,
        learnerId,
        beeSourceId: source.id,
        sourceKind: source.sourceKind,
        title: source.title,
        startedAt: source.startedAt,
        ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
        transcriptHash: hash,
        sourceRevision: source.revision,
        consentStatus: "confirmed",
        consentConfirmedAt: timestamp,
        status: "ready",
        importedAt: timestamp,
        updatedAt: timestamp,
      });
      draft.sources.set(key, record);
      draft.sourceIdentity.set(identity, sourceConversationId);
      draft.sourceMaterials.set(key, source);
      draft.consentEvents.push({
        learnerId,
        sourceConversationId,
        sourceRevision: source.revision,
        status: "confirmed",
        timestamp,
      });
      return record;
    });
  }

  async getSource(input: SourceLookup): Promise<SourceConversation> {
    const lookup = {
      learnerId: uuidSchema.parse(input.learnerId),
      sourceConversationId: uuidSchema.parse(input.sourceConversationId),
    };
    return this.read((state) => sourceOrNotFound(state, lookup));
  }

  async getSourceForProcessing(input: SourceRevisionLookup): Promise<SourceProcessingContext> {
    const lookup = {
      learnerId: uuidSchema.parse(input.learnerId),
      sourceConversationId: uuidSchema.parse(input.sourceConversationId),
      sourceRevision: sourceRevisionSchema.parse(input.sourceRevision),
    };
    return this.read((state) => sourceForProcessing(state, lookup));
  }

  async prepareExtraction(input: SourceRevisionLookup): Promise<ExtractionContext> {
    const lookup = {
      learnerId: uuidSchema.parse(input.learnerId),
      sourceConversationId: uuidSchema.parse(input.sourceConversationId),
      sourceRevision: sourceRevisionSchema.parse(input.sourceRevision),
    };
    return this.read((state) => {
      const processing = sourceForProcessing(state, lookup);
      const sourceKey = recordKey(lookup.learnerId, lookup.sourceConversationId);
      if (state.extractions.has(sourceKey)) throw new ApiError("INVALID_STATE");

      const previousConfirmed = [...state.instructions.values()].flatMap((stored) => {
        const { instruction } = stored;
        if (
          stored.learnerId !== lookup.learnerId ||
          instruction.sourceConversationId === lookup.sourceConversationId ||
          instruction.status !== "confirmed"
        ) {
          return [];
        }
        const sourceConversation = state.sources.get(
          recordKey(lookup.learnerId, instruction.sourceConversationId),
        );
        if (sourceConversation === undefined) throw new InvalidDependencyOutputError();
        if (
          sourceConversation.consentStatus !== "confirmed" ||
          sourceConversation.status !== "ready"
        ) {
          return [];
        }
        const sourceEvidence = instruction.sourceEvidence.map((evidenceId) => {
          const storedEvidence = state.evidence.get(recordKey(lookup.learnerId, evidenceId));
          if (
            storedEvidence === undefined ||
            storedEvidence.evidence.sourceConversationId !== sourceConversation.id ||
            storedEvidence.evidence.sourceRevision !== sourceConversation.sourceRevision
          ) {
            throw new InvalidDependencyOutputError();
          }
          return storedEvidence.evidence;
        });
        return [{ ...stored, sourceConversation, sourceEvidence }];
      });
      const previousInstructionRevisionsById = Object.fromEntries(
        previousConfirmed.map(({ instruction, instructionRevision }) => [
          instruction.id,
          instructionRevision,
        ]),
      );
      const revisions = new Set(previousConfirmed.map(({ instructionRevision }) => instructionRevision));
      const previousInstructionRevision = revisions.size === 1
        ? previousConfirmed[0]?.instructionRevision
        : undefined;
      const previousInstructionContextsById = Object.fromEntries(
        previousConfirmed.map(({
          instruction,
          instructionRevision,
          sourceConversation,
          sourceEvidence,
        }) => [instruction.id, {
          instructionRevision,
          sourceIdentity: {
            id: sourceConversation.id,
            beeSourceId: sourceConversation.beeSourceId,
            sourceKind: sourceConversation.sourceKind,
            sourceRevision: sourceConversation.sourceRevision,
          },
          sourceEvidence,
        }]),
      );
      return {
        ...processing,
        previousConfirmedInstructions: previousConfirmed.map(({ instruction }) => instruction),
        ...(previousInstructionRevision === undefined ? {} : { previousInstructionRevision }),
        previousInstructionRevisionsById,
        previousInstructionContextsById,
      };
    });
  }

  async saveExtraction(input: SaveExtractionInput): Promise<ExtractInstructionsResponse> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const request = extractInstructionsRequestSchema.parse({
      sourceConversationId: input.sourceConversationId,
      sourceRevision: input.sourceRevision,
      excludedRanges: input.excludedRanges,
    });
    const extraction = extractInstructionsResponseSchema.parse(input.extraction);
    const allocatedRecordIds = new Set(input.allocation.recordIds.map((id) => uuidSchema.parse(id)));
    const allocationTimestamp = isoUtcDateTimeSchema.parse(input.allocation.timestamp);
    const trustedLineage = copy(input.lineage?.previousInstructionContextsById ?? {});

    return this.transact((draft) => {
      const { source } = sourceForProcessing(draft, { learnerId, ...request });
      const sourceKey = recordKey(learnerId, request.sourceConversationId);
      if (draft.extractions.has(sourceKey)) throw new ApiError("INVALID_STATE");
      if (
        extraction.sourceConversationId !== request.sourceConversationId ||
        extraction.sourceRevision !== request.sourceRevision
      ) {
        throw new InvalidDependencyOutputError();
      }
      let validatedFixtureLineage:
        | { supersedesId: string; previousInstructionRevision: string }
        | undefined;
      if (
        !this.groundedExtraction && source.sourceKind === "fixture" &&
        source.id === BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId &&
        extraction.instructionRevision !== BOOKSHOP_FIXTURE_IDS.initialInstructionRevision
      ) {
        throw new InvalidDependencyOutputError();
      }
      if (!this.groundedExtraction && source.sourceKind === "fixture" && source.id === BOOKSHOP_FIXTURE_IDS.updateBeeSourceId) {
        if (extraction.instructionRevision !== BOOKSHOP_FIXTURE_IDS.updateInstructionRevision) {
          throw new InvalidDependencyOutputError();
        }
        const supersedesId = exactFixtureUpdateSupersedesId(trustedLineage);
        const previousInstructionRevision = assertSupersedesLineage({
          state: draft,
          learnerId,
          currentSource: source,
          supersedesId,
          trustedContext: trustedLineage[supersedesId],
        });
        if (
          extraction.items.length !== 1 ||
          extraction.items[0]?.supersedesId !== supersedesId
        ) {
          throw new InvalidDependencyOutputError();
        }
        validatedFixtureLineage = { supersedesId, previousInstructionRevision };
      }
      for (const record of [...extraction.items, ...extraction.openQuestions]) {
        if (
          !allocatedRecordIds.has(record.id) ||
          record.createdAt !== allocationTimestamp ||
          record.updatedAt !== allocationTimestamp
        ) {
          throw new InvalidDependencyOutputError();
        }
      }
      assertExtractionEvidenceLinks(extraction);
      for (const evidence of extraction.sourceEvidence) {
        assertEvidenceMatchesSource({
          evidence,
          source,
          sourceConversationId: request.sourceConversationId,
          sourceRevision: request.sourceRevision,
          excludedRanges: request.excludedRanges,
        });
      }

      const extractedInstructions = new Map(
        extraction.items.map((instruction) => [instruction.id, instruction]),
      );
      for (const question of extraction.openQuestions) {
        if (question.shareConsent) throw new InvalidDependencyOutputError();
        if (question.instructionId === undefined) continue;
        const instruction =
          extractedInstructions.get(question.instructionId) ??
          draft.instructions.get(recordKey(learnerId, question.instructionId))?.instruction;
        if (
          instruction === undefined ||
          instruction.sourceConversationId !== request.sourceConversationId ||
          instruction.sourceRevision !== request.sourceRevision
        ) {
          throw new InvalidDependencyOutputError();
        }
      }

      const previousInstructionRevisions = new Set<string>();
      for (const instruction of extraction.items) {
        if (instruction.supersedesId !== undefined) {
          previousInstructionRevisions.add(
            validatedFixtureLineage?.supersedesId === instruction.supersedesId
              ? validatedFixtureLineage.previousInstructionRevision
              : assertSupersedesLineage({
                  grounded: this.groundedExtraction,
                  state: draft,
                  learnerId,
                  currentSource: source,
                  supersedesId: instruction.supersedesId,
                  trustedContext: trustedLineage[instruction.supersedesId],
                }),
          );
        }
      }
      if (previousInstructionRevisions.size > 1) throw new ApiError("INVALID_STATE");
      for (const evidence of extraction.sourceEvidence) {
        if (draft.evidence.has(recordKey(learnerId, evidence.id))) {
          throw new ApiError("INVALID_STATE");
        }
      }
      for (const question of extraction.openQuestions) {
        if (draft.openQuestions.has(recordKey(learnerId, question.id))) {
          throw new ApiError("INVALID_STATE");
        }
      }

      for (const instruction of extraction.items) {
        const key = recordKey(learnerId, instruction.id);
        if (draft.instructions.has(key)) throw new ApiError("INVALID_STATE");
        draft.instructions.set(key, {
          learnerId,
          instructionRevision: extraction.instructionRevision,
          instruction,
        });
      }
      for (const evidence of extraction.sourceEvidence) {
        draft.evidence.set(recordKey(learnerId, evidence.id), { learnerId, evidence });
      }
      for (const openQuestion of extraction.openQuestions) {
        draft.openQuestions.set(recordKey(learnerId, openQuestion.id), {
          learnerId,
          openQuestion,
        });
      }
      draft.extractionInputs.set(sourceKey, { excludedRanges: request.excludedRanges });
      const previousInstructionRevision = [...previousInstructionRevisions][0];
      draft.extractions.set(sourceKey, {
        learnerId,
        sourceConversationId: request.sourceConversationId,
        sourceRevision: request.sourceRevision,
        instructionRevision: extraction.instructionRevision,
        instructionIds: extraction.items.map(({ id }) => id),
        openQuestionIds: extraction.openQuestions.map(({ id }) => id),
        sourceEvidenceIds: extraction.sourceEvidence.map(({ id }) => id),
        ...(previousInstructionRevision === undefined ? {} : { previousInstructionRevision }),
      });
      return extraction;
    });
  }

  async updateInstruction(input: UpdateInstructionInput): Promise<InstructionCard> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const request = updateInstructionRequestSchema.parse({
      instructionId: input.instructionId,
      sourceRevision: input.sourceRevision,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.situation === undefined ? {} : { situation: input.situation }),
      ...(input.expectedAction === undefined ? {} : { expectedAction: input.expectedAction }),
      ...(input.exceptions === undefined ? {} : { exceptions: input.exceptions }),
    });

    return this.transact((draft) => {
      const stored = instructionOrNotFound(draft, learnerId, request.instructionId);
      const current = stored.instruction;
      if (current.sourceRevision !== request.sourceRevision) {
        throw new ApiError("REVISION_CONFLICT");
      }
      sourceForProcessing(draft, {
        learnerId,
        sourceConversationId: current.sourceConversationId,
        sourceRevision: current.sourceRevision,
      });
      if (current.status !== "needsReview") throw new ApiError("INVALID_STATE");
      if (request.status === current.status) throw new ApiError("INVALID_STATE");
      if (current.supersedesId !== undefined && request.status === "confirmed") {
        throw new ApiError("INVALID_STATE");
      }

      const status = request.status ?? current.status;
      const changed =
        status !== current.status ||
        (request.text !== undefined && request.text !== current.text) ||
        (request.situation !== undefined && request.situation !== current.situation) ||
        (request.expectedAction !== undefined && request.expectedAction !== current.expectedAction) ||
        (request.exceptions !== undefined &&
          JSON.stringify(request.exceptions) !== JSON.stringify(current.exceptions));
      if (!changed) throw new ApiError("INVALID_STATE");

      const instruction = instructionCardSchema.parse({
        ...current,
        status,
        ...(request.text === undefined ? {} : { text: request.text }),
        ...(request.situation === undefined ? {} : { situation: request.situation }),
        ...(request.expectedAction === undefined ? {} : { expectedAction: request.expectedAction }),
        ...(request.exceptions === undefined ? {} : { exceptions: request.exceptions }),
        updatedAt: timestamp,
      });
      draft.instructions.set(recordKey(learnerId, instruction.id), {
        ...stored,
        instruction,
      });
      return instruction;
    });
  }

  async createOpenQuestion(input: CreateOpenQuestionInput): Promise<OpenQuestion> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const openQuestionId = uuidSchema.parse(input.openQuestionId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const request = createOpenQuestionRequestSchema.parse({
      sourceConversationId: input.sourceConversationId,
      sourceRevision: input.sourceRevision,
      ...(input.instructionId === undefined ? {} : { instructionId: input.instructionId }),
      question: input.question,
      sourceEvidence: input.sourceEvidence,
      shareConsent: input.shareConsent,
    });

    return this.transact((draft) => {
      sourceForProcessing(draft, {
        learnerId,
        sourceConversationId: request.sourceConversationId,
        sourceRevision: request.sourceRevision,
      });
      const key = recordKey(learnerId, openQuestionId);
      if (draft.openQuestions.has(key)) throw new ApiError("INVALID_STATE");
      if (request.instructionId !== undefined) {
        const { instruction } = instructionOrNotFound(draft, learnerId, request.instructionId);
        if (
          instruction.sourceConversationId !== request.sourceConversationId ||
          instruction.sourceRevision !== request.sourceRevision
        ) {
          throw new ApiError("RESOURCE_NOT_FOUND");
        }
      }
      for (const evidenceId of request.sourceEvidence) {
        const { evidence } = evidenceOrNotFound(draft, learnerId, evidenceId);
        if (
          evidence.sourceConversationId !== request.sourceConversationId ||
          evidence.sourceRevision !== request.sourceRevision
        ) {
          throw new ApiError("RESOURCE_NOT_FOUND");
        }
      }
      const openQuestion = openQuestionSchema.parse({
        id: openQuestionId,
        sourceConversationId: request.sourceConversationId,
        sourceRevision: request.sourceRevision,
        ...(request.instructionId === undefined ? {} : { instructionId: request.instructionId }),
        question: request.question,
        sourceEvidence: request.sourceEvidence,
        status: "open",
        shareConsent: request.shareConsent,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      draft.openQuestions.set(key, { learnerId, openQuestion });
      return openQuestion;
    });
  }

  async updateOpenQuestion(input: UpdateOpenQuestionInput): Promise<OpenQuestion> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const request = updateOpenQuestionRequestSchema.parse({
      openQuestionId: input.openQuestionId,
      sourceRevision: input.sourceRevision,
      ...(input.question === undefined ? {} : { question: input.question }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.shareConsent === undefined ? {} : { shareConsent: input.shareConsent }),
      ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
    });

    return this.transact((draft) => {
      const stored = questionOrNotFound(draft, learnerId, request.openQuestionId);
      const current = stored.openQuestion;
      if (current.sourceRevision !== request.sourceRevision) {
        throw new ApiError("REVISION_CONFLICT");
      }
      sourceForProcessing(draft, {
        learnerId,
        sourceConversationId: current.sourceConversationId,
        sourceRevision: current.sourceRevision,
      });
      if (current.status !== "open") throw new ApiError("INVALID_STATE");

      const status = request.status ?? current.status;
      const changed =
        status !== current.status ||
        (request.question !== undefined && request.question !== current.question) ||
        (request.shareConsent !== undefined && request.shareConsent !== current.shareConsent) ||
        (request.resolution !== undefined && request.resolution !== current.resolution);
      if (!changed) throw new ApiError("INVALID_STATE");

      const openQuestion = openQuestionSchema.parse({
        ...current,
        status,
        ...(request.question === undefined ? {} : { question: request.question }),
        ...(request.shareConsent === undefined ? {} : { shareConsent: request.shareConsent }),
        ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
        updatedAt: timestamp,
      });
      draft.openQuestions.set(recordKey(learnerId, openQuestion.id), {
        ...stored,
        openQuestion,
      });
      return openQuestion;
    });
  }

  async prepareStandardPractice(
    input: PrepareStandardPracticeInput,
  ): Promise<StandardPracticeContext> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const request = createPracticeSetRequestSchema.parse({
      sourceConversationId: input.sourceConversationId,
      sourceRevision: input.sourceRevision,
      instructionIds: input.instructionIds,
      title: input.title,
    });
    return this.read((state) => standardPracticeContext(state, learnerId, request));
  }

  async saveStandardPractice(
    input: SaveStandardPracticeInput,
  ): Promise<ReturnType<typeof createPracticeSetResponseSchema.parse>> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const request = createPracticeSetRequestSchema.parse(input.request);
    const generation = createPracticeSetResponseSchema.parse(input.generation);

    return this.transact((draft) => {
      const context = standardPracticeContext(draft, learnerId, request);
      const { practiceSet, scenarios, sourceEvidence } = generation;
      const expectedInstructionIds = scenarios.flatMap(({ expectedRuleIds }) => expectedRuleIds);
      if (
        practiceSet.id !== input.allocation.practiceSetId ||
        practiceSet.scenarioIds.length !== input.allocation.scenarioIds.length ||
        practiceSet.scenarioIds.some(
          (scenarioId, index) => scenarioId !== input.allocation.scenarioIds[index],
        ) ||
        practiceSet.createdAt !== input.allocation.timestamp ||
        practiceSet.updatedAt !== input.allocation.timestamp ||
        practiceSet.learnerId !== learnerId ||
        practiceSet.sourceConversationId !== request.sourceConversationId ||
        practiceSet.sourceRevision !== request.sourceRevision ||
        practiceSet.sourceKind !== context.sourceKind ||
        practiceSet.instructionRevision !== context.instructionRevision ||
        practiceSet.title !== request.title ||
        !sameStringSet(expectedInstructionIds, request.instructionIds) ||
        !sameStringSet(
          sourceEvidence.map(({ id }) => id),
          context.sourceEvidence.map(({ id }) => id),
        )
      ) {
        throw new InvalidDependencyOutputError();
      }
      for (const [index, scenario] of scenarios.entries()) {
        const expectedEvidenceIds = [
          ...new Set(
            scenario.expectedRuleIds.flatMap(
              (instructionId) =>
                instructionOrNotFound(draft, learnerId, instructionId).instruction.sourceEvidence,
            ),
          ),
        ];
        if (
          scenario.id !== input.allocation.scenarioIds[index] ||
          !sameStringSet(scenario.sourceEvidence, expectedEvidenceIds)
        ) {
          throw new InvalidDependencyOutputError();
        }
      }
      for (const evidence of sourceEvidence) {
        const persisted = evidenceOrNotFound(draft, learnerId, evidence.id).evidence;
        if (JSON.stringify(persisted) !== JSON.stringify(evidence)) {
          throw new InvalidDependencyOutputError();
        }
      }

      const practiceKey = recordKey(learnerId, practiceSet.id);
      if (draft.practiceSets.has(practiceKey)) throw new ApiError("INVALID_STATE");
      for (const scenario of scenarios) {
        const scenarioKey = recordKey(learnerId, scenario.id);
        if (draft.scenarios.has(scenarioKey)) throw new ApiError("INVALID_STATE");
        draft.scenarios.set(scenarioKey, { learnerId, scenario });
      }
      draft.practiceSets.set(practiceKey, {
        learnerId,
        practiceSet,
        instructionIds: expectedInstructionIds,
        sourceEvidenceIds: sourceEvidence.map(({ id }) => id),
      });
      draft.standardPracticeBySource.set(
        standardPracticeKey(learnerId, request.sourceConversationId, request.sourceRevision),
        practiceSet.id,
      );
      return generation;
    });
  }

  async getPracticeSet(input: PracticeSetLookup) {
    const learnerId = uuidSchema.parse(input.learnerId);
    const practiceSetId = uuidSchema.parse(input.practiceSetId);
    return this.read((state) => {
      const stored = practiceOrNotFound(state, learnerId, practiceSetId);
      const scenarios = stored.practiceSet.scenarioIds.map((scenarioId) => {
        const scenario = state.scenarios.get(recordKey(learnerId, scenarioId));
        if (scenario === undefined) throw new InvalidDependencyOutputError();
        return scenario.scenario;
      });
      const instructions = stored.instructionIds.map(
        (instructionId) => instructionOrNotFound(state, learnerId, instructionId).instruction,
      );
      const sourceEvidence = stored.sourceEvidenceIds.map(
        (evidenceId) => evidenceOrNotFound(state, learnerId, evidenceId).evidence,
      );
      return getPracticeSetResponseSchema.parse({
        practiceSet: stored.practiceSet,
        scenarios,
        instructions,
        sourceEvidence,
        ...(stored.changeId ? { changeProposal: state.changes.get(recordKey(learnerId, stored.changeId)) } : {}),
        progress: {
          completed: completedScenarioCount(
            state,
            learnerId,
            stored.practiceSet.scenarioIds,
          ),
          total: scenarios.length,
        },
      });
    });
  }

  async prepareAttempt(input: PrepareAttemptInput): Promise<AttemptContext> {
    const learnerId = uuidSchema.parse(input.learnerId);
    const request = createAttemptRequestSchema.parse({
      scenarioId: input.scenarioId,
      sourceRevision: input.sourceRevision,
      instructionRevision: input.instructionRevision,
      responseText: input.responseText,
      inputMode: input.inputMode,
    });
    return this.read((state) => attemptContext(state, learnerId, request));
  }

  async compareSources(input: Parameters<FirstDayRepository["compareSources"]>[0]) {
    const learnerId = uuidSchema.parse(input.learnerId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const request = compareSourceRequestSchema.parse({ sourceConversationId: input.sourceConversationId, newSourceConversationId: input.newSourceConversationId, previousInstructionRevision: input.previousInstructionRevision });
    return this.transact((draft) => {
      const oldSource = sourceOrNotFound(draft, { learnerId, sourceConversationId: request.sourceConversationId });
      const newSource = sourceOrNotFound(draft, { learnerId, sourceConversationId: request.newSourceConversationId });
      for (const source of [oldSource, newSource]) sourceForProcessing(draft, { learnerId, sourceConversationId: source.id, sourceRevision: source.sourceRevision });
      if (oldSource.sourceKind !== newSource.sourceKind) throw new ApiError("INVALID_STATE");
      const previous = draft.extractions.get(recordKey(learnerId, oldSource.id));
      const next = draft.extractions.get(recordKey(learnerId, newSource.id));
      if (!previous || !next) throw new ApiError("INVALID_STATE");
      if (previous.instructionRevision !== request.previousInstructionRevision) throw new ApiError("REVISION_CONFLICT");
      const changes: ChangeProposal[] = [];
      for (const id of next.instructionIds) {
        const replacement = instructionOrNotFound(draft, learnerId, id).instruction;
        if (!replacement.supersedesId || !previous.instructionIds.includes(replacement.supersedesId)) continue;
        const old = instructionOrNotFound(draft, learnerId, replacement.supersedesId).instruction;
        if (old.status !== "confirmed" || replacement.status !== "needsReview") throw new ApiError("INVALID_STATE");
        if (old.expectedAction === replacement.expectedAction && isDeepStrictEqual(old.exceptions, replacement.exceptions)) continue;
        const cached = [...draft.changes.entries()].find(([key, c]) => key === recordKey(learnerId, c.id) && c.previousInstructionId === old.id && c.replacementInstruction.id === replacement.id)?.[1];
        if (cached && (!isDeepStrictEqual(cached.replacementInstruction, replacement) || cached.status !== "needsReview")) throw new ApiError("INVALID_STATE");
        const change: ChangeProposal = cached ?? { id: uuidSchema.parse(input.idFactory()), previousInstructionId: old.id, previousSourceRevision: old.sourceRevision, previousSourceEvidence: [...old.sourceEvidence], replacementInstruction: copy(replacement), sourceRevision: replacement.sourceRevision, status: "needsReview", createdAt: timestamp, updatedAt: timestamp };
        if (!cached && draft.changes.has(recordKey(learnerId, change.id))) throw new ApiError("INVALID_STATE");
        changes.push(change);
      }
      const references = [...new Set(changes.flatMap((c) => [...c.previousSourceEvidence, ...c.replacementInstruction.sourceEvidence]))];
      const result = compareSourceResponseSchema.parse({ previousSourceConversationId: request.sourceConversationId, newSourceConversationId: request.newSourceConversationId, previousInstructionRevision: request.previousInstructionRevision, changes, sourceEvidence: references.map((id) => evidenceOrNotFound(draft, learnerId, id).evidence) });
      for (const change of result.changes) draft.changes.set(recordKey(learnerId, change.id), change);
      return result;
    });
  }

  async confirmChange(input: Parameters<FirstDayRepository["confirmChange"]>[0]) {
    const learnerId = uuidSchema.parse(input.learnerId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const request = confirmChangeRequestSchema.parse({ changeId: input.changeId, sourceRevision: input.sourceRevision });
    const practiceSetId = uuidSchema.parse(input.practiceSetId), scenarioId = uuidSchema.parse(input.scenarioId);
    return this.transact((draft) => {
      const proposal = draft.changes.get(recordKey(learnerId, request.changeId));
      if (!proposal) throw new ApiError("RESOURCE_NOT_FOUND");
      if (proposal.sourceRevision !== request.sourceRevision) throw new ApiError("REVISION_CONFLICT");
      const old = instructionOrNotFound(draft, learnerId, proposal.previousInstructionId);
      const replacement = instructionOrNotFound(draft, learnerId, proposal.replacementInstruction.id);
      for (const rule of [old.instruction, replacement.instruction]) sourceForProcessing(draft, { learnerId, sourceConversationId: rule.sourceConversationId, sourceRevision: rule.sourceRevision });
      if (proposal.status !== "needsReview" || old.instruction.status !== "confirmed" || replacement.instruction.status !== "needsReview" || !isDeepStrictEqual(replacement.instruction, proposal.replacementInstruction) || !sameStringSet(old.instruction.sourceEvidence, proposal.previousSourceEvidence) || old.instruction.sourceRevision !== proposal.previousSourceRevision) throw new ApiError("INVALID_STATE");
      if (draft.practiceSets.has(recordKey(learnerId, practiceSetId)) || draft.scenarios.has(recordKey(learnerId, scenarioId))) throw new ApiError("INVALID_STATE");
      const previousInstruction = instructionCardSchema.parse({ ...old.instruction, status: "changed", updatedAt: timestamp });
      const replacementInstruction = instructionCardSchema.parse({ ...replacement.instruction, status: "confirmed", updatedAt: timestamp });
      const changeProposal = { ...proposal, replacementInstruction, status: "confirmed" as const, updatedAt: timestamp };
      const references = [...new Set([...previousInstruction.sourceEvidence, ...replacementInstruction.sourceEvidence])];
      const stalePracticeSetIds = [...draft.practiceSets.values()].filter((p) => p.learnerId === learnerId && p.instructionIds.includes(old.instruction.id) && p.practiceSet.status !== "stale").map((p) => p.practiceSet.id);
      const newSource = sourceOrNotFound(draft, { learnerId, sourceConversationId: replacementInstruction.sourceConversationId });
      const result = confirmChangeResponseSchema.parse({ changeProposal, previousInstruction, replacementInstruction, stalePracticeSetIds,
        changeDrill: { practiceSet: { id: practiceSetId, learnerId, sourceConversationId: newSource.id, sourceRevision: newSource.sourceRevision, sourceKind: newSource.sourceKind, title: "What changed?", kind: "changeDrill", instructionRevision: replacement.instructionRevision, status: "ready", scenarioIds: [scenarioId], createdAt: timestamp, updatedAt: timestamp },
          scenarios: [{ id: scenarioId, practiceSetId, sourceRevision: newSource.sourceRevision, kind: "changeDrill", characterId: "guide-maya", prompt: `${replacementInstruction.situation.replace(/[.!?]+$/, "")}. What would you do with the updated instruction?`, context: "Your trainer has changed the procedure. Use the update you just confirmed.", expectedRuleIds: [replacementInstruction.id], acceptableSignals: [replacementInstruction.expectedAction], criticalMisses: [previousInstruction.expectedAction], retryPrompt: "Compare both source notes, then try the new action.", sourceEvidence: references, order: 1 }] },
        sourceEvidence: references.map((id) => evidenceOrNotFound(draft, learnerId, id).evidence) });
      draft.instructions.set(recordKey(learnerId, previousInstruction.id), { ...old, instruction: previousInstruction });
      draft.instructions.set(recordKey(learnerId, replacementInstruction.id), { ...replacement, instruction: replacementInstruction });
      draft.changes.set(recordKey(learnerId, proposal.id), result.changeProposal);
      for (const staleId of stalePracticeSetIds) {
        const stored = practiceOrNotFound(draft, learnerId, staleId);
        stored.practiceSet = practiceSetSchema.parse({ ...stored.practiceSet, status: "stale", updatedAt: timestamp });
      }
      draft.practiceSets.set(recordKey(learnerId, practiceSetId), { learnerId, practiceSet: result.changeDrill.practiceSet, instructionIds: [previousInstruction.id, replacementInstruction.id], sourceEvidenceIds: references, changeId: proposal.id });
      const scenario = result.changeDrill.scenarios[0]!;
      draft.scenarios.set(recordKey(learnerId, scenarioId), { learnerId, scenario });
      return result;
    });
  }

  async saveAttempt(input: SaveAttemptInput) {
    const learnerId = uuidSchema.parse(input.learnerId);
    const request = createAttemptRequestSchema.parse({
      scenarioId: input.scenarioId,
      sourceRevision: input.sourceRevision,
      instructionRevision: input.instructionRevision,
      responseText: input.responseText,
      inputMode: input.inputMode,
    });
    const attemptId = uuidSchema.parse(input.attemptId);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);
    const evaluation = copy(input.evaluation);

    return this.transact((draft) => {
      const context = attemptContext(draft, learnerId, request);
      const attemptResult = attemptSchema.safeParse({
        id: attemptId,
        scenarioId: request.scenarioId,
        sourceRevision: request.sourceRevision,
        instructionRevision: request.instructionRevision,
        responseText: request.responseText,
        inputMode: request.inputMode,
        createdAt: timestamp,
        ...evaluation,
      });
      if (!attemptResult.success) throw new InvalidDependencyOutputError();
      const attempt = attemptResult.data;
      if (
        attempt.id !== attemptId ||
        attempt.scenarioId !== request.scenarioId ||
        attempt.sourceRevision !== request.sourceRevision ||
        attempt.instructionRevision !== request.instructionRevision ||
        attempt.responseText !== request.responseText ||
        attempt.inputMode !== request.inputMode ||
        attempt.createdAt !== timestamp ||
        !sameStringSet(
          [...attempt.matchedRuleIds, ...attempt.missedRuleIds],
          context.scenario.expectedRuleIds,
        ) ||
        !sameStringSet(attempt.sourceEvidence, context.scenario.sourceEvidence)
      ) {
        throw new InvalidDependencyOutputError();
      }

      const attemptKey = recordKey(learnerId, attempt.id);
      if (draft.attempts.has(attemptKey)) throw new InvalidDependencyOutputError();
      const completedBefore = completedScenarioCount(
        draft,
        learnerId,
        context.practiceSet.scenarioIds,
      );
      const completedAfter = completedBefore + (attempt.result === "covered" ? 1 : 0);
      const status = attempt.result === "covered"
        ? completedAfter === context.practiceSet.scenarioIds.length
          ? "complete"
          : "inProgress"
        : context.practiceSet.status;
      const practiceSetResult = practiceSetSchema.safeParse({
        ...context.practiceSet,
        status,
        updatedAt: timestamp,
      });
      if (!practiceSetResult.success) throw new InvalidDependencyOutputError();
      const practiceSet = practiceSetResult.data;
      const nextAction = attempt.result === "covered"
        ? practiceSet.status === "complete"
          ? "complete"
          : "continue"
        : attempt.result === "needsReview"
          ? "reviewSource"
          : "retry";
      const outputResult = createAttemptResponseSchema.safeParse({
        practiceSet,
        scenario: context.scenario,
        attempt,
        instructions: context.instructions,
        ...(context.changeProposal === undefined
          ? {}
          : { changeProposal: context.changeProposal }),
        sourceEvidence: context.sourceEvidence,
        nextAction,
      });
      if (!outputResult.success) throw new InvalidDependencyOutputError();

      draft.attempts.set(attemptKey, { learnerId, attempt });
      const scenarioAttemptKey = recordKey(learnerId, context.scenario.id);
      draft.attemptIdsByScenario.set(scenarioAttemptKey, [
        ...(draft.attemptIdsByScenario.get(scenarioAttemptKey) ?? []),
        attempt.id,
      ]);
      const storedPractice = practiceOrNotFound(draft, learnerId, practiceSet.id);
      draft.practiceSets.set(recordKey(learnerId, practiceSet.id), {
        ...storedPractice,
        practiceSet,
      });
      return outputResult.data;
    });
  }

  async revokeConsent(input: RevokeConsentInput) {
    const learnerId = uuidSchema.parse(input.learnerId);
    const sourceConversationId = uuidSchema.parse(input.sourceConversationId);
    const sourceRevision = sourceRevisionSchema.parse(input.sourceRevision);
    const timestamp = isoUtcDateTimeSchema.parse(input.timestamp);

    return this.transact((draft) => {
      const key = recordKey(learnerId, sourceConversationId);
      const current = sourceOrNotFound(draft, { learnerId, sourceConversationId });
      assertRevision(current, sourceRevision);
      if (current.consentStatus !== "confirmed") throw new ApiError("INVALID_STATE");
      const sourceConversation = sourceConversationSchema.parse({
        ...current,
        consentStatus: "revoked",
        consentRevokedAt: timestamp,
        updatedAt: timestamp,
      });
      draft.sources.set(key, sourceConversation);
      draft.sourceMaterials.delete(key);
      draft.extractionInputs.delete(key);
      const stalePracticeSetIds: string[] = [];
      for (const [practiceKey, stored] of draft.practiceSets) {
        if (stored.learnerId !== learnerId || stored.practiceSet.status === "stale") continue;
        const linkedToSource = stored.instructionIds.some((instructionId) => {
          const instruction = draft.instructions.get(recordKey(learnerId, instructionId));
          return instruction?.instruction.sourceConversationId === sourceConversationId;
        });
        if (
          stored.practiceSet.sourceConversationId !== sourceConversationId &&
          !linkedToSource
        ) {
          continue;
        }
        const practiceSet = practiceSetSchema.parse({
          ...stored.practiceSet,
          status: "stale",
          updatedAt: timestamp,
        });
        draft.practiceSets.set(practiceKey, { ...stored, practiceSet });
        stalePracticeSetIds.push(practiceSet.id);
      }
      draft.consentEvents.push({
        learnerId,
        sourceConversationId,
        sourceRevision,
        status: "revoked",
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        timestamp,
      });
      return revokeConsentResponseSchema.parse({
        sourceConversation,
        stalePracticeSetIds: stalePracticeSetIds.slice(0, 100),
      });
    });
  }
}

export function createMemoryRepository(options: { groundedExtraction?: boolean } = {}): FirstDayRepository {
  return new MemoryFirstDayRepository(options.groundedExtraction);
}
