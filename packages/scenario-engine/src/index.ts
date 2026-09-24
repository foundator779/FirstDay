import {
  attemptSchema,
  beeSourceSchema,
  changeProposalSchema,
  compareSourceRequestSchema,
  compareSourceResponseSchema,
  createPracticeSetResponseSchema,
  createSourceEvidenceId,
  extractInstructionsRequestSchema,
  extractInstructionsResponseSchema,
  getPracticeSetResponseSchema,
  instructionCardSchema,
  instructionRevisionSchema,
  isoUtcDateTimeSchema,
  scenarioSchema,
  sourceEvidenceSchema,
  sourceKindSchema,
  sourceRevisionSchema,
  uuidSchema,
  type BeeSource,
  type ChangeProposal,
  type CompareSourceResponse,
  type CreatePracticeSetResponse,
  type ExcludedRange,
  type ExtractInstructionsResponse,
  type InstructionCard,
  type PracticeSet,
  type Scenario,
  type SourceEvidence,
  type SourceEvidenceId,
  type SourceKind,
} from "@firstday/contracts";

export { extractSyntheticInstructions, generateSyntheticPractice, normalizeSyntheticAnswer } from "./synthetic.js";

export const BOOKSHOP_FIXTURE_IDS = {
  learnerId: "70000000-0000-4000-8000-000000000001",
  onboardingBeeSourceId: "fixture-bookshop-onboarding",
  updateBeeSourceId: "fixture-bookshop-policy-update",
  onboardingSourceConversationId: "10000000-0000-4000-8000-000000000001",
  updateSourceConversationId: "10000000-0000-4000-8000-000000000002",
  reservationInstructionId: "20000000-0000-4000-8000-000000000001",
  pickupInstructionId: "20000000-0000-4000-8000-000000000002",
  damagedReturnInstructionId: "20000000-0000-4000-8000-000000000003",
  replacementInstructionId: "20000000-0000-4000-8000-000000000004",
  standardPracticeSetId: "30000000-0000-4000-8000-000000000001",
  changeDrillPracticeSetId: "30000000-0000-4000-8000-000000000002",
  reservationScenarioId: "40000000-0000-4000-8000-000000000001",
  pickupScenarioId: "40000000-0000-4000-8000-000000000002",
  damagedReturnScenarioId: "40000000-0000-4000-8000-000000000003",
  changeDrillScenarioId: "40000000-0000-4000-8000-000000000004",
  changeProposalId: "60000000-0000-4000-8000-000000000001",
  reservationEvidenceId: "evd_3ad8265380a17c54d99d2fef34a831116de6b107550c5548034abbeafe4b2db9",
  pickupEvidenceId: "evd_a15e02216e08058798a702379fae652f234b4ce2ff9f6a3f6ccf8cbf47ab35e9",
  damagedReturnEvidenceId: "evd_20c1b641162b6763b818f67edb6404803fd6ce2661958368404ff26860d8db19",
  replacementEvidenceId: "evd_ca2da68176b9801fa54f1f43d263ac9f7ae92cc64ed73ec63c81ac44bc909347",
  onboardingSourceRevision: "fixture-bookshop-onboarding-r1",
  updateSourceRevision: "fixture-bookshop-policy-update-r1",
  initialInstructionRevision: "bookshop-instructions-r1",
  updateInstructionRevision: "bookshop-instructions-r2",
} as const;

export type ScenarioEngineErrorCode =
  | "VALIDATION_ERROR"
  | "REVISION_CONFLICT"
  | "NO_CONFIRMED_INSTRUCTIONS"
  | "INVALID_STATE";

export class ScenarioEngineError extends Error {
  override readonly name = "ScenarioEngineError";

  constructor(public readonly code: ScenarioEngineErrorCode, message: string) {
    super(message);
  }
}

export type ExtractFixtureInstructionsRequest = {
  sourceConversationId: string;
  sourceRevision: string;
  excludedRanges: ExcludedRange[];
  instructionRevision: string;
  instructionIds: readonly string[];
  supersedesInstructionId?: string;
  timestamp: string;
};

export type GenerateStandardPracticeSetInput = {
  learnerId: string;
  sourceConversationId: string;
  sourceRevision: string;
  sourceKind: SourceKind;
  instructionRevision: string;
  title: string;
  practiceSetId: string;
  scenarioIds: readonly string[];
  instructions: readonly InstructionCard[];
  sourceEvidence: readonly SourceEvidence[];
  timestamp: string;
};

export type EvaluateScenarioInput = {
  scenario: Scenario;
  responseText: string;
  instructions: readonly InstructionCard[];
  sourceEvidence: readonly SourceEvidence[];
  changeProposal?: ChangeProposal;
};

export type ScenarioEvaluation = {
  result: "covered" | "partial" | "missed" | "needsReview";
  matchedRuleIds: string[];
  missedRuleIds: string[];
  sourceEvidence: SourceEvidenceId[];
  feedback: string;
};

export type CompareInstructionRevisionsInput = {
  previousSourceConversationId: string;
  newSourceConversationId: string;
  previousInstructionRevision: string;
  previousInstructions: readonly InstructionCard[];
  replacementCandidates: readonly InstructionCard[];
  sourceEvidence: readonly SourceEvidence[];
  changeProposalId: string;
  timestamp: string;
};

export type GenerateChangeDrillInput = {
  learnerId: string;
  sourceKind: SourceKind;
  instructionRevision: string;
  title: string;
  confirmedProposal: ChangeProposal;
  previousInstruction: InstructionCard;
  sourceEvidence: readonly SourceEvidence[];
  practiceSetId: string;
  scenarioId: string;
  timestamp: string;
};

export type ChangeDrillGeneration = {
  practiceSet: PracticeSet;
  scenarios: Scenario[];
  sourceEvidence: SourceEvidence[];
};

type Parser<T> = { parse(input: unknown): T };

function parseCanonical<T>(parser: Parser<T>, input: unknown, label: string): T {
  try {
    return parser.parse(input);
  } catch {
    throw new ScenarioEngineError("VALIDATION_ERROR", `${label} failed canonical validation`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return values.size === left.length && right.every((value) => values.has(value));
}

function rangesOverlap(evidence: { startMs: number; endMs: number }, excluded: ExcludedRange): boolean {
  return evidence.startMs < excluded.endMs && excluded.startMs < evidence.endMs;
}

type ExtractionCardDefinition = {
  utteranceId: string;
  startMs: number;
  endMs: number;
  quote: string;
  text: string;
  situation: string;
  expectedAction: string;
  confidence: number;
};

const INITIAL_CARD_DEFINITIONS: readonly ExtractionCardDefinition[] = [
  {
    utteranceId: "onboarding-003",
    startMs: 10_800,
    endMs: 17_400,
    quote: "We hold each customer reservation for five calendar days, counting the day we set it aside as day one.",
    text: "Reservations are held for five calendar days, counting the set-aside day as day one.",
    situation: "A customer asks whether a reservation is still active.",
    expectedAction: "Count the set-aside day as day one and treat the reservation as active through day five.",
    confidence: 0.99,
  },
  {
    utteranceId: "onboarding-005",
    startMs: 21_400,
    endMs: 27_700,
    quote: "Before you hand over a reserved book, ask for both the reservation name and the phone number on the reservation.",
    text: "Before handing over a reserved book, staff must ask for both the reservation name and phone number.",
    situation: "A customer collects a reserved book.",
    expectedAction: "Ask for both the reservation name and phone number before handing over the book.",
    confidence: 0.99,
  },
  {
    utteranceId: "onboarding-007",
    startMs: 31_400,
    endMs: 38_800,
    quote: "If a customer returns a damaged book, place it on the red returns cart in the back room before you issue the refund.",
    text: "A damaged return goes on the red returns cart in the back room before a refund is issued.",
    situation: "A customer returns a damaged book.",
    expectedAction: "Place the book on the red returns cart in the back room before issuing the refund.",
    confidence: 0.98,
  },
];

const UPDATE_CARD_DEFINITION: ExtractionCardDefinition = {
  utteranceId: "policy-update-003",
  startMs: 10_400,
  endMs: 17_400,
  quote: "Starting today, we hold each customer reservation for seven calendar days, counting the day we set it aside as day one.",
  text: "Reservations are held for seven calendar days, counting the set-aside day as day one.",
  situation: "A customer asks whether a reservation is still active.",
  expectedAction: "Count the set-aside day as day one and treat the reservation as active through day seven.",
  confidence: 0.99,
};

function fixtureDefinitions(source: BeeSource): readonly ExtractionCardDefinition[] {
  if (source.sourceKind !== "fixture") {
    throw new ScenarioEngineError("INVALID_STATE", "fixture extraction requires fixture data");
  }
  if (source.id === BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId) return INITIAL_CARD_DEFINITIONS;
  if (source.id === BOOKSHOP_FIXTURE_IDS.updateBeeSourceId) return [UPDATE_CARD_DEFINITION];
  throw new ScenarioEngineError("INVALID_STATE", `unsupported fixture source: ${source.id}`);
}

function evidenceForDefinition(
  source: BeeSource,
  sourceConversationId: string,
  definition: ExtractionCardDefinition,
): SourceEvidence {
  const utterance = source.utterances.find(({ id }) => id === definition.utteranceId);
  if (
    utterance === undefined ||
    utterance.startMs !== definition.startMs ||
    utterance.endMs !== definition.endMs ||
    utterance.text !== definition.quote
  ) {
    throw new ScenarioEngineError("INVALID_STATE", `fixture utterance ${definition.utteranceId} does not match its stable span`);
  }
  return parseCanonical(sourceEvidenceSchema, {
    id: createSourceEvidenceId({
      sourceConversationId,
      sourceRevision: source.revision,
      startMs: definition.startMs,
      endMs: definition.endMs,
    }),
    sourceConversationId,
    sourceRevision: source.revision,
    startMs: definition.startMs,
    endMs: definition.endMs,
    quote: utterance.text,
    utteranceIds: [utterance.id],
    ...(utterance.speaker === undefined ? {} : { speakerLabel: utterance.speaker.label }),
  }, "source evidence");
}

export function extractFixtureInstructions(
  sourceInput: BeeSource,
  requestInput: ExtractFixtureInstructionsRequest,
): ExtractInstructionsResponse {
  const source = parseCanonical(beeSourceSchema, sourceInput, "Bee source");
  const request = parseCanonical(extractInstructionsRequestSchema, {
    sourceConversationId: requestInput.sourceConversationId,
    sourceRevision: requestInput.sourceRevision,
    excludedRanges: requestInput.excludedRanges,
  }, "extraction request");
  const definitions = fixtureDefinitions(source);
  if (request.sourceRevision !== source.revision) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "extraction request does not match the fixture source revision");
  }
  if (requestInput.instructionIds.length !== definitions.length) {
    throw new ScenarioEngineError("VALIDATION_ERROR", `fixture extraction requires ${definitions.length} injected instruction IDs`);
  }
  const instructionIds = requestInput.instructionIds.map((id) => parseCanonical(uuidSchema, id, "instruction ID"));
  if (new Set(instructionIds).size !== instructionIds.length) {
    throw new ScenarioEngineError("VALIDATION_ERROR", "instruction IDs must be unique");
  }
  const instructionRevision = parseCanonical(instructionRevisionSchema, requestInput.instructionRevision, "instruction revision");
  const timestamp = parseCanonical(isoUtcDateTimeSchema, requestInput.timestamp, "timestamp");
  const isUpdate = source.id === BOOKSHOP_FIXTURE_IDS.updateBeeSourceId;
  const supersedesInstructionId = requestInput.supersedesInstructionId === undefined
    ? undefined
    : parseCanonical(uuidSchema, requestInput.supersedesInstructionId, "superseded instruction ID");
  if (isUpdate !== (supersedesInstructionId !== undefined)) {
    throw new ScenarioEngineError("VALIDATION_ERROR", "only the policy update requires a superseded instruction ID");
  }
  if (
    supersedesInstructionId !== undefined &&
    instructionIds.includes(supersedesInstructionId)
  ) {
    throw new ScenarioEngineError(
      "VALIDATION_ERROR",
      "a replacement instruction must have a distinct ID",
    );
  }

  const extracted = definitions.flatMap((definition, index) => {
    if (request.excludedRanges.some((range) => rangesOverlap(definition, range))) return [];
    const evidence = evidenceForDefinition(source, request.sourceConversationId, definition);
    const id = instructionIds[index];
    if (id === undefined) throw new ScenarioEngineError("VALIDATION_ERROR", "missing injected instruction ID");
    const instruction = parseCanonical(instructionCardSchema, {
      id,
      sourceConversationId: request.sourceConversationId,
      sourceRevision: source.revision,
      text: definition.text,
      situation: definition.situation,
      expectedAction: definition.expectedAction,
      exceptions: [],
      sourceEvidence: [evidence.id],
      confidence: definition.confidence,
      status: "needsReview",
      ...(supersedesInstructionId === undefined ? {} : { supersedesId: supersedesInstructionId }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }, "extracted instruction");
    return [{ instruction, evidence }];
  });

  return parseCanonical(extractInstructionsResponseSchema, {
    sourceConversationId: request.sourceConversationId,
    sourceRevision: source.revision,
    instructionRevision,
    items: extracted.map(({ instruction }) => instruction),
    openQuestions: [],
    sourceEvidence: extracted.map(({ evidence }) => evidence),
  }, "extraction response");
}

type StandardScenarioDefinition = {
  startMs: number;
  endMs: number;
  prompt: string;
  context: string;
  acceptableSignals: readonly string[];
  criticalMisses: readonly string[];
  retryPrompt: string;
  feedback: Record<"covered" | "partial" | "missed", string>;
};

const STANDARD_SCENARIO_DEFINITIONS: readonly StandardScenarioDefinition[] = [
  {
    startMs: 10_800,
    endMs: 17_400,
    prompt: "My book was set aside on Monday, and I can only get here on Saturday. Is it still within the reservation window?",
    context: "Reservation desk - Saturday afternoon",
    acceptableSignals: ["five calendar days", "day six", "outside the hold"],
    criticalMisses: ["still inside the hold", "weekends don't count"],
    retryPrompt: "Count Monday as day one. Which numbered day is Saturday, and does a five-calendar-day hold cover it?",
    feedback: {
      covered: "You counted the five-day hold correctly: Saturday is day six.",
      partial: "You remembered the window but did not apply it. With Monday as day one, Saturday is day six and outside the hold.",
      missed: "The rule uses calendar days and counts Monday as day one. Retry using the five-day source.",
    },
  },
  {
    startMs: 21_400,
    endMs: 27_700,
    prompt: "I'm collecting a reserved book. I know the title, The Night Orchard. What do you need from me before you hand it over?",
    context: "Pickup desk - Busy afternoon",
    acceptableSignals: ["reservation name", "phone number"],
    criticalMisses: ["title is enough", "hand it over now"],
    retryPrompt: "There are two details on the reservation record. Ask me for both before handing over the book.",
    feedback: {
      covered: "You asked for both pickup details before handing over the book.",
      partial: "You asked for the name; also ask for the phone number on the reservation.",
      missed: "The title alone is not enough. Ask for both the reservation name and phone number.",
    },
  },
  {
    startMs: 31_400,
    endMs: 38_800,
    prompt: "This copy has a torn cover, and I'd like a refund. Where does the book go, and when?",
    context: "Returns desk - End of shift",
    acceptableSignals: ["returns cart", "red", "back room", "before", "refund"],
    criticalMisses: ["issue the refund first", "put it back on the shelf"],
    retryPrompt: "Name the cart, its location, and whether the book moves before or after the refund.",
    feedback: {
      covered: "You routed the damaged book correctly before the refund.",
      partial: "You got the sequence right; specify the red returns cart in the back room.",
      missed: "Do not return a damaged book to the shelf. Put it on the red returns cart in the back room before the refund.",
    },
  },
];

const CHANGE_SCENARIO_DEFINITION = {
  prompt: "A reservation was set aside on Monday, and the customer arrives Sunday. Under the new rule, is it still held, and what changed?",
  context: "Policy refresh - Before the next shift",
  acceptableSignals: ["seven calendar days", "day seven", "still held", "changed from five"],
  criticalMisses: ["five day rule still applies", "expired before sunday"],
  retryPrompt: "Compare the old five-day evidence with the new seven-day evidence, then count Monday as day one.",
  feedback: {
    covered: "You applied the seven-day update and explained what changed.",
    partial: "You used part of the new rule; also state that Sunday is day seven and the window changed from five days.",
    missed: "The five-day rule changed. Use the new seven-calendar-day source and count Monday as day one.",
  },
} as const;

function parsedEvidence(values: readonly SourceEvidence[]): SourceEvidence[] {
  const parsed = values.map((value) =>
    parseCanonical(sourceEvidenceSchema, value, "source evidence"),
  );
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw new ScenarioEngineError("INVALID_STATE", "source evidence IDs must be unique");
  }
  return parsed;
}

function parsedInstructions(values: readonly InstructionCard[]): InstructionCard[] {
  return values.map((value) => parseCanonical(instructionCardSchema, value, "instruction"));
}

function evidenceRecordForInstruction(
  instruction: InstructionCard,
  evidenceById: ReadonlyMap<string, SourceEvidence>,
): SourceEvidence {
  if (instruction.sourceEvidence.length !== 1) {
    throw new ScenarioEngineError("INVALID_STATE", "bookshop standard instructions require exactly one evidence span");
  }
  const evidence = evidenceById.get(instruction.sourceEvidence[0]!);
  if (evidence === undefined) throw new ScenarioEngineError("INVALID_STATE", "instruction evidence is missing");
  return evidence;
}

function evidenceMatchesDefinition(
  evidence: SourceEvidence,
  definition: ExtractionCardDefinition,
): boolean {
  return (
    evidence.startMs === definition.startMs &&
    evidence.endMs === definition.endMs &&
    evidence.quote === definition.quote &&
    sameStrings(evidence.utteranceIds, [definition.utteranceId])
  );
}

export function generateStandardPracticeSet(
  input: GenerateStandardPracticeSetInput,
): CreatePracticeSetResponse {
  if (input.sourceKind !== "fixture") {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "the deterministic bookshop generator requires fixture data",
    );
  }
  const instructions = parsedInstructions(input.instructions);
  if (
    instructions.length !== 3 ||
    instructions.some(({ status }) => status !== "confirmed") ||
    new Set(instructions.map(({ id }) => id)).size !== 3
  ) {
    throw new ScenarioEngineError("NO_CONFIRMED_INSTRUCTIONS", "standard practice requires exactly three unique confirmed instructions");
  }
  if (instructions.some(({ sourceRevision }) => sourceRevision !== input.sourceRevision)) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "instruction revision does not match the requested source revision");
  }
  if (instructions.some(({ sourceConversationId }) => sourceConversationId !== input.sourceConversationId)) {
    throw new ScenarioEngineError("INVALID_STATE", "all instructions must belong to the requested source conversation");
  }

  const evidence = parsedEvidence(input.sourceEvidence);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const instructionByDefinition = new Map<StandardScenarioDefinition, InstructionCard>();
  for (const instruction of instructions) {
    const record = evidenceRecordForInstruction(instruction, evidenceById);
    if (record.sourceConversationId !== input.sourceConversationId || record.sourceRevision !== input.sourceRevision) {
      throw new ScenarioEngineError("REVISION_CONFLICT", "instruction evidence does not match requested source provenance");
    }
    const definition = STANDARD_SCENARIO_DEFINITIONS.find(
      ({ endMs, startMs }) => record.startMs === startMs && record.endMs === endMs,
    );
    const extractionDefinition = INITIAL_CARD_DEFINITIONS.find(
      ({ endMs, startMs }) => record.startMs === startMs && record.endMs === endMs,
    );
    if (
      definition === undefined ||
      extractionDefinition === undefined ||
      !evidenceMatchesDefinition(record, extractionDefinition) ||
      instructionByDefinition.has(definition)
    ) {
      throw new ScenarioEngineError("INVALID_STATE", "instructions do not cover the three supported bookshop rules");
    }
    instructionByDefinition.set(definition, instruction);
  }

  const scenarios = STANDARD_SCENARIO_DEFINITIONS.map((definition, index) => {
    const instruction = instructionByDefinition.get(definition);
    const scenarioId = input.scenarioIds[index];
    if (instruction === undefined || scenarioId === undefined) {
      throw new ScenarioEngineError("VALIDATION_ERROR", "three injected scenario IDs are required");
    }
    return {
      id: scenarioId,
      practiceSetId: input.practiceSetId,
      sourceRevision: input.sourceRevision,
      kind: "standard" as const,
      characterId: "customer-rowan" as const,
      prompt: definition.prompt,
      context: definition.context,
      expectedRuleIds: [instruction.id],
      acceptableSignals: [...definition.acceptableSignals],
      criticalMisses: [...definition.criticalMisses],
      retryPrompt: definition.retryPrompt,
      sourceEvidence: [...instruction.sourceEvidence],
      order: index + 1,
    };
  });
  const outputEvidence = scenarios.flatMap(({ sourceEvidence }) => sourceEvidence).map((id) => {
    const record = evidenceById.get(id);
    if (record === undefined) throw new ScenarioEngineError("INVALID_STATE", "scenario evidence is missing");
    return record;
  });

  return parseCanonical(createPracticeSetResponseSchema, {
    practiceSet: {
      id: input.practiceSetId,
      learnerId: input.learnerId,
      sourceConversationId: input.sourceConversationId,
      sourceRevision: parseCanonical(sourceRevisionSchema, input.sourceRevision, "source revision"),
      sourceKind: parseCanonical(sourceKindSchema, input.sourceKind, "source kind"),
      title: input.title,
      kind: "standard",
      instructionRevision: parseCanonical(instructionRevisionSchema, input.instructionRevision, "instruction revision"),
      status: "ready",
      scenarioIds: [...input.scenarioIds],
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    },
    scenarios,
    sourceEvidence: outputEvidence,
  }, "standard practice response");
}

type EvaluationDefinition = {
  kind: Scenario["kind"];
  characterId: Scenario["characterId"];
  prompt: string;
  context: string;
  acceptableSignals: readonly string[];
  criticalMisses: readonly string[];
  retryPrompt: string;
  order: number;
  evidenceCount: number;
  feedback: Record<"covered" | "partial" | "missed", string>;
};

const EVALUATION_DEFINITIONS: readonly EvaluationDefinition[] = [
  ...STANDARD_SCENARIO_DEFINITIONS.map((definition, index) => ({
    kind: "standard" as const,
    characterId: "customer-rowan" as const,
    prompt: definition.prompt,
    context: definition.context,
    acceptableSignals: definition.acceptableSignals,
    criticalMisses: definition.criticalMisses,
    retryPrompt: definition.retryPrompt,
    order: index + 1,
    evidenceCount: 1,
    feedback: definition.feedback,
  })),
  {
    kind: "changeDrill",
    characterId: "guide-maya",
    prompt: CHANGE_SCENARIO_DEFINITION.prompt,
    context: CHANGE_SCENARIO_DEFINITION.context,
    acceptableSignals: CHANGE_SCENARIO_DEFINITION.acceptableSignals,
    criticalMisses: CHANGE_SCENARIO_DEFINITION.criticalMisses,
    retryPrompt: CHANGE_SCENARIO_DEFINITION.retryPrompt,
    order: 1,
    evidenceCount: 2,
    feedback: CHANGE_SCENARIO_DEFINITION.feedback,
  },
];

function evaluationDefinition(scenario: Scenario): EvaluationDefinition {
  const definition = EVALUATION_DEFINITIONS.find((candidate) =>
    scenario.kind === candidate.kind &&
    scenario.characterId === candidate.characterId &&
    scenario.prompt === candidate.prompt &&
    scenario.context === candidate.context &&
    sameStrings(scenario.acceptableSignals, candidate.acceptableSignals) &&
    sameStrings(scenario.criticalMisses, candidate.criticalMisses) &&
    scenario.retryPrompt === candidate.retryPrompt &&
    scenario.order === candidate.order &&
    scenario.sourceEvidence.length === candidate.evidenceCount &&
    scenario.expectedRuleIds.length === 1,
  );
  if (definition === undefined) throw new ScenarioEngineError("INVALID_STATE", "scenario is outside the finite bookshop set");
  return definition;
}

function sameInstructionCard(left: InstructionCard, right: InstructionCard): boolean {
  return (
    left.id === right.id &&
    left.sourceConversationId === right.sourceConversationId &&
    left.sourceRevision === right.sourceRevision &&
    left.text === right.text &&
    left.situation === right.situation &&
    left.expectedAction === right.expectedAction &&
    sameStrings(left.exceptions, right.exceptions) &&
    sameStrings(left.sourceEvidence, right.sourceEvidence) &&
    left.confidence === right.confidence &&
    left.status === right.status &&
    left.supersedesId === right.supersedesId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function evidenceMatchesInstruction(
  evidence: SourceEvidence,
  instruction: InstructionCard,
): boolean {
  return (
    evidence.sourceConversationId === instruction.sourceConversationId &&
    evidence.sourceRevision === instruction.sourceRevision
  );
}

function validateStandardEvaluationContext(
  scenario: Scenario,
  definition: EvaluationDefinition,
  instructions: readonly InstructionCard[],
  evidenceRecords: ReadonlyMap<string, SourceEvidence>,
  changeProposal: ChangeProposal | undefined,
): void {
  if (
    changeProposal !== undefined ||
    scenario.sourceRevision !== BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision ||
    instructions.length !== 1 ||
    instructions[0]?.id !== scenario.expectedRuleIds[0] ||
    instructions[0]?.status !== "confirmed" ||
    instructions[0]?.sourceRevision !== scenario.sourceRevision ||
    !sameStringSet(instructions[0]?.sourceEvidence ?? [], scenario.sourceEvidence)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "standard evaluation context does not match the persisted scenario",
    );
  }

  const instruction = instructions[0];
  const extractionDefinition = INITIAL_CARD_DEFINITIONS[definition.order - 1];
  if (instruction === undefined || extractionDefinition === undefined) {
    throw new ScenarioEngineError("INVALID_STATE", "standard evaluation rule is missing");
  }
  const evidence = evidenceRecordForInstruction(instruction, evidenceRecords);
  if (
    !evidenceMatchesInstruction(evidence, instruction) ||
    !evidenceMatchesDefinition(evidence, extractionDefinition)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "standard evaluation evidence does not support the persisted rule",
    );
  }
}

function validateChangeEvaluationContext(
  scenario: Scenario,
  instructions: readonly InstructionCard[],
  evidenceRecords: ReadonlyMap<string, SourceEvidence>,
  changeProposalInput: ChangeProposal | undefined,
): void {
  if (changeProposalInput === undefined) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill evaluation requires its confirmed proposal",
    );
  }
  const proposal = parseCanonical(
    changeProposalSchema,
    changeProposalInput,
    "evaluation change proposal",
  );
  const instructionIds = instructions.map(({ id }) => id);
  if (
    proposal.status !== "confirmed" ||
    scenario.sourceRevision !== BOOKSHOP_FIXTURE_IDS.updateSourceRevision ||
    proposal.previousSourceRevision !== BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision ||
    proposal.sourceRevision !== BOOKSHOP_FIXTURE_IDS.updateSourceRevision ||
    instructions.length !== 2 ||
    new Set(instructionIds).size !== instructions.length
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill evaluation context does not match the supported fixture update",
    );
  }

  const previous = instructions.find(({ id }) => id === proposal.previousInstructionId);
  const replacement = instructions.find(
    ({ id }) => id === proposal.replacementInstruction.id,
  );
  const requiredEvidence = [
    ...proposal.previousSourceEvidence,
    ...proposal.replacementInstruction.sourceEvidence,
  ];
  if (
    previous === undefined ||
    replacement === undefined ||
    previous.status !== "changed" ||
    previous.sourceRevision !== proposal.previousSourceRevision ||
    !sameStringSet(previous.sourceEvidence, proposal.previousSourceEvidence) ||
    replacement.status !== "confirmed" ||
    !sameInstructionCard(replacement, proposal.replacementInstruction) ||
    previous.sourceConversationId === replacement.sourceConversationId ||
    !sameStrings(scenario.expectedRuleIds, [replacement.id]) ||
    !sameStringSet(scenario.sourceEvidence, requiredEvidence)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill evaluation rules do not match the persisted proposal",
    );
  }

  const previousEvidence = evidenceRecordForInstruction(previous, evidenceRecords);
  const replacementEvidence = evidenceRecordForInstruction(replacement, evidenceRecords);
  if (
    !evidenceMatchesInstruction(previousEvidence, previous) ||
    !evidenceMatchesDefinition(previousEvidence, INITIAL_CARD_DEFINITIONS[0]!) ||
    !evidenceMatchesInstruction(replacementEvidence, replacement) ||
    !evidenceMatchesDefinition(replacementEvidence, UPDATE_CARD_DEFINITION)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill evaluation evidence does not support the persisted proposal",
    );
  }
}

function validateEvaluationContext(
  scenario: Scenario,
  definition: EvaluationDefinition,
  input: EvaluateScenarioInput,
): void {
  const instructions = parsedInstructions(input.instructions);
  if (new Set(instructions.map(({ id }) => id)).size !== instructions.length) {
    throw new ScenarioEngineError("INVALID_STATE", "evaluation instruction IDs must be unique");
  }
  const evidence = parsedEvidence(input.sourceEvidence);
  if (!sameStringSet(evidence.map(({ id }) => id), scenario.sourceEvidence)) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "evaluation evidence must exactly resolve the persisted scenario",
    );
  }
  const evidenceRecords = new Map(evidence.map((record) => [record.id, record]));

  if (scenario.kind === "standard") {
    validateStandardEvaluationContext(
      scenario,
      definition,
      instructions,
      evidenceRecords,
      input.changeProposal,
    );
    return;
  }
  validateChangeEvaluationContext(
    scenario,
    instructions,
    evidenceRecords,
    input.changeProposal,
  );
}

function normalizeResponse(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\p{P}+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function evaluateScenario(input: EvaluateScenarioInput): ScenarioEvaluation {
  const scenario = parseCanonical(scenarioSchema, input.scenario, "scenario");
  const definition = evaluationDefinition(scenario);
  validateEvaluationContext(scenario, definition, input);
  const response = normalizeResponse(input.responseText);
  const criticalMiss = definition.criticalMisses.some((signal) => response.includes(normalizeResponse(signal)));
  const matchedSignals = definition.acceptableSignals.filter((signal) => response.includes(normalizeResponse(signal))).length;
  const result = criticalMiss
    ? "missed"
    : matchedSignals === definition.acceptableSignals.length
      ? "covered"
      : matchedSignals > 0
        ? "partial"
        : "missed";
  const expectedRuleIds = [...scenario.expectedRuleIds];
  const validated = parseCanonical(attemptSchema, {
    id: "90000000-0000-4000-8000-000000000001",
    scenarioId: scenario.id,
    sourceRevision: scenario.sourceRevision,
    instructionRevision: "engine-evaluation",
    responseText: input.responseText,
    inputMode: "text",
    matchedRuleIds: result === "covered" ? expectedRuleIds : [],
    missedRuleIds: result === "covered" ? [] : expectedRuleIds,
    sourceEvidence: scenario.sourceEvidence,
    result,
    feedback: definition.feedback[result],
    createdAt: "2000-01-01T00:00:00.000Z",
  }, "scenario evaluation");
  return {
    result: validated.result,
    matchedRuleIds: validated.matchedRuleIds,
    missedRuleIds: validated.missedRuleIds,
    sourceEvidence: validated.sourceEvidence,
    feedback: validated.feedback,
  };
}

function evidenceById(values: readonly SourceEvidence[]): Map<string, SourceEvidence> {
  const parsed = parsedEvidence(values);
  return new Map(parsed.map((value) => [value.id, value]));
}

function resolveEvidence(
  ids: readonly SourceEvidenceId[],
  records: ReadonlyMap<string, SourceEvidence>,
): SourceEvidence[] {
  return ids.map((id) => {
    const record = records.get(id);
    if (record === undefined) {
      throw new ScenarioEngineError("INVALID_STATE", `source evidence ${id} is missing`);
    }
    return record;
  });
}

export function compareInstructionRevisions(
  input: CompareInstructionRevisionsInput,
): CompareSourceResponse {
  const request = parseCanonical(compareSourceRequestSchema, {
    sourceConversationId: input.previousSourceConversationId,
    newSourceConversationId: input.newSourceConversationId,
    previousInstructionRevision: input.previousInstructionRevision,
  }, "comparison request");
  if (request.previousInstructionRevision !== BOOKSHOP_FIXTURE_IDS.initialInstructionRevision) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "comparison requires the current bookshop instruction revision");
  }

  const previousInstructions = parsedInstructions(input.previousInstructions);
  const candidates = parsedInstructions(input.replacementCandidates);
  const records = evidenceById(input.sourceEvidence);
  if (
    previousInstructions.some(({ sourceConversationId }) => sourceConversationId !== request.sourceConversationId) ||
    candidates.some(({ sourceConversationId }) => sourceConversationId !== request.newSourceConversationId)
  ) {
    throw new ScenarioEngineError("INVALID_STATE", "comparison instructions must match their source conversations");
  }
  if (new Set(previousInstructions.map(({ sourceRevision }) => sourceRevision)).size > 1) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "previous instructions contain multiple source revisions");
  }

  const replacements = candidates.filter((candidate) => {
    if (
      candidate.status !== "needsReview" ||
      !normalizeResponse(candidate.text).includes("seven calendar days")
    ) {
      return false;
    }
    const evidence = evidenceRecordForInstruction(candidate, records);
    if (
      evidence.sourceConversationId !== request.newSourceConversationId ||
      evidence.sourceRevision !== candidate.sourceRevision ||
      !evidenceMatchesDefinition(evidence, UPDATE_CARD_DEFINITION)
    ) {
      throw new ScenarioEngineError(
        "INVALID_STATE",
        "replacement instruction is not grounded in the supported fixture update",
      );
    }
    return true;
  });
  if (replacements.length > 1) {
    throw new ScenarioEngineError("INVALID_STATE", "comparison found ambiguous replacement instructions");
  }
  const replacement = replacements[0];
  if (replacement === undefined) {
    return parseCanonical(compareSourceResponseSchema, {
      previousSourceConversationId: request.sourceConversationId,
      newSourceConversationId: request.newSourceConversationId,
      previousInstructionRevision: request.previousInstructionRevision,
      changes: [],
      sourceEvidence: [],
    }, "comparison response");
  }

  const previous = previousInstructions.find(
    (instruction) => instruction.id === replacement.supersedesId,
  );
  if (previous === undefined || previous.status !== "confirmed") {
    throw new ScenarioEngineError("INVALID_STATE", "explicit reservation update does not match a confirmed previous rule");
  }
  const previousEvidence = evidenceRecordForInstruction(previous, records);
  if (
    previousEvidence.sourceConversationId !== request.sourceConversationId ||
    previousEvidence.sourceRevision !== previous.sourceRevision ||
    !evidenceMatchesDefinition(previousEvidence, INITIAL_CARD_DEFINITIONS[0]!)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "previous instruction is not grounded in the supported fixture source",
    );
  }
  if (previous.sourceRevision === replacement.sourceRevision) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "replacement must use a newer source revision");
  }

  const proposal = parseCanonical(changeProposalSchema, {
    id: input.changeProposalId,
    previousInstructionId: previous.id,
    previousSourceRevision: previous.sourceRevision,
    previousSourceEvidence: previous.sourceEvidence,
    replacementInstruction: replacement,
    sourceRevision: replacement.sourceRevision,
    status: "needsReview",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  }, "change proposal");
  const outputEvidence = [
    ...resolveEvidence(previous.sourceEvidence, records),
    ...resolveEvidence(replacement.sourceEvidence, records),
  ];
  return parseCanonical(compareSourceResponseSchema, {
    previousSourceConversationId: request.sourceConversationId,
    newSourceConversationId: request.newSourceConversationId,
    previousInstructionRevision: request.previousInstructionRevision,
    changes: [proposal],
    sourceEvidence: outputEvidence,
  }, "comparison response");
}

export function generateChangeDrill(input: GenerateChangeDrillInput): ChangeDrillGeneration {
  if (input.sourceKind !== "fixture") {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "the deterministic bookshop Change Drill requires fixture data",
    );
  }
  const proposal = parseCanonical(changeProposalSchema, input.confirmedProposal, "confirmed change proposal");
  const previousInstruction = parseCanonical(instructionCardSchema, input.previousInstruction, "previous instruction");
  if (
    proposal.status !== "confirmed" ||
    proposal.replacementInstruction.status !== "confirmed" ||
    previousInstruction.status !== "changed"
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill requires a confirmed proposal, changed old rule, and confirmed replacement",
    );
  }
  if (
    previousInstruction.id !== proposal.previousInstructionId ||
    previousInstruction.sourceRevision !== proposal.previousSourceRevision ||
    !sameStringSet(previousInstruction.sourceEvidence, proposal.previousSourceEvidence)
  ) {
    throw new ScenarioEngineError("REVISION_CONFLICT", "previous instruction does not match the confirmed proposal");
  }

  const records = evidenceById(input.sourceEvidence);
  const requiredEvidenceIds = [
    ...proposal.previousSourceEvidence,
    ...proposal.replacementInstruction.sourceEvidence,
  ];
  const outputEvidence = resolveEvidence(requiredEvidenceIds, records);
  const previousEvidence = evidenceRecordForInstruction(previousInstruction, records);
  const replacementEvidence = evidenceRecordForInstruction(
    proposal.replacementInstruction,
    records,
  );
  if (
    !evidenceMatchesDefinition(previousEvidence, INITIAL_CARD_DEFINITIONS[0]!) ||
    !evidenceMatchesDefinition(replacementEvidence, UPDATE_CARD_DEFINITION)
  ) {
    throw new ScenarioEngineError(
      "INVALID_STATE",
      "Change Drill evidence does not match the supported fixture update",
    );
  }
  const practiceSet = {
    id: input.practiceSetId,
    learnerId: input.learnerId,
    sourceConversationId: proposal.replacementInstruction.sourceConversationId,
    sourceRevision: proposal.sourceRevision,
    sourceKind: parseCanonical(sourceKindSchema, input.sourceKind, "source kind"),
    title: input.title,
    kind: "changeDrill" as const,
    instructionRevision: parseCanonical(instructionRevisionSchema, input.instructionRevision, "instruction revision"),
    status: "ready" as const,
    scenarioIds: [input.scenarioId],
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
  const scenario = {
    id: input.scenarioId,
    practiceSetId: input.practiceSetId,
    sourceRevision: proposal.sourceRevision,
    kind: "changeDrill" as const,
    characterId: "guide-maya" as const,
    prompt: CHANGE_SCENARIO_DEFINITION.prompt,
    context: CHANGE_SCENARIO_DEFINITION.context,
    expectedRuleIds: [proposal.replacementInstruction.id],
    acceptableSignals: [...CHANGE_SCENARIO_DEFINITION.acceptableSignals],
    criticalMisses: [...CHANGE_SCENARIO_DEFINITION.criticalMisses],
    retryPrompt: CHANGE_SCENARIO_DEFINITION.retryPrompt,
    sourceEvidence: requiredEvidenceIds,
    order: 1,
  };
  const validated = parseCanonical(getPracticeSetResponseSchema, {
    practiceSet,
    scenarios: [scenario],
    instructions: [previousInstruction, proposal.replacementInstruction],
    changeProposal: proposal,
    sourceEvidence: outputEvidence,
    progress: { completed: 0, total: 1 },
  }, "Change Drill response");
  return {
    practiceSet: validated.practiceSet,
    scenarios: validated.scenarios,
    sourceEvidence: validated.sourceEvidence,
  };
}
