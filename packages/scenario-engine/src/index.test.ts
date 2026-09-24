import { describe, expect, it } from "vitest";

import {
  beeSourceSchema,
  changeProposalSchema,
  compareSourceResponseSchema,
  createPracticeSetResponseSchema,
  extractInstructionsResponseSchema,
  getPracticeSetResponseSchema,
  instructionCardSchema,
  scenarioSchema,
  sourceEvidenceSchema,
  type BeeSource,
  type ChangeProposal,
  type CompareSourceResponse,
  type CreatePracticeSetResponse,
  type ExcludedRange,
  type ExtractInstructionsResponse,
  type InstructionCard,
  type Scenario,
  type SourceEvidence,
  type SourceKind,
} from "@firstday/contracts";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};
import updateJson from "../../../fixtures/transcripts/bookshop-policy-update.json" with {
  type: "json",
};
import * as engine from "./index.js";

type EngineErrorCode =
  | "VALIDATION_ERROR"
  | "REVISION_CONFLICT"
  | "NO_CONFIRMED_INSTRUCTIONS"
  | "INVALID_STATE";

type ExtractFixtureRequest = {
  sourceConversationId: string;
  sourceRevision: string;
  excludedRanges: ExcludedRange[];
  instructionRevision: string;
  instructionIds: readonly string[];
  supersedesInstructionId?: string;
  timestamp: string;
};

type StandardPracticeInput = {
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

type ScenarioEvaluation = {
  result: "covered" | "partial" | "missed" | "needsReview";
  matchedRuleIds: string[];
  missedRuleIds: string[];
  sourceEvidence: string[];
  feedback: string;
};

type ScenarioEvaluationInput = {
  scenario: Scenario;
  responseText: string;
  instructions: readonly InstructionCard[];
  sourceEvidence: readonly SourceEvidence[];
  changeProposal?: ChangeProposal;
};

type ComparisonInput = {
  previousSourceConversationId: string;
  newSourceConversationId: string;
  previousInstructionRevision: string;
  previousInstructions: readonly InstructionCard[];
  replacementCandidates: readonly InstructionCard[];
  sourceEvidence: readonly SourceEvidence[];
  changeProposalId: string;
  timestamp: string;
};

type ChangeDrillInput = {
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

type ChangeDrillOutput = {
  practiceSet: CreatePracticeSetResponse["practiceSet"];
  scenarios: Scenario[];
  sourceEvidence: SourceEvidence[];
};

const onboardingSource = beeSourceSchema.parse(onboardingJson);
const updateSource = beeSourceSchema.parse(updateJson);
const initialExtraction = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const updateExtraction = extractInstructionsResponseSchema.parse(goldenJson.updateExtraction);
const standardPractice = createPracticeSetResponseSchema.parse(goldenJson.standardPractice);
const comparison = compareSourceResponseSchema.parse(goldenJson.comparison);
const changeDrill = {
  practiceSet: getPracticeSetResponseSchema.shape.practiceSet.parse(
    goldenJson.changeDrill.practiceSet,
  ),
  scenarios: goldenJson.changeDrill.scenarios.map((value) => scenarioSchema.parse(value)),
  sourceEvidence: goldenJson.changeDrill.sourceEvidence.map((value) =>
    sourceEvidenceSchema.parse(value),
  ),
};

const ids = goldenJson.ids;
const INITIAL_TIMESTAMP = "2026-09-10T16:01:00.000Z";
const PRACTICE_TIMESTAMP = "2026-09-10T16:02:00.000Z";
const UPDATE_TIMESTAMP = "2026-09-17T16:01:00.000Z";
const COMPARE_TIMESTAMP = "2026-09-17T16:02:00.000Z";
const DRILL_TIMESTAMP = "2026-09-17T16:03:00.000Z";

function publicFunction<T>(name: string): T {
  const value = (engine as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeTypeOf("function");
  return value as T;
}

function expectEngineError(run: () => unknown, code: EngineErrorCode): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ name: "ScenarioEngineError", code });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withDuplicateEvidence(
  values: readonly SourceEvidence[],
  conflicting: boolean,
): SourceEvidence[] {
  const records = clone(values);
  const duplicate = clone(records[0]!);
  if (conflicting) {
    duplicate.quote = "A conflicting record with the same evidence ID.";
    return [duplicate, ...records];
  }
  return [...records, duplicate];
}

function extract(
  source: BeeSource,
  request: ExtractFixtureRequest,
): ExtractInstructionsResponse {
  return publicFunction<
    (fixture: BeeSource, input: ExtractFixtureRequest) => ExtractInstructionsResponse
  >("extractFixtureInstructions")(source, request);
}

function initialExtractRequest(
  excludedRanges: ExcludedRange[] = [],
): ExtractFixtureRequest {
  return {
    sourceConversationId: ids.onboardingSourceConversationId,
    sourceRevision: onboardingSource.revision,
    excludedRanges,
    instructionRevision: "bookshop-instructions-r1",
    instructionIds: [
      ids.reservationInstructionId,
      ids.pickupInstructionId,
      ids.damagedReturnInstructionId,
    ],
    timestamp: INITIAL_TIMESTAMP,
  };
}

function updateExtractRequest(): ExtractFixtureRequest {
  return {
    sourceConversationId: ids.updateSourceConversationId,
    sourceRevision: updateSource.revision,
    excludedRanges: [],
    instructionRevision: "bookshop-instructions-r2",
    instructionIds: [ids.replacementInstructionId],
    supersedesInstructionId: ids.reservationInstructionId,
    timestamp: UPDATE_TIMESTAMP,
  };
}

function confirmedInitialInstructions(): InstructionCard[] {
  return initialExtraction.items.map((item) =>
    instructionCardSchema.parse({ ...item, status: "confirmed" }),
  );
}

function standardInput(
  instructions: readonly InstructionCard[] = confirmedInitialInstructions(),
): StandardPracticeInput {
  return {
    learnerId: ids.learnerId,
    sourceConversationId: ids.onboardingSourceConversationId,
    sourceRevision: onboardingSource.revision,
    sourceKind: "fixture",
    instructionRevision: "bookshop-instructions-r1",
    title: "Bookshop first shift",
    practiceSetId: ids.standardPracticeSetId,
    scenarioIds: [
      ids.reservationScenarioId,
      ids.pickupScenarioId,
      ids.damagedReturnScenarioId,
    ],
    instructions,
    sourceEvidence: initialExtraction.sourceEvidence,
    timestamp: PRACTICE_TIMESTAMP,
  };
}

function compareInput(
  replacementCandidates: readonly InstructionCard[] = updateExtraction.items,
): ComparisonInput {
  return {
    previousSourceConversationId: ids.onboardingSourceConversationId,
    newSourceConversationId: ids.updateSourceConversationId,
    previousInstructionRevision: "bookshop-instructions-r1",
    previousInstructions: confirmedInitialInstructions(),
    replacementCandidates,
    sourceEvidence: [
      ...initialExtraction.sourceEvidence,
      ...updateExtraction.sourceEvidence,
    ],
    changeProposalId: ids.changeProposalId,
    timestamp: COMPARE_TIMESTAMP,
  };
}

function confirmedChangeContext(): {
  proposal: ChangeProposal;
  previousInstruction: InstructionCard;
} {
  const proposed = comparison.changes[0];
  const previous = initialExtraction.items[0];
  expect(proposed).toBeDefined();
  expect(previous).toBeDefined();
  return {
    proposal: changeProposalSchema.parse({
      ...proposed,
      status: "confirmed",
      replacementInstruction: {
        ...proposed!.replacementInstruction,
        status: "confirmed",
      },
    }),
    previousInstruction: instructionCardSchema.parse({
      ...previous,
      status: "changed",
    }),
  };
}

function changeDrillInput(): ChangeDrillInput {
  const { previousInstruction, proposal } = confirmedChangeContext();
  return {
    learnerId: ids.learnerId,
    sourceKind: "fixture",
    instructionRevision: "bookshop-instructions-r2",
    title: "Bookshop reservation update",
    confirmedProposal: proposal,
    previousInstruction,
    sourceEvidence: comparison.sourceEvidence,
    practiceSetId: ids.changeDrillPracticeSetId,
    scenarioId: ids.changeDrillScenarioId,
    timestamp: DRILL_TIMESTAMP,
  };
}

function standardEvaluationContext(scenario: Scenario): Omit<
  ScenarioEvaluationInput,
  "scenario" | "responseText"
> {
  const ruleIds = new Set(scenario.expectedRuleIds);
  const instructions = confirmedInitialInstructions().filter(({ id }) => ruleIds.has(id));
  const evidenceIds = new Set(instructions.flatMap(({ sourceEvidence }) => sourceEvidence));
  return {
    instructions,
    sourceEvidence: initialExtraction.sourceEvidence.filter(({ id }) =>
      evidenceIds.has(id),
    ),
  };
}

function changeEvaluationContext(): Omit<
  ScenarioEvaluationInput,
  "scenario" | "responseText"
> {
  const { previousInstruction, proposal } = confirmedChangeContext();
  return {
    instructions: [previousInstruction, proposal.replacementInstruction],
    sourceEvidence: comparison.sourceEvidence,
    changeProposal: proposal,
  };
}

describe("canonical bookshop fixtures", () => {
  it("exports the stable fixture identifiers used by API and demo wiring", () => {
    expect((engine as Record<string, unknown>).BOOKSHOP_FIXTURE_IDS).toMatchObject(ids);
  });

  it("validates both BeeSource fixtures and keeps transcript as an exact text-only join", () => {
    for (const source of [onboardingSource, updateSource]) {
      expect(source.sourceKind).toBe("fixture");
      expect(source.transcript).toBe(source.utterances.map(({ text }) => text).join("\n"));
    }
  });

  it("validates every golden payload against canonical contract schemas", () => {
    expect(extractInstructionsResponseSchema.safeParse(initialExtraction).success).toBe(true);
    expect(extractInstructionsResponseSchema.safeParse(updateExtraction).success).toBe(true);
    expect(createPracticeSetResponseSchema.safeParse(standardPractice).success).toBe(true);
    expect(compareSourceResponseSchema.safeParse(comparison).success).toBe(true);
    expect(changeDrill.scenarios).toHaveLength(1);
    expect(changeDrill.sourceEvidence.every((item) => sourceEvidenceSchema.safeParse(item).success))
      .toBe(true);
  });
});

describe("fixture instruction extraction", () => {
  it("extracts exactly three evidence-backed review cards and no questions", () => {
    expect(extract(onboardingSource, initialExtractRequest())).toEqual(initialExtraction);
  });

  it("extracts the explicit seven-day replacement from the update", () => {
    expect(extract(updateSource, updateExtractRequest())).toEqual(updateExtraction);
  });

  it("rejects an update instruction ID equal to the instruction it supersedes", () => {
    expectEngineError(
      () =>
        extract(updateSource, {
          ...updateExtractRequest(),
          instructionIds: [ids.reservationInstructionId],
        }),
      "VALIDATION_ERROR",
    );
  });

  it("uses half-open exclusion overlap and allows a boundary touch", () => {
    expect(extract(onboardingSource, initialExtractRequest([{ startMs: 17_400, endMs: 17_900 }])))
      .toEqual(initialExtraction);

    const excluded = extract(
      onboardingSource,
      initialExtractRequest([{ startMs: 17_399, endMs: 17_900 }]),
    );
    expect(excluded.items.map(({ id }) => id)).toEqual([
      ids.pickupInstructionId,
      ids.damagedReturnInstructionId,
    ]);
    expect(excluded.sourceEvidence.map(({ id }) => id)).toEqual([
      initialExtraction.sourceEvidence[1]!.id,
      initialExtraction.sourceEvidence[2]!.id,
    ]);
  });

  it("rejects unknown fixtures and revision conflicts with typed engine errors", () => {
    expectEngineError(
      () => extract({ ...onboardingSource, id: "unknown-fixture" }, initialExtractRequest()),
      "INVALID_STATE",
    );
    expectEngineError(
      () =>
        extract(onboardingSource, {
          ...initialExtractRequest(),
          sourceRevision: "stale-revision",
        }),
      "REVISION_CONFLICT",
    );
  });

  it("rejects a known fixture whose instruction utterance no longer supports the rule", () => {
    const changedSource = clone(onboardingSource);
    changedSource.utterances[2]!.text = "Reservations are handled case by case.";
    changedSource.transcript = changedSource.utterances.map(({ text }) => text).join("\n");
    expectEngineError(
      () => extract(changedSource, initialExtractRequest()),
      "INVALID_STATE",
    );
  });

  it("does not mutate fixture sources, requests, or returned golden data", () => {
    const source = clone(onboardingSource);
    const request = initialExtractRequest();
    const before = clone({ source, request });
    const first = extract(source, request);
    const second = extract(source, request);
    expect({ source, request }).toEqual(before);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("standard practice generation", () => {
  it("generates exactly three deterministic canonical scenarios", () => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");
    expect(generate(standardInput())).toEqual(standardPractice);
  });

  it("tolerates learner-edited card wording when stable IDs and evidence remain", () => {
    const edited = confirmedInitialInstructions();
    edited[1] = instructionCardSchema.parse({
      ...edited[1],
      text: "Ask for the reservation name and the customer's phone number.",
      expectedAction: "Verify both saved pickup details before handing over the title.",
    });
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");
    expect(generate(standardInput(edited))).toEqual(standardPractice);
  });

  it("rejects evidence whose known fixture span carries a different quote", () => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");
    const sourceEvidence = clone(initialExtraction.sourceEvidence);
    sourceEvidence[0]!.quote = "Reservations are handled case by case.";

    expectEngineError(
      () => generate({ ...standardInput(), sourceEvidence }),
      "INVALID_STATE",
    );
  });

  it("does not label the fixture-only generator as live Bee behavior", () => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");

    expectEngineError(
      () => generate({ ...standardInput(), sourceKind: "bee" }),
      "INVALID_STATE",
    );
  });

  it.each([
    ["identical", false],
    ["conflicting", true],
  ] as const)("rejects %s duplicate evidence IDs", (_label, conflicting) => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");

    expectEngineError(
      () =>
        generate({
          ...standardInput(),
          sourceEvidence: withDuplicateEvidence(
            initialExtraction.sourceEvidence,
            conflicting,
          ),
        }),
      "INVALID_STATE",
    );
  });

  it("rejects unconfirmed, missing, duplicate, and revision-mismatched rules", () => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");
    expectEngineError(
      () => generate(standardInput(initialExtraction.items)),
      "NO_CONFIRMED_INSTRUCTIONS",
    );
    expectEngineError(
      () => generate(standardInput(confirmedInitialInstructions().slice(0, 2))),
      "NO_CONFIRMED_INSTRUCTIONS",
    );
    const duplicate = confirmedInitialInstructions();
    duplicate[2] = duplicate[1]!;
    expectEngineError(
      () => generate(standardInput(duplicate)),
      "NO_CONFIRMED_INSTRUCTIONS",
    );
    const mismatched = confirmedInitialInstructions();
    mismatched[0] = instructionCardSchema.parse({
      ...mismatched[0],
      sourceRevision: "stale-revision",
    });
    expectEngineError(() => generate(standardInput(mismatched)), "REVISION_CONFLICT");
  });

  it("is repeatable and leaves all generation inputs unchanged", () => {
    const generate = publicFunction<
      (input: StandardPracticeInput) => CreatePracticeSetResponse
    >("generateStandardPracticeSet");
    const input = standardInput();
    const before = clone(input);
    expect(generate(input)).toEqual(generate(input));
    expect(input).toEqual(before);
  });
});

describe("bounded scenario evaluation", () => {
  it("matches every covered, partial, and missed golden result and feedback", () => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");
    for (const example of goldenJson.evaluations) {
      const scenario = standardPractice.scenarios.find(({ id }) => id === example.scenarioId);
      expect(scenario).toBeDefined();
      expect(
        evaluate({
          scenario: scenario!,
          responseText: example.responseText,
          ...standardEvaluationContext(scenario!),
        }),
      ).toEqual(example.expected);
    }
  });

  it("normalizes Unicode punctuation/whitespace and lets a critical miss override signals", () => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");
    const scenario = standardPractice.scenarios[0]!;
    expect(
      evaluate({
        scenario,
        responseText:
          "Five calendar days; Saturday is day six and outside the hold—but it is still inside the hold.",
        ...standardEvaluationContext(scenario),
      }),
    ).toEqual(goldenJson.evaluations[2]!.expected);
  });

  it("rejects scenarios outside the finite generated set", () => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");
    const scenario = standardPractice.scenarios[0]!;
    expectEngineError(
      () =>
        evaluate({
          scenario: {
            ...scenario,
            context: "An unsupported scenario context",
          },
          responseText: "five calendar days",
          ...standardEvaluationContext(scenario),
        }),
      "INVALID_STATE",
    );
  });

  it.each([
    [
      "source revision",
      scenarioSchema.parse({
        ...standardPractice.scenarios[0]!,
        sourceRevision: updateSource.revision,
      }),
    ],
    [
      "expected rule",
      scenarioSchema.parse({
        ...standardPractice.scenarios[0]!,
        expectedRuleIds: [ids.pickupInstructionId],
      }),
    ],
    [
      "source evidence",
      scenarioSchema.parse({
        ...standardPractice.scenarios[0]!,
        sourceEvidence: [initialExtraction.sourceEvidence[1]!.id],
      }),
    ],
  ] as const)("rejects altered standard scenario %s provenance", (_label, altered) => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");
    const trustedScenario = standardPractice.scenarios[0]!;

    expectEngineError(
      () =>
        evaluate({
          scenario: altered,
          responseText: goldenJson.evaluations[0]!.responseText,
          ...standardEvaluationContext(trustedScenario),
        }),
      "INVALID_STATE",
    );
  });
});

describe("instruction revision comparison", () => {
  it("detects only the explicit five-to-seven-day replacement with exact evidence", () => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    expect(compare(compareInput())).toEqual(comparison);
  });

  it("does not infer deletions when rules are absent from an update", () => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    expect(compare(compareInput([]))).toEqual({
      previousSourceConversationId: ids.onboardingSourceConversationId,
      newSourceConversationId: ids.updateSourceConversationId,
      previousInstructionRevision: "bookshop-instructions-r1",
      changes: [],
      sourceEvidence: [],
    });
  });

  it("rejects a replacement backed by an altered quote at the known update span", () => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    const sourceEvidence = clone(compareInput().sourceEvidence);
    sourceEvidence[sourceEvidence.length - 1]!.quote =
      "Reservations are reviewed individually.";

    expectEngineError(
      () => compare({ ...compareInput(), sourceEvidence }),
      "INVALID_STATE",
    );
  });

  it("rejects ambiguous duplicate replacement candidates", () => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    const duplicate = instructionCardSchema.parse({
      ...updateExtraction.items[0],
      id: "20000000-0000-4000-8000-000000000005",
    });

    expectEngineError(
      () => compare(compareInput([...updateExtraction.items, duplicate])),
      "INVALID_STATE",
    );
  });

  it.each([
    ["identical", false],
    ["conflicting", true],
  ] as const)("rejects %s duplicate comparison evidence IDs", (_label, conflicting) => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    const input = compareInput();

    expectEngineError(
      () =>
        compare({
          ...input,
          sourceEvidence: withDuplicateEvidence(input.sourceEvidence, conflicting),
        }),
      "INVALID_STATE",
    );
  });

  it("rejects comparison identity and revision conflicts", () => {
    const compare = publicFunction<(input: ComparisonInput) => CompareSourceResponse>(
      "compareInstructionRevisions",
    );
    expectEngineError(
      () =>
        compare({
          ...compareInput(),
          newSourceConversationId: ids.onboardingSourceConversationId,
        }),
      "VALIDATION_ERROR",
    );
    expectEngineError(
      () =>
        compare({
          ...compareInput(),
          previousInstructionRevision: "stale-instruction-revision",
        }),
      "REVISION_CONFLICT",
    );
  });
});

describe("Change Drill generation", () => {
  it("generates one replacement-only drill citing exact old and new evidence", () => {
    const generate = publicFunction<(input: ChangeDrillInput) => ChangeDrillOutput>(
      "generateChangeDrill",
    );
    expect(generate(changeDrillInput())).toEqual(changeDrill);
  });

  it("evaluates all Change Drill golden outcomes against the replacement rule", () => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");
    for (const example of goldenJson.changeEvaluations) {
      expect(
        evaluate({
          scenario: changeDrill.scenarios[0]!,
          responseText: example.responseText,
          ...changeEvaluationContext(),
        }),
      ).toEqual(example.expected);
    }
  });

  it.each([
    [
      "source revision",
      scenarioSchema.parse({
        ...changeDrill.scenarios[0]!,
        sourceRevision: onboardingSource.revision,
      }),
    ],
    [
      "expected rule",
      scenarioSchema.parse({
        ...changeDrill.scenarios[0]!,
        expectedRuleIds: [ids.reservationInstructionId],
      }),
    ],
    [
      "source evidence",
      scenarioSchema.parse({
        ...changeDrill.scenarios[0]!,
        sourceEvidence: [
          comparison.sourceEvidence[0]!.id,
          initialExtraction.sourceEvidence[1]!.id,
        ],
      }),
    ],
  ] as const)("rejects altered Change Drill %s provenance", (_label, altered) => {
    const evaluate = publicFunction<
      (input: ScenarioEvaluationInput) => ScenarioEvaluation
    >("evaluateScenario");

    expectEngineError(
      () =>
        evaluate({
          scenario: altered,
          responseText: goldenJson.changeEvaluations[0]!.responseText,
          ...changeEvaluationContext(),
        }),
      "INVALID_STATE",
    );
  });

  it("rejects a Change Drill whose old or new fixture evidence quote was altered", () => {
    const generate = publicFunction<(input: ChangeDrillInput) => ChangeDrillOutput>(
      "generateChangeDrill",
    );
    const sourceEvidence = clone(changeDrillInput().sourceEvidence);
    sourceEvidence[1]!.quote = "The reservation window depends on the customer.";

    expectEngineError(
      () => generate({ ...changeDrillInput(), sourceEvidence }),
      "INVALID_STATE",
    );
  });

  it("does not label the fixture-only Change Drill as live Bee behavior", () => {
    const generate = publicFunction<(input: ChangeDrillInput) => ChangeDrillOutput>(
      "generateChangeDrill",
    );

    expectEngineError(
      () => generate({ ...changeDrillInput(), sourceKind: "bee" }),
      "INVALID_STATE",
    );
  });

  it.each([
    ["identical", false],
    ["conflicting", true],
  ] as const)("rejects %s duplicate Change Drill evidence IDs", (_label, conflicting) => {
    const generate = publicFunction<(input: ChangeDrillInput) => ChangeDrillOutput>(
      "generateChangeDrill",
    );
    const input = changeDrillInput();

    expectEngineError(
      () =>
        generate({
          ...input,
          sourceEvidence: withDuplicateEvidence(input.sourceEvidence, conflicting),
        }),
      "INVALID_STATE",
    );
  });

  it("rejects an unconfirmed proposal and does not mutate drill inputs", () => {
    const generate = publicFunction<(input: ChangeDrillInput) => ChangeDrillOutput>(
      "generateChangeDrill",
    );
    const input = changeDrillInput();
    const before = clone(input);
    expectEngineError(
      () =>
        generate({
          ...input,
          confirmedProposal: comparison.changes[0]!,
        }),
      "INVALID_STATE",
    );
    expect(input).toEqual(before);
  });
});
