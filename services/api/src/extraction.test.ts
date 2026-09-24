import {
  beeSourceSchema,
  createSourceEvidenceId,
  extractInstructionsResponseSchema,
  instructionCardSchema,
} from "@firstday/contracts";
import { BOOKSHOP_FIXTURE_IDS } from "@firstday/scenario-engine";
import { describe, expect, it } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};
import updateJson from "../../../fixtures/transcripts/bookshop-policy-update.json" with {
  type: "json",
};
import { createFixtureInstructionExtractor } from "./extraction.js";
import { createMemoryRepository } from "./memory-repository.js";

const ONBOARDING = beeSourceSchema.parse(onboardingJson);
const UPDATE = beeSourceSchema.parse(updateJson);
const INITIAL = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const UPDATE_EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.updateExtraction);
const IMPOSTOR_SOURCE_CONVERSATION_ID = "10000000-0000-4000-8000-000000000099";

function sourceConversation(source: typeof ONBOARDING, id: string) {
  return {
    id,
    learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
    beeSourceId: source.id,
    sourceKind: source.sourceKind,
    title: source.title,
    startedAt: source.startedAt,
    ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
    transcriptHash: "a".repeat(64),
    sourceRevision: source.revision,
    consentStatus: "confirmed" as const,
    consentConfirmedAt: "2026-09-10T16:00:59.000Z",
    status: "ready" as const,
    importedAt: "2026-09-10T16:00:59.000Z",
    updatedAt: "2026-09-10T16:00:59.000Z",
  };
}

function ids(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => remaining.shift() ?? "f0000000-0000-4000-8000-000000000099";
}

function extractionForSource(sourceConversationId: string) {
  const extraction = structuredClone(INITIAL);
  const evidenceIds = new Map<string, `evd_${string}`>();
  extraction.sourceConversationId = sourceConversationId;
  for (const evidence of extraction.sourceEvidence) {
    const previousId = evidence.id;
    evidence.sourceConversationId = sourceConversationId;
    evidence.id = createSourceEvidenceId({
      sourceConversationId,
      sourceRevision: evidence.sourceRevision,
      startMs: evidence.startMs,
      endMs: evidence.endMs,
    });
    evidenceIds.set(previousId, evidence.id);
  }
  for (const item of extraction.items) {
    item.sourceConversationId = sourceConversationId;
    item.sourceEvidence = item.sourceEvidence.map((id) => evidenceIds.get(id)!);
  }
  return extractInstructionsResponseSchema.parse(extraction);
}

function extractionAllocation(
  extraction: ReturnType<typeof extractInstructionsResponseSchema.parse>,
) {
  const records = [...extraction.items, ...extraction.openQuestions];
  const timestamp = records[0]?.createdAt;
  if (timestamp === undefined) throw new Error("test extraction must contain a record");
  return { recordIds: records.map(({ id }) => id), timestamp };
}

function previousContexts(...instructions: typeof INITIAL.items) {
  const source = sourceConversation(
    ONBOARDING,
    BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
  );
  return Object.fromEntries(instructions.map((instruction) => [instruction.id, {
    instructionRevision: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
    sourceIdentity: {
      id: source.id,
      beeSourceId: source.beeSourceId,
      sourceKind: source.sourceKind,
      sourceRevision: source.sourceRevision,
    },
    sourceEvidence: INITIAL.sourceEvidence.filter(({ id }) =>
      instruction.sourceEvidence.includes(id)
    ),
  }]));
}

describe("deterministic InstructionExtractor", () => {
  it("produces the exact evidence-backed onboarding cards", async () => {
    const extractor = createFixtureInstructionExtractor();
    const result = await extractor.extract({
      source: ONBOARDING,
      sourceConversation: sourceConversation(
        ONBOARDING,
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      ),
      excludedRanges: [],
      previousConfirmedInstructions: [],
      timestamp: "2026-09-10T16:01:00.000Z",
      idFactory: ids([
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      ]),
    });

    expect(result).toEqual(INITIAL);
  });

  it("honors excluded transcript ranges without orphan evidence", async () => {
    const extractor = createFixtureInstructionExtractor();
    const result = await extractor.extract({
      source: ONBOARDING,
      sourceConversation: sourceConversation(
        ONBOARDING,
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      ),
      excludedRanges: [{ startMs: 21_400, endMs: 27_700, reason: "Not relevant" }],
      previousConfirmedInstructions: [],
      timestamp: "2026-09-10T16:01:00.000Z",
      idFactory: ids([
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      ]),
    });

    expect(result.items.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
    ]);
    expect(result.sourceEvidence.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.reservationEvidenceId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnEvidenceId,
    ]);
  });

  it("links the fixture update to the exact prior confirmed instruction and snapshot", async () => {
    const extractor = createFixtureInstructionExtractor();
    const previous = instructionCardSchema.parse({
      ...INITIAL.items[0],
      status: "confirmed",
    });
    const result = await extractor.extract({
      source: UPDATE,
      sourceConversation: sourceConversation(
        UPDATE,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      ),
      excludedRanges: [],
      previousConfirmedInstructions: [previous],
      previousInstructionRevision: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
      previousInstructionContextsById: previousContexts(previous),
      timestamp: "2026-09-17T16:01:00.000Z",
      idFactory: ids([BOOKSHOP_FIXTURE_IDS.replacementInstructionId]),
    });

    expect(result).toEqual(UPDATE_EXTRACTION);
  });

  it("keeps update lineage when the learner edits the prior card situation", async () => {
    const extractor = createFixtureInstructionExtractor();
    const previous = instructionCardSchema.parse({
      ...INITIAL.items[0],
      situation: "A learner-authored description that is intentionally different.",
      status: "confirmed",
    });

    const result = await extractor.extract({
      source: UPDATE,
      sourceConversation: sourceConversation(
        UPDATE,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      ),
      excludedRanges: [],
      previousConfirmedInstructions: [previous],
      previousInstructionRevisionsById: {
        [previous.id]: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
      },
      previousInstructionContextsById: previousContexts(previous),
      timestamp: "2026-09-17T16:01:00.000Z",
      idFactory: ids([BOOKSHOP_FIXTURE_IDS.replacementInstructionId]),
    });

    expect(result.items[0]?.supersedesId).toBe(
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    );
  });

  it("does not redirect update lineage to a different learner-edited card", async () => {
    const extractor = createFixtureInstructionExtractor();
    const reservation = instructionCardSchema.parse({
      ...INITIAL.items[0],
      situation: "The learner renamed this situation.",
      status: "confirmed",
    });
    const pickup = instructionCardSchema.parse({
      ...INITIAL.items[1],
      situation: "A customer asks whether a reservation is still active.",
      status: "confirmed",
    });

    const result = await extractor.extract({
      source: UPDATE,
      sourceConversation: sourceConversation(
        UPDATE,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      ),
      excludedRanges: [],
      previousConfirmedInstructions: [reservation, pickup],
      previousInstructionRevisionsById: {
        [reservation.id]: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
        [pickup.id]: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
      },
      previousInstructionContextsById: previousContexts(reservation, pickup),
      timestamp: "2026-09-17T16:01:00.000Z",
      idFactory: ids([BOOKSHOP_FIXTURE_IDS.replacementInstructionId]),
    });

    expect(result.items[0]?.supersedesId).toBe(
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    );
  });

  it("rejects update lineage from an impostor persisted source identity", async () => {
    const repository = createMemoryRepository();
    const impostor = beeSourceSchema.parse({
      ...structuredClone(ONBOARDING),
      id: "fixture-bookshop-impostor",
    });
    await repository.importSource({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: IMPOSTOR_SOURCE_CONVERSATION_ID,
      source: impostor,
      timestamp: "2026-09-10T16:00:59.000Z",
    });
    const impostorExtraction = extractionForSource(IMPOSTOR_SOURCE_CONVERSATION_ID);
    await repository.saveExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: IMPOSTOR_SOURCE_CONVERSATION_ID,
      sourceRevision: impostor.revision,
      excludedRanges: [],
      extraction: impostorExtraction,
      allocation: extractionAllocation(impostorExtraction),
    });
    await repository.updateInstruction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      instructionId: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      sourceRevision: impostor.revision,
      status: "confirmed",
      timestamp: "2026-09-10T16:01:01.000Z",
    });
    await repository.importSource({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      source: UPDATE,
      timestamp: "2026-09-17T16:00:59.000Z",
    });
    const context = await repository.prepareExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      sourceRevision: UPDATE.revision,
    });

    await expect(createFixtureInstructionExtractor().extract({
      ...context,
      excludedRanges: [],
      timestamp: "2026-09-17T16:01:00.000Z",
      idFactory: ids([BOOKSHOP_FIXTURE_IDS.replacementInstructionId]),
    })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("excludes a revoked prior source from update lineage context", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      source: ONBOARDING,
      timestamp: "2026-09-10T16:00:59.000Z",
    });
    await repository.saveExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      sourceRevision: ONBOARDING.revision,
      excludedRanges: [],
      extraction: INITIAL,
      allocation: extractionAllocation(INITIAL),
    });
    await repository.updateInstruction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      instructionId: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      sourceRevision: ONBOARDING.revision,
      status: "confirmed",
      timestamp: "2026-09-10T16:01:01.000Z",
    });
    await repository.revokeConsent({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      sourceRevision: ONBOARDING.revision,
      timestamp: "2026-09-10T16:01:02.000Z",
    });
    await repository.importSource({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      source: UPDATE,
      timestamp: "2026-09-17T16:00:59.000Z",
    });
    const context = await repository.prepareExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      sourceRevision: UPDATE.revision,
    });

    expect(context.previousConfirmedInstructions).toEqual([]);
    expect(context.previousInstructionContextsById).toEqual({});
    await expect(createFixtureInstructionExtractor().extract({
      ...context,
      excludedRanges: [],
      timestamp: "2026-09-17T16:01:00.000Z",
      idFactory: ids([BOOKSHOP_FIXTURE_IDS.replacementInstructionId]),
    })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses live sources with the documented sanitized mapping", async () => {
    const extractor = createFixtureInstructionExtractor();
    const live = beeSourceSchema.parse({
      ...ONBOARDING,
      id: "123",
      sourceKind: "bee",
      revision: "bee:123:r1",
    });
    await expect(extractor.extract({
      source: live,
      sourceConversation: {
        ...sourceConversation(ONBOARDING, BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId),
        beeSourceId: live.id,
        sourceKind: "bee",
        sourceRevision: live.revision,
      },
      excludedRanges: [],
      previousConfirmedInstructions: [],
      timestamp: "2026-09-10T16:01:00.000Z",
      idFactory: ids([]),
    })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Live instruction extraction is not configured.",
    });
  });
});
