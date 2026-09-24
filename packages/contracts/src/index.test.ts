import { describe, expect, expectTypeOf, it } from "vitest";
import type { ZodType } from "zod";

import * as contracts from "./index.js";
import type {
  Attempt,
  BeeConversationSummary,
  BeeSource,
  CharacterId,
  ChangeProposal,
  CreateOpenQuestionRequestInput,
  CreateOpenQuestionRequest,
  ExcludedRange,
  InstructionCard,
  ListBeeConversationsRequest,
  ListBeeConversationsRequestInput,
  OpenQuestion,
  PracticeSet,
  Scenario,
  SourceConversation,
  SourceEvidence,
} from "./index.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const NEW_SOURCE_ID = "12111111-1111-4111-8111-111111111111";
const UNRELATED_SOURCE_ID = "13111111-1111-4111-8111-111111111111";
const LEARNER_ID = "22222222-2222-4222-8222-222222222222";
const INSTRUCTION_ID = "33333333-3333-4333-8333-333333333333";
const REPLACEMENT_INSTRUCTION_ID = "34333333-3333-4333-8333-333333333333";
const PRACTICE_SET_ID = "44444444-4444-4444-8444-444444444444";
const CHANGE_DRILL_ID = "45444444-4444-4444-8444-444444444444";
const SCENARIO_ID = "55555555-5555-4555-8555-555555555555";
const CHANGE_SCENARIO_ID = "56555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";
const QUESTION_ID = "77777777-7777-4777-8777-777777777777";
const CHANGE_ID = "88888888-8888-4888-8888-888888888888";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const NOW = "2026-09-10T16:40:00Z";
const SOURCE_REVISION = "bee-revision-7";
const NEW_SOURCE_REVISION = "bee-revision-8";
const UNRELATED_SOURCE_REVISION = "unrelated-revision-1";
const INSTRUCTION_REVISION = "instruction-revision-1";
const EVIDENCE_ID = "evd_c825b3a2c290a85c07367077b7a3e5bdc8608093ab4d8ef28d2e0efa6b87cf16";
const NEW_EVIDENCE_ID =
  "evd_82c259bc01310ac3e2ee407e868f26a4510b1eda42255570c575e335fef5f379";
const UNRELATED_EVIDENCE_ID =
  "evd_5f3e9cabd8e8a7df894fe4b82efbe20c35bb01f94d11de984807e6e03f0b075b";

const exportedContracts = contracts as Record<string, unknown>;

function contractSchema(name: string): ZodType {
  const value = exportedContracts[name];

  expect(value, `${name} must be exported`).toBeDefined();
  expect(
    typeof (value as { safeParse?: unknown } | undefined)?.safeParse,
    `${name} must be a Zod schema`,
  ).toBe("function");

  return value as ZodType;
}

function parse(name: string, input: unknown): unknown {
  return contractSchema(name).parse(input);
}

function succeeds(name: string, input: unknown): void {
  expect(contractSchema(name).safeParse(input).success).toBe(true);
}

function fails(name: string, input: unknown): void {
  expect(contractSchema(name).safeParse(input).success).toBe(false);
}

const beeSummary = {
  id: "bee-conversation-123",
  sourceKind: "bee",
  title: "Bookshop onboarding",
  startedAt: "2026-09-10T16:00:00Z",
  endedAt: "2026-09-10T16:32:00Z",
  durationMs: 1_920_000,
  status: "processed",
  revision: SOURCE_REVISION,
};

const beeSource = {
  id: beeSummary.id,
  sourceKind: beeSummary.sourceKind,
  title: beeSummary.title,
  startedAt: beeSummary.startedAt,
  endedAt: beeSummary.endedAt,
  status: "processed",
  transcript: "Reservations last five days.",
  utterances: [
    {
      id: "utterance-1",
      startMs: 12_000,
      endMs: 14_000,
      text: "Reservations last five days.",
      speaker: { label: "S1", name: "Maya" },
    },
  ],
  sourceUrl: "https://example.test/conversations/123",
  revision: SOURCE_REVISION,
  speakers: [{ label: "S1", name: "Maya" }],
};

const sourceEvidence = {
  id: EVIDENCE_ID,
  sourceConversationId: SOURCE_ID,
  sourceRevision: SOURCE_REVISION,
  startMs: 12_000,
  endMs: 14_000,
  quote: "Reservations last five days.",
  utteranceIds: ["utterance-1"],
  speakerLabel: "S1",
};

const sourceConversation = {
  id: SOURCE_ID,
  learnerId: LEARNER_ID,
  beeSourceId: beeSummary.id,
  sourceKind: "bee",
  title: beeSummary.title,
  startedAt: beeSummary.startedAt,
  endedAt: beeSummary.endedAt,
  transcriptHash: "c".repeat(64),
  sourceRevision: SOURCE_REVISION,
  consentStatus: "confirmed",
  consentConfirmedAt: NOW,
  status: "ready",
  importedAt: NOW,
  updatedAt: NOW,
};

const instruction = {
  id: INSTRUCTION_ID,
  sourceConversationId: SOURCE_ID,
  sourceRevision: SOURCE_REVISION,
  text: "Reservations last five days.",
  situation: "A customer asks about an older reservation.",
  expectedAction: "Check the reservation date before continuing.",
  exceptions: [],
  sourceEvidence: [EVIDENCE_ID],
  confidence: 0.94,
  status: "needsReview",
  createdAt: NOW,
  updatedAt: NOW,
};

const confirmedInstruction = { ...instruction, status: "confirmed" };

const scenario = {
  id: SCENARIO_ID,
  practiceSetId: PRACTICE_SET_ID,
  sourceRevision: SOURCE_REVISION,
  kind: "standard",
  characterId: "customer-rowan",
  prompt: "My reserved book is missing. What do you do?",
  context: "The customer reserved the book six days ago.",
  expectedRuleIds: [INSTRUCTION_ID],
  acceptableSignals: ["check the reservation date"],
  criticalMisses: ["promise the book is still held"],
  retryPrompt: "Check the source rule, then try once more.",
  sourceEvidence: [EVIDENCE_ID],
  order: 1,
};

const scenarios = [
  scenario,
  { ...scenario, id: "57555555-5555-4555-8555-555555555555", order: 2 },
  { ...scenario, id: "58555555-5555-4555-8555-555555555555", order: 3 },
];

const practiceSet = {
  id: PRACTICE_SET_ID,
  learnerId: LEARNER_ID,
  sourceConversationId: SOURCE_ID,
  sourceRevision: SOURCE_REVISION,
  sourceKind: "bee",
  title: "Bookshop first shift",
  kind: "standard",
  instructionRevision: INSTRUCTION_REVISION,
  status: "ready",
  scenarioIds: scenarios.map(({ id }) => id),
  createdAt: NOW,
  updatedAt: NOW,
};

const inProgressPracticeSet = {
  ...practiceSet,
  status: "inProgress",
};

const attempt = {
  id: ATTEMPT_ID,
  scenarioId: SCENARIO_ID,
  sourceRevision: SOURCE_REVISION,
  instructionRevision: INSTRUCTION_REVISION,
  responseText: "I would check the reservation date.",
  inputMode: "voice",
  matchedRuleIds: [INSTRUCTION_ID],
  missedRuleIds: [],
  sourceEvidence: [EVIDENCE_ID],
  result: "covered",
  feedback: "You checked the reservation window.",
  createdAt: NOW,
};

const openQuestion = {
  id: QUESTION_ID,
  sourceConversationId: SOURCE_ID,
  sourceRevision: SOURCE_REVISION,
  instructionId: INSTRUCTION_ID,
  question: "Does the five-day window include the reservation day?",
  sourceEvidence: [EVIDENCE_ID],
  status: "open",
  shareConsent: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const replacementInstruction = {
  ...instruction,
  id: REPLACEMENT_INSTRUCTION_ID,
  sourceConversationId: NEW_SOURCE_ID,
  sourceRevision: NEW_SOURCE_REVISION,
  text: "Reservations last seven days.",
  expectedAction: "Keep reservations for seven days.",
  sourceEvidence: [NEW_EVIDENCE_ID],
  supersedesId: INSTRUCTION_ID,
};

const changeProposal = {
  id: CHANGE_ID,
  previousInstructionId: INSTRUCTION_ID,
  previousSourceRevision: SOURCE_REVISION,
  previousSourceEvidence: [EVIDENCE_ID],
  replacementInstruction,
  sourceRevision: NEW_SOURCE_REVISION,
  status: "needsReview",
  createdAt: NOW,
  updatedAt: NOW,
};

const confirmedReplacement = {
  ...replacementInstruction,
  status: "confirmed",
};

const confirmedProposal = {
  ...changeProposal,
  replacementInstruction: confirmedReplacement,
  status: "confirmed",
};

const changedInstruction = {
  ...confirmedInstruction,
  status: "changed",
};

const newSourceEvidence = {
  ...sourceEvidence,
  id: NEW_EVIDENCE_ID,
  sourceConversationId: NEW_SOURCE_ID,
  sourceRevision: NEW_SOURCE_REVISION,
};

const unrelatedSourceEvidence = {
  ...sourceEvidence,
  id: UNRELATED_EVIDENCE_ID,
  sourceConversationId: UNRELATED_SOURCE_ID,
  sourceRevision: UNRELATED_SOURCE_REVISION,
};

const changeScenario = {
  ...scenario,
  id: CHANGE_SCENARIO_ID,
  practiceSetId: CHANGE_DRILL_ID,
  sourceRevision: NEW_SOURCE_REVISION,
  kind: "changeDrill",
  expectedRuleIds: [REPLACEMENT_INSTRUCTION_ID],
  sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID],
};

const changeAttempt = {
  ...attempt,
  scenarioId: CHANGE_SCENARIO_ID,
  sourceRevision: NEW_SOURCE_REVISION,
  matchedRuleIds: [REPLACEMENT_INSTRUCTION_ID],
  sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID],
};

const changeDrill = {
  ...practiceSet,
  id: CHANGE_DRILL_ID,
  sourceConversationId: NEW_SOURCE_ID,
  sourceRevision: NEW_SOURCE_REVISION,
  kind: "changeDrill",
  scenarioIds: [CHANGE_SCENARIO_ID],
};

const createQuestionWithoutShareConsent: CreateOpenQuestionRequestInput = {
  sourceConversationId: SOURCE_ID,
  sourceRevision: SOURCE_REVISION,
  instructionId: INSTRUCTION_ID,
  question: openQuestion.question,
  sourceEvidence: [EVIDENCE_ID],
};

describe("canonical domain schemas", () => {
  it("exports every schema required by the API and Bee boundaries", () => {
    const expected = [
      "beeCliIdSchema",
      "beeIdSchema",
      "sourceKindSchema",
      "characterIdSchema",
      "sourceEvidenceIdSchema",
      "beeSpeakerSchema",
      "beeUtteranceSchema",
      "beeConversationSummarySchema",
      "beeSourceSchema",
      "beeBridgeHealthResponseSchema",
      "excludedRangeSchema",
      "sourceEvidenceSchema",
      "sourceConversationSchema",
      "instructionCardSchema",
      "practiceSetSchema",
      "scenarioSchema",
      "attemptSchema",
      "openQuestionSchema",
      "changeProposalSchema",
      "errorEnvelopeSchema",
      "healthRequestSchema",
      "healthResponseSchema",
      "listBeeConversationsRequestSchema",
      "listBeeConversationsResponseSchema",
      "getBeeConversationRequestSchema",
      "getBeeConversationResponseSchema",
      "recentBeeChangesRequestSchema",
      "recentBeeChangesResponseSchema",
      "importConversationRequestSchema",
      "importConversationResponseSchema",
      "revokeConsentRequestSchema",
      "revokeConsentResponseSchema",
      "extractInstructionsRequestSchema",
      "extractInstructionsResponseSchema",
      "updateInstructionRequestSchema",
      "updateInstructionResponseSchema",
      "createPracticeSetRequestSchema",
      "createPracticeSetResponseSchema",
      "getPracticeSetRequestSchema",
      "getPracticeSetResponseSchema",
      "createAttemptRequestSchema",
      "createAttemptResponseSchema",
      "compareSourceRequestSchema",
      "compareSourceResponseSchema",
      "createOpenQuestionRequestSchema",
      "createOpenQuestionResponseSchema",
      "updateOpenQuestionRequestSchema",
      "updateOpenQuestionResponseSchema",
      "confirmChangeRequestSchema",
      "confirmChangeResponseSchema",
    ];

    for (const name of expected) {
      contractSchema(name);
    }
  });

  it("normalizes raw numeric Bee CLI IDs but keeps app JSON IDs as strings", () => {
    expect(parse("beeCliIdSchema", 731)).toBe("731");
    expect(parse("beeCliIdSchema", "bee-731")).toBe("bee-731");
    fails("beeCliIdSchema", 0);
    fails("beeConversationSummarySchema", { ...beeSummary, id: 731 });
    succeeds("beeConversationSummarySchema", beeSummary);
  });

  it("keeps summary and full Bee source payloads distinct", () => {
    succeeds("beeConversationSummarySchema", beeSummary);
    fails("beeConversationSummarySchema", { ...beeSummary, transcript: "not allowed" });
    succeeds("beeSourceSchema", beeSource);
    fails("beeSourceSchema", { ...beeSource, transcript: undefined });
    fails("beeSourceSchema", { ...beeSource, utterances: undefined });
    fails("beeConversationSummarySchema", { ...beeSummary, sourceKind: undefined });
    succeeds("beeConversationSummarySchema", { ...beeSummary, sourceKind: "fixture" });
  });

  it("allows only HTTP(S) Bee source URLs", () => {
    succeeds("beeSourceSchema", { ...beeSource, sourceUrl: "http://example.test/source" });
    succeeds("beeSourceSchema", { ...beeSource, sourceUrl: "https://example.test/source" });
    fails("beeSourceSchema", { ...beeSource, sourceUrl: "ftp://example.test/source" });
  });

  it("preserves exact transcript and evidence quote text", () => {
    const utteranceText = `  ${beeSource.utterances[0]?.text}\n`;
    const transcript = utteranceText;
    const quote = ` ${sourceEvidence.quote}`;
    const parsedSource = parse("beeSourceSchema", {
      ...beeSource,
      transcript,
      utterances: [{ ...beeSource.utterances[0], text: utteranceText }],
    }) as {
      transcript: string;
      utterances: Array<{ text: string }>;
    };
    const parsedEvidence = parse("sourceEvidenceSchema", { ...sourceEvidence, quote }) as {
      quote: string;
    };

    expect(parsedSource.transcript).toBe(transcript);
    expect(parsedSource.utterances[0]?.text).toBe(utteranceText);
    expect(parsedEvidence.quote).toBe(quote);
    fails("beeSourceSchema", { ...beeSource, transcript: "Different transcript text." });
    fails("beeSourceSchema", {
      ...beeSource,
      transcript: `${beeSource.transcript}\nSecond utterance.`,
      utterances: [
        { ...beeSource.utterances[0], startMs: 15_000, endMs: 16_000 },
        {
          ...beeSource.utterances[0],
          id: "utterance-2",
          startMs: 14_000,
          endMs: 15_000,
          text: "Second utterance.",
        },
      ],
    });
    fails("beeSourceSchema", {
      ...beeSource,
      transcript: `${beeSource.transcript}\n${beeSource.transcript}`,
      utterances: [beeSource.utterances[0], beeSource.utterances[0]],
    });
  });

  it("validates utterance and excluded half-open millisecond ranges", () => {
    succeeds("beeUtteranceSchema", beeSource.utterances[0]);
    fails("beeUtteranceSchema", { ...beeSource.utterances[0], endMs: 12_000 });
    fails("beeUtteranceSchema", { ...beeSource.utterances[0], startMs: -1 });
    succeeds("excludedRangeSchema", { startMs: 2_000, endMs: 3_000 });
    fails("excludedRangeSchema", { startMs: 3_000, endMs: 2_000 });
    fails("excludedRangeSchema", { startMs: 2.5, endMs: 3_000 });
  });

  it("validates stable source-evidence IDs, ranges, and revisions", () => {
    const createSourceEvidenceId = exportedContracts.createSourceEvidenceId;
    expect(createSourceEvidenceId).toBeTypeOf("function");
    expect(
      (
        createSourceEvidenceId as (input: {
          sourceConversationId: string;
          sourceRevision: string;
          startMs: number;
          endMs: number;
        }) => string
      )({
        sourceConversationId: SOURCE_ID,
        sourceRevision: SOURCE_REVISION,
        startMs: 12_000,
        endMs: 14_000,
      }),
    ).toBe(EVIDENCE_ID);
    expect(
      (
        createSourceEvidenceId as (input: {
          sourceConversationId: string;
          sourceRevision: string;
          startMs: number;
          endMs: number;
        }) => string
      )({
        sourceConversationId: SOURCE_ID.toUpperCase(),
        sourceRevision: SOURCE_REVISION,
        startMs: 12_000,
        endMs: 14_000,
      }),
    ).toBe(EVIDENCE_ID);
    expect(
      (
        createSourceEvidenceId as (input: {
          sourceConversationId: string;
          sourceRevision: string;
          startMs: number;
          endMs: number;
        }) => string
      )({
        sourceConversationId: SOURCE_ID,
        sourceRevision: "révision-✓",
        startMs: 12_000,
        endMs: 14_000,
      }),
    ).toBe("evd_781c33533d58fc424cc6bba8428f2d5fb7f42c678491ca6c64638d7a92bd5737");
    succeeds("sourceEvidenceSchema", sourceEvidence);
    expect(
      (parse("sourceEvidenceSchema", {
        ...sourceEvidence,
        sourceConversationId: SOURCE_ID.toUpperCase(),
      }) as SourceEvidence).sourceConversationId,
    ).toBe(SOURCE_ID);
    fails("sourceEvidenceSchema", { ...sourceEvidence, id: "transcript:12000-14000" });
    fails("sourceEvidenceSchema", { ...sourceEvidence, id: `evd_${"f".repeat(64)}` });
    fails("sourceEvidenceSchema", { ...sourceEvidence, sourceRevision: undefined });
    fails("sourceEvidenceSchema", { ...sourceEvidence, endMs: sourceEvidence.startMs });
    fails("sourceEvidenceSchema", { ...sourceEvidence, utteranceIds: [] });
    fails("instructionCardSchema", {
      ...instruction,
      sourceEvidence: [EVIDENCE_ID, EVIDENCE_ID],
    });
  });

  it("returns a failed evidence parse instead of throwing for malformed UUID input", () => {
    let success: boolean | undefined;

    expect(() => {
      success = contractSchema("sourceEvidenceSchema").safeParse({
        ...sourceEvidence,
        sourceConversationId: "not-a-uuid",
      }).success;
    }).not.toThrow();
    expect(success).toBe(false);
  });

  it("accepts the longest canonical adapter-derived source revision", () => {
    const derivedRevision = `bee:${"b".repeat(256)}:${NOW}`;

    expect(derivedRevision.length).toBeGreaterThan(256);
    succeeds("sourceRevisionSchema", derivedRevision);
    fails("sourceRevisionSchema", "r".repeat(513));
  });

  it("uses camelCase needsReview and rejects the legacy snake_case status", () => {
    succeeds("instructionCardSchema", instruction);
    fails("instructionCardSchema", { ...instruction, status: "needs_review" });
    succeeds("attemptSchema", { ...attempt, result: "needsReview" });
    fails("attemptSchema", { ...attempt, result: "needs_review" });
  });

  it("accepts only character IDs implemented by the shared FirstDay cast", () => {
    succeeds("scenarioSchema", scenario);
    succeeds("scenarioSchema", { ...changeScenario, characterId: "guide-maya" });
    fails("scenarioSchema", { ...scenario, characterId: "customer-jules" });
  });

  it("requires sourceRevision on every mutable source-derived record", () => {
    const records: Array<[string, Record<string, unknown>]> = [
      ["sourceConversationSchema", sourceConversation],
      ["instructionCardSchema", instruction],
      ["practiceSetSchema", practiceSet],
      ["scenarioSchema", scenario],
      ["attemptSchema", attempt],
      ["openQuestionSchema", openQuestion],
      ["changeProposalSchema", changeProposal],
    ];

    for (const [schemaName, value] of records) {
      succeeds(schemaName, value);
      const { sourceRevision: _removed, ...withoutSourceRevision } = value;
      expect(_removed).toBeDefined();
      fails(schemaName, withoutSourceRevision);
    }
  });

  it("keeps source consent audit fields consistent with the one-way state machine", () => {
    succeeds("sourceConversationSchema", sourceConversation);
    fails("sourceConversationSchema", {
      ...sourceConversation,
      endedAt: "2026-09-10T15:59:59Z",
    });
    fails("sourceConversationSchema", {
      ...sourceConversation,
      consentStatus: "pending",
    });
    fails("sourceConversationSchema", {
      ...sourceConversation,
      consentStatus: "confirmed",
      consentRevokedAt: NOW,
    });
    fails("sourceConversationSchema", {
      ...sourceConversation,
      consentStatus: "revoked",
      consentRevokedAt: undefined,
    });
  });

  it("carries source kind on persisted practice sets", () => {
    succeeds("practiceSetSchema", practiceSet);
    succeeds("practiceSetSchema", { ...practiceSet, sourceKind: "fixture" });
    const { sourceKind: _removed, ...withoutSourceKind } = practiceSet;
    expect(_removed).toBe("bee");
    fails("practiceSetSchema", withoutSourceKind);
    succeeds("practiceSetSchema", {
      ...practiceSet,
      status: "draft",
      scenarioIds: [],
    });
    fails("practiceSetSchema", { ...practiceSet, scenarioIds: [] });
    fails("practiceSetSchema", {
      ...changeDrill,
      scenarioIds: [CHANGE_SCENARIO_ID, SCENARIO_ID],
    });
  });

  it("rejects duplicate rule, signal, utterance, and evidence references", () => {
    fails("scenarioSchema", {
      ...scenario,
      expectedRuleIds: [INSTRUCTION_ID, INSTRUCTION_ID],
    });
    fails("scenarioSchema", {
      ...scenario,
      acceptableSignals: ["check the date", "check the date"],
    });
    fails("scenarioSchema", {
      ...scenario,
      criticalMisses: ["promise it", "promise it"],
    });
    fails("sourceEvidenceSchema", {
      ...sourceEvidence,
      utteranceIds: ["utterance-1", "utterance-1"],
    });
  });

  it("caps externally supplied collections", () => {
    const evidenceIds = Array.from({ length: 101 }, (_, index) =>
      contracts.createSourceEvidenceId({
        sourceConversationId: SOURCE_ID,
        sourceRevision: SOURCE_REVISION,
        startMs: index,
        endMs: index + 1,
      }),
    );

    fails("instructionCardSchema", { ...instruction, sourceEvidence: evidenceIds });
    fails("beeSourceSchema", {
      ...beeSource,
      speakers: Array.from({ length: 101 }, () => ({ label: "trainer" })),
    });
    fails("extractInstructionsRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      excludedRanges: Array.from({ length: 101 }, (_, index) => ({
        startMs: index,
        endMs: index + 1,
      })),
    });
    fails("updateInstructionRequestSchema", {
      instructionId: INSTRUCTION_ID,
      sourceRevision: SOURCE_REVISION,
      exceptions: Array.from({ length: 21 }, (_, index) => `Exception ${index}`),
    });
  });

  it("exports inferred types that match their schemas", () => {
    expectTypeOf<BeeConversationSummary>().toEqualTypeOf<
      typeof contracts.beeConversationSummarySchema._output
    >();
    expectTypeOf<BeeSource>().toEqualTypeOf<typeof contracts.beeSourceSchema._output>();
    expectTypeOf<ExcludedRange>().toEqualTypeOf<typeof contracts.excludedRangeSchema._output>();
    expectTypeOf<SourceEvidence>().toEqualTypeOf<typeof contracts.sourceEvidenceSchema._output>();
    expectTypeOf<SourceConversation>().toEqualTypeOf<
      typeof contracts.sourceConversationSchema._output
    >();
    expectTypeOf<InstructionCard>().toEqualTypeOf<typeof contracts.instructionCardSchema._output>();
    expectTypeOf<PracticeSet>().toEqualTypeOf<typeof contracts.practiceSetSchema._output>();
    expectTypeOf<Scenario>().toEqualTypeOf<typeof contracts.scenarioSchema._output>();
    expectTypeOf<Attempt>().toEqualTypeOf<typeof contracts.attemptSchema._output>();
    expectTypeOf<OpenQuestion>().toEqualTypeOf<typeof contracts.openQuestionSchema._output>();
    expectTypeOf<ChangeProposal>().toEqualTypeOf<typeof contracts.changeProposalSchema._output>();
    expectTypeOf<CharacterId>().toEqualTypeOf<typeof contracts.characterIdSchema._output>();

    const listInput: ListBeeConversationsRequestInput = {
      sourceKind: "bee",
      limit: "20",
    };
    const listRequest: ListBeeConversationsRequest =
      contracts.listBeeConversationsRequestSchema.parse(listInput);
    expectTypeOf(listRequest.limit).toEqualTypeOf<number | undefined>();

    const createQuestionRequest: CreateOpenQuestionRequest =
      contracts.createOpenQuestionRequestSchema.parse(createQuestionWithoutShareConsent);
    expectTypeOf(createQuestionRequest.shareConsent).toEqualTypeOf<boolean>();
  });
});

describe("Bee and import endpoint schemas", () => {
  it("validates health request and response payloads strictly", () => {
    succeeds("healthRequestSchema", {});
    fails("healthRequestSchema", { verbose: true });
    succeeds("healthResponseSchema", {
      ok: true,
      service: "firstday-api",
      version: "0.2.0",
      beeBridge: "authenticated",
    });
    fails("healthResponseSchema", {
      ok: true,
      service: "firstday-api",
      version: "0.2.0",
      beeBridge: "connected",
    });
  });

  it("validates bridge-owned query and cursor pagination", () => {
    succeeds("listBeeConversationsRequestSchema", {
      sourceKind: "bee",
      query: "onboarding",
      cursor: "opaque-page-2",
      limit: 20,
    });
    succeeds("listBeeConversationsResponseSchema", {
      items: [beeSummary],
      nextCursor: null,
    });
    succeeds("listBeeConversationsRequestSchema", {
      sourceKind: "bee",
      cursor: `opaque-${"x".repeat(1_000)}`,
    });
    fails("listBeeConversationsRequestSchema", { sourceKind: "bee", limit: 0 });
    fails("listBeeConversationsRequestSchema", { sourceKind: "bee", limit: true });
    fails("listBeeConversationsRequestSchema", { sourceKind: "bee", since: NOW });
    fails("listBeeConversationsRequestSchema", { query: "onboarding" });
    expect(
      parse("listBeeConversationsRequestSchema", { sourceKind: "bee", limit: "20" }),
    ).toEqual({
      sourceKind: "bee",
      limit: 20,
    });
    fails("listBeeConversationsResponseSchema", {
      items: [{ ...beeSummary, transcript: "must not leak into a list item" }],
      nextCursor: null,
    });
    fails("listBeeConversationsResponseSchema", {
      items: Array.from({ length: 101 }, (_, index) => ({
        ...beeSummary,
        id: `bee-conversation-${index + 1}`,
      })),
      nextCursor: null,
    });
    fails("listBeeConversationsResponseSchema", {
      items: [beeSummary, beeSummary],
      nextCursor: null,
    });
    fails("listBeeConversationsResponseSchema", {
      items: [
        beeSummary,
        { ...beeSummary, id: "fixture-123", sourceKind: "fixture" },
      ],
      nextCursor: null,
    });
  });

  it("uses cursor-based recent change pages instead of ISO since timestamps", () => {
    succeeds("recentBeeChangesRequestSchema", {
      sourceKind: "bee",
      cursor: "change-page-2",
      limit: 20,
    });
    succeeds("recentBeeChangesResponseSchema", {
      items: [beeSummary],
      nextCursor: "change-page-3",
    });
    fails("recentBeeChangesRequestSchema", { sourceKind: "bee", since: NOW });
    fails("recentBeeChangesRequestSchema", { cursor: "change-page-2" });
  });

  it("validates complete get-conversation payloads", () => {
    succeeds("getBeeConversationRequestSchema", {
      beeSourceId: beeSummary.id,
      sourceKind: "bee",
    });
    succeeds("getBeeConversationResponseSchema", { conversation: beeSource });
    fails("getBeeConversationRequestSchema", { beeSourceId: 123, sourceKind: "bee" });
    fails("getBeeConversationRequestSchema", { beeSourceId: beeSummary.id });
    fails("getBeeConversationResponseSchema", { conversation: beeSummary });
  });

  it("validates the Bee bridge health boundary separately from API health", () => {
    succeeds("beeBridgeHealthResponseSchema", {
      authenticated: true,
      lastSyncAt: NOW,
    });
    succeeds("beeBridgeHealthResponseSchema", { authenticated: false });
    fails("beeBridgeHealthResponseSchema", {
      authenticated: true,
      lastSyncAt: "yesterday",
    });
  });

  it("requires literal explicit consent for imports", () => {
    const request = {
      beeSourceId: beeSummary.id,
      sourceKind: "bee",
      sourceRevision: SOURCE_REVISION,
      consent: { confirmed: true },
    };

    succeeds("importConversationRequestSchema", request);
    fails("importConversationRequestSchema", {
      ...request,
      consent: { ...request.consent, confirmed: false },
    });
    fails("importConversationRequestSchema", {
      beeSourceId: beeSummary.id,
      sourceKind: "bee",
      sourceRevision: SOURCE_REVISION,
    });
    fails("importConversationRequestSchema", {
      beeSourceId: beeSummary.id,
      sourceRevision: SOURCE_REVISION,
      consent: { confirmed: true },
    });
    fails("importConversationRequestSchema", {
      beeSourceId: beeSummary.id,
      sourceKind: "bee",
      consent: { confirmed: true },
    });
    fails("importConversationRequestSchema", {
      ...request,
      consent: { confirmed: true, confirmedAt: NOW },
    });
    succeeds("importConversationResponseSchema", { sourceConversation });
    fails("importConversationResponseSchema", {
      sourceConversation: {
        ...sourceConversation,
        consentStatus: "pending",
        consentConfirmedAt: undefined,
      },
    });
  });

  it("validates consent revocation with a source revision guard", () => {
    succeeds("revokeConsentRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      reason: "No longer approved",
    });
    succeeds("revokeConsentResponseSchema", {
      sourceConversation: {
        ...sourceConversation,
        consentStatus: "revoked",
        consentRevokedAt: NOW,
      },
      stalePracticeSetIds: [PRACTICE_SET_ID],
    });
    fails("revokeConsentRequestSchema", {
      sourceConversationId: SOURCE_ID,
      reason: "No longer approved",
    });
    fails("revokeConsentRequestSchema", {
      sourceRevision: SOURCE_REVISION,
      reason: "No longer approved",
    });
    fails("revokeConsentRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      revokedAt: NOW,
    });
    fails("revokeConsentResponseSchema", {
      sourceConversation,
      stalePracticeSetIds: [],
    });
    fails("revokeConsentResponseSchema", {
      sourceConversation: {
        ...sourceConversation,
        consentStatus: "revoked",
        consentRevokedAt: NOW,
      },
      stalePracticeSetIds: [PRACTICE_SET_ID, PRACTICE_SET_ID],
    });
    fails("revokeConsentResponseSchema", {
      sourceConversation: {
        ...sourceConversation,
        consentStatus: "revoked",
        consentRevokedAt: NOW,
      },
      stalePracticeSetIds: Array.from(
        { length: 101 },
        (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      ),
    });
  });
});

describe("instruction and question endpoint schemas", () => {
  it("validates extraction inputs and evidence-backed outputs", () => {
    succeeds("extractInstructionsRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      excludedRanges: [{ startMs: 0, endMs: 1_000, reason: "Small talk" }],
    });
    succeeds("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [instruction],
      openQuestions: [openQuestion],
      sourceEvidence: [sourceEvidence],
    });
    fails("extractInstructionsRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      excludedRanges: [{ startMs: 100, endMs: 100 }],
    });
    fails("extractInstructionsRequestSchema", {
      sourceRevision: SOURCE_REVISION,
      excludedRanges: [],
    });
    fails("extractInstructionsRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      excludedRanges: [],
      mode: "demo",
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [{ ...instruction, sourceEvidence: [] }],
      openQuestions: [],
      sourceEvidence: [],
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [{ ...instruction, sourceConversationId: NEW_SOURCE_ID }],
      openQuestions: [],
      sourceEvidence: [sourceEvidence],
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [confirmedInstruction],
      openQuestions: [],
      sourceEvidence: [sourceEvidence],
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [instruction],
      openQuestions: [],
      sourceEvidence: [sourceEvidence, sourceEvidence],
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [instruction],
      openQuestions: [],
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("extractInstructionsResponseSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      items: [instruction, instruction],
      openQuestions: [],
      sourceEvidence: [sourceEvidence],
    });
  });

  it("supports instruction decisions and edits without accepting changed directly", () => {
    succeeds("updateInstructionRequestSchema", {
      instructionId: INSTRUCTION_ID,
      sourceRevision: SOURCE_REVISION,
      status: "confirmed",
      text: "Reservations last five calendar days.",
      expectedAction: "Check the reservation date.",
    });
    succeeds("updateInstructionResponseSchema", {
      instruction: confirmedInstruction,
    });
    fails("updateInstructionRequestSchema", {
      instructionId: INSTRUCTION_ID,
      sourceRevision: SOURCE_REVISION,
    });
    fails("updateInstructionRequestSchema", {
      instructionId: INSTRUCTION_ID,
      sourceRevision: SOURCE_REVISION,
      status: "changed",
    });
    fails("updateInstructionRequestSchema", {
      source_revision: SOURCE_REVISION,
      status: "needs_review",
    });
    fails("updateInstructionRequestSchema", {
      sourceRevision: SOURCE_REVISION,
      status: "confirmed",
    });
  });

  it("rejects changed instructions from ordinary update responses", () => {
    fails("updateInstructionResponseSchema", {
      instruction: changedInstruction,
    });
  });

  it("validates open-question creation and guarded updates", () => {
    succeeds("createOpenQuestionRequestSchema", createQuestionWithoutShareConsent);
    succeeds("createOpenQuestionResponseSchema", { openQuestion });
    fails("createOpenQuestionRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      question: openQuestion.question,
      sourceEvidence: [],
    });

    succeeds("updateOpenQuestionRequestSchema", {
      openQuestionId: QUESTION_ID,
      sourceRevision: SOURCE_REVISION,
      status: "resolved",
      resolution: "The reservation day is day one.",
    });
    succeeds("updateOpenQuestionResponseSchema", {
      openQuestion: {
        ...openQuestion,
        status: "resolved",
        resolution: "The reservation day is day one.",
      },
    });
    fails("updateOpenQuestionRequestSchema", {
      openQuestionId: QUESTION_ID,
      sourceRevision: SOURCE_REVISION,
    });
    fails("updateOpenQuestionRequestSchema", {
      openQuestionId: QUESTION_ID,
      sourceRevision: SOURCE_REVISION,
      status: "resolved",
    });
    fails("updateOpenQuestionRequestSchema", {
      sourceRevision: SOURCE_REVISION,
      status: "dismissed",
    });
  });

  it("accepts only open questions from the creation response", () => {
    fails("createOpenQuestionResponseSchema", {
      openQuestion: {
        ...openQuestion,
        status: "resolved",
        resolution: "The reservation day is day one.",
      },
    });
  });
});

describe("practice and attempt endpoint schemas", () => {
  it("validates creation of exactly three evidence-backed MVP scenarios", () => {
    succeeds("createPracticeSetRequestSchema", {
      sourceConversationId: SOURCE_ID,
      sourceRevision: SOURCE_REVISION,
      instructionIds: [
        INSTRUCTION_ID,
        "36333333-3333-4333-8333-333333333333",
        "37333333-3333-4333-8333-333333333333",
      ],
      title: practiceSet.title,
    });
    succeeds("createPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      sourceEvidence: [sourceEvidence],
    });
    fails("createPracticeSetResponseSchema", {
      practiceSet,
      scenarios: scenarios.slice(0, 2),
      sourceEvidence: [sourceEvidence],
    });
    fails("createPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      sourceEvidence: [{ ...sourceEvidence, sourceConversationId: NEW_SOURCE_ID }],
    });
    fails("createPracticeSetResponseSchema", {
      practiceSet,
      scenarios: [
        { ...scenarios[0], practiceSetId: CHANGE_DRILL_ID },
        scenarios[1],
        scenarios[2],
      ],
      sourceEvidence: [sourceEvidence],
    });
    fails("scenarioSchema", { ...scenario, sourceEvidence: [] });
  });

  it("validates practice reads and bounded progress", () => {
    succeeds("getPracticeSetRequestSchema", { practiceSetId: PRACTICE_SET_ID });
    succeeds("getPracticeSetResponseSchema", {
      practiceSet: inProgressPracticeSet,
      scenarios,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    succeeds("getPracticeSetResponseSchema", {
      practiceSet: changeDrill,
      scenarios: [changeScenario],
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      progress: { completed: 0, total: 1 },
    });
    succeeds("getPracticeSetResponseSchema", {
      practiceSet: { ...practiceSet, status: "stale" },
      scenarios,
      instructions: [changedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: inProgressPracticeSet,
      scenarios,
      instructions: [changedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: { ...practiceSet, status: "complete" },
      scenarios,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 2, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: inProgressPracticeSet,
      scenarios,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 3, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: inProgressPracticeSet,
      scenarios,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 4, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      instructions: [{ ...confirmedInstruction, sourceConversationId: NEW_SOURCE_ID }],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: changeDrill,
      scenarios: [
        {
          ...changeScenario,
          sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID, UNRELATED_EVIDENCE_ID],
        },
      ],
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence, unrelatedSourceEvidence],
      progress: { completed: 0, total: 1 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      instructions: [instruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet: { ...practiceSet, scenarioIds: [SCENARIO_ID, SCENARIO_ID, SCENARIO_ID] },
      scenarios: [scenario, { ...scenario, order: 2 }, { ...scenario, order: 3 }],
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
    fails("getPracticeSetResponseSchema", {
      practiceSet,
      scenarios,
      instructions: [confirmedInstruction, confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      progress: { completed: 1, total: 3 },
    });
  });

  it("uses one attempt request for voice and text and sourceEvidence in results", () => {
    succeeds("createAttemptRequestSchema", {
      scenarioId: SCENARIO_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      responseText: attempt.responseText,
      inputMode: "voice",
    });
    succeeds("createAttemptRequestSchema", {
      scenarioId: SCENARIO_ID,
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      responseText: attempt.responseText,
      inputMode: "text",
    });
    succeeds("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptRequestSchema", {
      sourceRevision: SOURCE_REVISION,
      instructionRevision: INSTRUCTION_REVISION,
      responseText: attempt.responseText,
      inputMode: "text",
    });
    fails("createAttemptRequestSchema", {
      scenarioId: SCENARIO_ID,
      sourceRevision: SOURCE_REVISION,
      responseText: attempt.responseText,
      inputMode: "text",
    });
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: {
        ...attempt,
        sourceEvidence: undefined,
        evidence: [EVIDENCE_ID],
      },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("attemptSchema", {
      ...attempt,
      missedRuleIds: [INSTRUCTION_ID],
    });
    fails("attemptSchema", {
      ...attempt,
      matchedRuleIds: [INSTRUCTION_ID, INSTRUCTION_ID],
    });
    fails("attemptSchema", {
      ...attempt,
      matchedRuleIds: [],
    });
    fails("attemptSchema", {
      ...attempt,
      result: "partial",
      matchedRuleIds: [],
      missedRuleIds: [],
    });
    fails("attemptSchema", {
      ...attempt,
      result: "missed",
      matchedRuleIds: [],
      missedRuleIds: [],
    });
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, result: "needsReview" },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds an attempt response to the returned scenario identity", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, scenarioId: CHANGE_SCENARIO_ID },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds an attempt response to the returned scenario revision", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, sourceRevision: NEW_SOURCE_REVISION },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds the returned scenario to its practice set", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: { ...practiceSet, id: CHANGE_DRILL_ID },
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet: {
        ...practiceSet,
        scenarioIds: [CHANGE_SCENARIO_ID, scenarios[1]!.id, scenarios[2]!.id],
      },
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("aligns scenario kind, revision, and order with its practice set", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: {
        ...practiceSet,
        kind: "changeDrill",
        scenarioIds: [SCENARIO_ID],
      },
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet: { ...practiceSet, sourceRevision: NEW_SOURCE_REVISION },
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet: {
        ...practiceSet,
        scenarioIds: [scenarios[1]!.id, SCENARIO_ID, scenarios[2]!.id],
      },
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds the attempt instruction revision to its practice set", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, instructionRevision: "instruction-revision-2" },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("rejects attempt rule IDs outside the returned scenario", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, matchedRuleIds: [REPLACEMENT_INSTRUCTION_ID] },
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires attempt rule results to partition all expected scenario rules", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario: {
        ...scenario,
        expectedRuleIds: [INSTRUCTION_ID, REPLACEMENT_INSTRUCTION_ID],
      },
      attempt,
      instructions: [confirmedInstruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("rejects attempt evidence outside the returned scenario", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt: { ...attempt, sourceEvidence: [UNRELATED_EVIDENCE_ID] },
      instructions: [confirmedInstruction],
      sourceEvidence: [unrelatedSourceEvidence],
      nextAction: "continue",
    });
  });

  it("rejects a change proposal from a standard attempt response", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [confirmedInstruction],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires confirmed standard instructions", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [instruction],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires exactly the standard scenario expected instructions", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [confirmedInstruction, confirmedReplacement],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds standard instructions to the practice-set source provenance", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [
        { ...confirmedInstruction, sourceConversationId: NEW_SOURCE_ID },
      ],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [
        { ...confirmedInstruction, sourceRevision: NEW_SOURCE_REVISION },
      ],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires standard scenario evidence to equal the instruction evidence union", () => {
    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario,
      attempt,
      instructions: [
        { ...confirmedInstruction, sourceEvidence: [NEW_EVIDENCE_ID] },
      ],
      sourceEvidence: [sourceEvidence],
      nextAction: "continue",
    });
  });

  it("rejects standard evidence from unrelated instruction provenance", () => {
    const unrelatedEvidenceScenario = {
      ...scenario,
      sourceEvidence: [UNRELATED_EVIDENCE_ID],
    };

    fails("createAttemptResponseSchema", {
      practiceSet,
      scenario: unrelatedEvidenceScenario,
      attempt: { ...attempt, sourceEvidence: [UNRELATED_EVIDENCE_ID] },
      instructions: [
        { ...confirmedInstruction, sourceEvidence: [UNRELATED_EVIDENCE_ID] },
      ],
      sourceEvidence: [unrelatedSourceEvidence],
      nextAction: "continue",
    });
  });

  it("accepts a Change Drill attempt with exact confirmed change context", () => {
    succeeds("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires a confirmed proposal for Change Drill attempts", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [changedInstruction, confirmedReplacement],
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [changedInstruction, replacementInstruction],
      changeProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
  });

  it("binds a Change Drill practice set to the replacement source provenance", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: { ...changeDrill, sourceConversationId: SOURCE_ID },
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires a Change Drill scenario to evaluate only the replacement", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: { ...changeScenario, expectedRuleIds: [INSTRUCTION_ID] },
      attempt: {
        ...changeAttempt,
        matchedRuleIds: [INSTRUCTION_ID],
      },
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
  });

  it("requires exact previous and replacement cards for Change Drill attempts", () => {
    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [confirmedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: changeScenario,
      attempt: changeAttempt,
      instructions: [
        changedInstruction,
        { ...confirmedReplacement, text: "An unrelated replacement rule." },
      ],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence],
      nextAction: "continue",
    });
  });

  it("rejects unrelated evidence from a Change Drill attempt", () => {
    const leakingScenario = {
      ...changeScenario,
      sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID, UNRELATED_EVIDENCE_ID],
    };

    fails("createAttemptResponseSchema", {
      practiceSet: changeDrill,
      scenario: leakingScenario,
      attempt: {
        ...changeAttempt,
        sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID, UNRELATED_EVIDENCE_ID],
      },
      instructions: [changedInstruction, confirmedReplacement],
      changeProposal: confirmedProposal,
      sourceEvidence: [sourceEvidence, newSourceEvidence, unrelatedSourceEvidence],
      nextAction: "continue",
    });
  });
});

describe("changed-rule endpoint schemas", () => {
  it("rejects identical source IDs in empty compare responses", () => {
    fails("compareSourceResponseSchema", {
      previousSourceConversationId: SOURCE_ID,
      newSourceConversationId: SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
      changes: [],
      sourceEvidence: [],
    });
  });

  it("returns persisted change and replacement instruction IDs from compare", () => {
    succeeds("compareSourceRequestSchema", {
      sourceConversationId: SOURCE_ID,
      newSourceConversationId: NEW_SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
    });
    succeeds("compareSourceResponseSchema", {
      previousSourceConversationId: SOURCE_ID,
      newSourceConversationId: NEW_SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
      changes: [changeProposal],
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("changeProposalSchema", {
      ...changeProposal,
      id: undefined,
    });
    fails("changeProposalSchema", {
      ...changeProposal,
      replacementInstruction: undefined,
    });
    fails("changeProposalSchema", {
      ...changeProposal,
      status: "rejected",
      replacementInstruction: { ...replacementInstruction, status: "rejected" },
    });
    fails("changeProposalSchema", {
      ...changeProposal,
      replacementInstruction: {
        ...replacementInstruction,
        id: INSTRUCTION_ID,
      },
    });
    fails("compareSourceResponseSchema", {
      previousSourceConversationId: SOURCE_ID,
      newSourceConversationId: NEW_SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
      changes: [
        {
          ...changeProposal,
          replacementInstruction: {
            ...replacementInstruction,
            sourceConversationId: SOURCE_ID,
          },
        },
      ],
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("compareSourceResponseSchema", {
      previousSourceConversationId: SOURCE_ID,
      newSourceConversationId: NEW_SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
      changes: [changeProposal, changeProposal],
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("compareSourceRequestSchema", {
      newSourceConversationId: NEW_SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
    });
    fails("compareSourceRequestSchema", {
      sourceConversationId: SOURCE_ID,
      newSourceConversationId: SOURCE_ID,
      previousInstructionRevision: INSTRUCTION_REVISION,
    });
  });

  it("confirms a proposal and returns an atomic one-scenario Change Drill", () => {
    succeeds("confirmChangeRequestSchema", {
      changeId: CHANGE_ID,
      sourceRevision: NEW_SOURCE_REVISION,
    });
    succeeds("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [changeScenario] },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [] },
      sourceEvidence: [],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: changedInstruction,
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [CHANGE_DRILL_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [changeScenario] },
      sourceEvidence: [sourceEvidence, newSourceEvidence],
    });
    fails("confirmChangeRequestSchema", {
      sourceRevision: NEW_SOURCE_REVISION,
    });
    fails("confirmChangeRequestSchema", {
      changeId: CHANGE_ID,
      sourceRevision: NEW_SOURCE_REVISION,
      confirmedAt: NOW,
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: {
        ...confirmedReplacement,
        id: "35333333-3333-4333-8333-333333333333",
      },
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [changeScenario] },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: changedInstruction,
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: {
        practiceSet: changeDrill,
        scenarios: [
          {
            ...changeScenario,
            sourceEvidence: [EVIDENCE_ID, NEW_EVIDENCE_ID, UNRELATED_EVIDENCE_ID],
          },
        ],
      },
      sourceEvidence: [sourceEvidence, newSourceEvidence, unrelatedSourceEvidence],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: {
        practiceSet: changeDrill,
        scenarios: [{ ...changeScenario, practiceSetId: PRACTICE_SET_ID }],
      },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: {
        ...confirmedReplacement,
        text: "Contradictory duplicate replacement text.",
      },
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [changeScenario] },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: {
        ...confirmedInstruction,
        sourceRevision: NEW_SOURCE_REVISION,
        status: "changed",
      },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: { practiceSet: changeDrill, scenarios: [changeScenario] },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: {
        practiceSet: changeDrill,
        scenarios: [{ ...changeScenario, order: 2 }],
      },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
    fails("confirmChangeResponseSchema", {
      changeProposal: confirmedProposal,
      previousInstruction: { ...confirmedInstruction, status: "changed" },
      replacementInstruction: confirmedReplacement,
      stalePracticeSetIds: [PRACTICE_SET_ID],
      changeDrill: {
        practiceSet: changeDrill,
        scenarios: [{ ...changeScenario, expectedRuleIds: [INSTRUCTION_ID] }],
      },
      sourceEvidence: [
        sourceEvidence,
        {
          ...sourceEvidence,
          id: NEW_EVIDENCE_ID,
          sourceConversationId: NEW_SOURCE_ID,
          sourceRevision: NEW_SOURCE_REVISION,
        },
      ],
    });
  });
});

describe("canonical error envelope", () => {
  it.each([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "BEE_BRIDGE_UNAVAILABLE",
    "BEE_SOURCE_NOT_FOUND",
    "CONSENT_REQUIRED",
    "SOURCE_NOT_READY",
    "NO_CONFIRMED_INSTRUCTIONS",
    "STALE_PRACTICE_SET",
    "VALIDATION_ERROR",
    "RESOURCE_NOT_FOUND",
    "REVISION_CONFLICT",
    "CONSENT_REVOKED",
    "INVALID_STATE",
    "INTERNAL_ERROR",
  ])("accepts required code %s", (code) => {
    succeeds("errorEnvelopeSchema", {
      error: {
        code,
        message: "Request could not be completed.",
        details: {},
        requestId: REQUEST_ID,
      },
    });
  });

  it("rejects unknown codes and malformed request IDs", () => {
    fails("errorEnvelopeSchema", {
      error: {
        code: "UNKNOWN_ERROR",
        message: "Nope",
        details: {},
        requestId: REQUEST_ID,
      },
    });
    fails("errorEnvelopeSchema", {
      error: {
        code: "VALIDATION_ERROR",
        message: "Nope",
        details: {},
        requestId: "request-1",
      },
    });
  });
});
