import {
  beeSourceSchema,
  createSourceEvidenceId,
  extractInstructionsResponseSchema,
  revokeConsentResponseSchema,
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
import { InvalidDependencyOutputError } from "./errors.js";
import { createFixtureInstructionExtractor } from "./extraction.js";
import { createMemoryRepository } from "./memory-repository.js";

const SOURCE = beeSourceSchema.parse(onboardingJson);
const UPDATE_SOURCE = beeSourceSchema.parse(updateJson);
const INITIAL_EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const UPDATE_EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.updateExtraction);
const LEARNER_ONE = "70000000-0000-4000-8000-000000000001";
const LEARNER_TWO = "70000000-0000-4000-8000-000000000002";
const SOURCE_ID_ONE = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID_TWO = "10000000-0000-4000-8000-000000000002";
const SOURCE_ID_THREE = "10000000-0000-4000-8000-000000000003";
const IMPOSTOR_RESERVATION_ID = "20000000-0000-4000-8000-000000000021";
const IMPOSTOR_PICKUP_ID = "20000000-0000-4000-8000-000000000022";
const IMPOSTOR_RETURN_ID = "20000000-0000-4000-8000-000000000023";
const IMPORTED_AT = "2026-09-11T12:00:00.000Z";
const REVOKED_AT = "2026-09-11T13:00:00.000Z";
const TRANSCRIPT_HASH = "dfee89c91fa321314980bf085e216ff6941c4929709e7c2b6ffa11b79330c3bf";
const EXTRACTED_QUESTION_ID = "60000000-0000-4000-8000-000000000001";
const DANGLING_INSTRUCTION_ID = "60000000-0000-4000-8000-000000000002";

function withFirstEvidence(
  mutate: (
    evidence: typeof INITIAL_EXTRACTION.sourceEvidence[number],
  ) => typeof INITIAL_EXTRACTION.sourceEvidence[number],
) {
  const extraction = structuredClone(INITIAL_EXTRACTION);
  const previous = extraction.sourceEvidence[0]!;
  const replacement = mutate(previous);
  extraction.sourceEvidence[0] = replacement;
  for (const item of extraction.items) {
    item.sourceEvidence = item.sourceEvidence.map((id) => id === previous.id ? replacement.id : id);
  }
  return extractInstructionsResponseSchema.parse(extraction);
}

function withExtractedQuestion(input: {
  instructionId: string;
  shareConsent: boolean;
}) {
  return extractInstructionsResponseSchema.parse({
    ...structuredClone(INITIAL_EXTRACTION),
    openQuestions: [{
      id: EXTRACTED_QUESTION_ID,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      instructionId: input.instructionId,
      question: "Should this exception be checked with a manager?",
      sourceEvidence: [INITIAL_EXTRACTION.sourceEvidence[0]!.id],
      status: "open",
      shareConsent: input.shareConsent,
      createdAt: INITIAL_EXTRACTION.items[0]!.createdAt,
      updatedAt: INITIAL_EXTRACTION.items[0]!.createdAt,
    }],
  });
}

function extractionAllocation(
  extraction: ReturnType<typeof extractInstructionsResponseSchema.parse>,
) {
  const records = [...extraction.items, ...extraction.openQuestions];
  const timestamp = records[0]?.createdAt;
  if (timestamp === undefined) throw new Error("test extraction must contain a record");
  return {
    recordIds: records.map(({ id }) => id),
    timestamp,
  };
}

function initialExtractionForSource(
  sourceConversationId: string,
  instructionIds: readonly [string, string, string],
) {
  const extraction = structuredClone(INITIAL_EXTRACTION);
  extraction.sourceConversationId = sourceConversationId;
  const evidenceIds = new Map<string, `evd_${string}`>();
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
  extraction.items.forEach((instruction, index) => {
    instruction.id = instructionIds[index]!;
    instruction.sourceConversationId = sourceConversationId;
    instruction.sourceEvidence = instruction.sourceEvidence.map((evidenceId) =>
      evidenceIds.get(evidenceId)!
    );
  });
  return extractInstructionsResponseSchema.parse(extraction);
}

describe("memory repository source contract", () => {
  it("persists a ready compact source and private exact Bee material", async () => {
    const repository = createMemoryRepository();

    const source = await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    expect(source).toEqual({
      id: SOURCE_ID_ONE,
      learnerId: LEARNER_ONE,
      beeSourceId: SOURCE.id,
      sourceKind: "fixture",
      title: SOURCE.title,
      startedAt: SOURCE.startedAt,
      endedAt: SOURCE.endedAt,
      transcriptHash: TRANSCRIPT_HASH,
      sourceRevision: SOURCE.revision,
      consentStatus: "confirmed",
      consentConfirmedAt: IMPORTED_AT,
      status: "ready",
      importedAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
    });

    const processing = await repository.getSourceForProcessing({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
    });
    expect(processing.sourceConversation).toEqual(source);
    expect(processing.source.transcript).toBe(SOURCE.transcript);

    processing.source.utterances[0]!.text = "mutated outside the repository";
    const reread = await repository.getSourceForProcessing({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
    });
    expect(reread.source.utterances[0]!.text).toBe(SOURCE.utterances[0]!.text);
  });

  it("is idempotent only for the same learner/source/revision/hash identity", async () => {
    const repository = createMemoryRepository();
    const first = await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });
    const repeated = await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: structuredClone(SOURCE),
      timestamp: REVOKED_AT,
    });

    expect(repeated).toEqual(first);

    const changedTranscript = {
      ...structuredClone(SOURCE),
      transcript: SOURCE.transcript.replace("register.", "register carefully."),
      utterances: SOURCE.utterances.map((utterance, index) => index === 8
        ? { ...utterance, text: utterance.text.replace("register.", "register carefully.") }
        : utterance),
    };
    await expect(repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: changedTranscript,
      timestamp: REVOKED_AT,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("serializes concurrent idempotent imports without duplicate sources", async () => {
    const repository = createMemoryRepository();
    const [left, right] = await Promise.all([
      repository.importSource({
        learnerId: LEARNER_ONE,
        sourceConversationId: SOURCE_ID_ONE,
        source: SOURCE,
        timestamp: IMPORTED_AT,
      }),
      repository.importSource({
        learnerId: LEARNER_ONE,
        sourceConversationId: SOURCE_ID_TWO,
        source: SOURCE,
        timestamp: REVOKED_AT,
      }),
    ]);

    expect(left).toEqual(right);
    expect([SOURCE_ID_ONE, SOURCE_ID_TWO]).toContain(left.id);
  });

  it("hides another learner's valid source identifier as not found", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    await expect(repository.getSource({
      learnerId: LEARNER_TWO,
      sourceConversationId: SOURCE_ID_ONE,
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(repository.revokeConsent({
      learnerId: LEARNER_TWO,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      timestamp: REVOKED_AT,
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("atomically revokes consent, retains compact audit state, and deletes processing access", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    const response = revokeConsentResponseSchema.parse(await repository.revokeConsent({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      reason: "Remove private source material.",
      timestamp: REVOKED_AT,
    }));

    expect(response.sourceConversation).toMatchObject({
      id: SOURCE_ID_ONE,
      consentStatus: "revoked",
      consentConfirmedAt: IMPORTED_AT,
      consentRevokedAt: REVOKED_AT,
      updatedAt: REVOKED_AT,
    });
    expect(response.stalePracticeSetIds).toEqual([]);
    await expect(repository.getSourceForProcessing({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
    })).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
    await expect(repository.revokeConsent({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      timestamp: REVOKED_AT,
    })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rejects stale revision guards without mutating the source", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    await expect(repository.revokeConsent({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: "wrong-revision",
      timestamp: REVOKED_AT,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(repository.getSourceForProcessing({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
    })).resolves.toMatchObject({ sourceConversation: { consentStatus: "confirmed" } });
  });

  it("rolls back every draft record when multi-instruction extraction persistence fails", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });
    await repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: INITIAL_EXTRACTION,
      allocation: extractionAllocation(INITIAL_EXTRACTION),
    });
    const copyOnWriteSource = beeSourceSchema.parse({
      ...structuredClone(UPDATE_SOURCE),
      id: "fixture-bookshop-copy-on-write",
    });
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: copyOnWriteSource,
      timestamp: REVOKED_AT,
    });

    const replacement = UPDATE_EXTRACTION.items[0]!;
    const standaloneReplacement = structuredClone(replacement);
    delete standaloneReplacement.supersedesId;
    const firstDraftId = "20000000-0000-4000-8000-000000000011";
    const finalDraftId = "20000000-0000-4000-8000-000000000013";
    const collidingExtraction = extractInstructionsResponseSchema.parse({
      ...UPDATE_EXTRACTION,
      instructionRevision: "bookshop-copy-on-write-r2",
      items: [
        { ...standaloneReplacement, id: firstDraftId },
        {
          ...standaloneReplacement,
          id: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        },
        { ...standaloneReplacement, id: finalDraftId },
      ],
    });
    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: collidingExtraction,
      allocation: extractionAllocation(collidingExtraction),
    })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const cleanExtraction = extractInstructionsResponseSchema.parse({
      ...collidingExtraction,
      items: collidingExtraction.items.map((instruction, index) => index === 1
        ? { ...instruction, id: "20000000-0000-4000-8000-000000000012" }
        : instruction),
    });
    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: cleanExtraction,
      allocation: extractionAllocation(cleanExtraction),
    })).resolves.toEqual(cleanExtraction);
  });

  it("rejects direct update lineage through an impostor source and permits a trusted retry", async () => {
    const repository = createMemoryRepository();
    const impostorSource = beeSourceSchema.parse({
      ...structuredClone(SOURCE),
      id: "fixture-bookshop-impostor",
    });
    const impostorExtraction = initialExtractionForSource(SOURCE_ID_ONE, [
      IMPOSTOR_RESERVATION_ID,
      IMPOSTOR_PICKUP_ID,
      IMPOSTOR_RETURN_ID,
    ]);
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: impostorSource,
      timestamp: IMPORTED_AT,
    });
    await repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: impostorSource.revision,
      excludedRanges: [],
      extraction: impostorExtraction,
      allocation: extractionAllocation(impostorExtraction),
    });
    await repository.updateInstruction({
      learnerId: LEARNER_ONE,
      instructionId: IMPOSTOR_RESERVATION_ID,
      sourceRevision: impostorSource.revision,
      status: "confirmed",
      timestamp: REVOKED_AT,
    });
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: UPDATE_SOURCE,
      timestamp: REVOKED_AT,
    });
    const impostorContext = await repository.prepareExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
    });
    const forgedUpdate = structuredClone(UPDATE_EXTRACTION);
    forgedUpdate.items[0]!.supersedesId = IMPOSTOR_RESERVATION_ID;
    const forgedSave = {
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: forgedUpdate,
      allocation: extractionAllocation(forgedUpdate),
      lineage: {
        previousInstructionContextsById: structuredClone(
          impostorContext.previousInstructionContextsById,
        ),
      },
    };

    await expect(repository.saveExtraction(forgedSave)).rejects.toBeInstanceOf(
      InvalidDependencyOutputError,
    );

    const actualExtraction = initialExtractionForSource(SOURCE_ID_THREE, [
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
    ]);
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_THREE,
      source: SOURCE,
      timestamp: REVOKED_AT,
    });
    await repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_THREE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: actualExtraction,
      allocation: extractionAllocation(actualExtraction),
    });
    await repository.updateInstruction({
      learnerId: LEARNER_ONE,
      instructionId: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      sourceRevision: SOURCE.revision,
      status: "confirmed",
      timestamp: REVOKED_AT,
    });
    const trustedContext = await repository.prepareExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
    });
    const cleanUpdate = await createFixtureInstructionExtractor().extract({
      ...trustedContext,
      excludedRanges: [],
      timestamp: UPDATE_EXTRACTION.items[0]!.createdAt,
      idFactory: () => BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
    });
    const cleanSave = {
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: cleanUpdate,
      allocation: extractionAllocation(cleanUpdate),
      lineage: {
        previousInstructionContextsById: structuredClone(
          trustedContext.previousInstructionContextsById,
        ),
      },
    };
    const multiUpdate = extractInstructionsResponseSchema.parse({
      ...structuredClone(cleanUpdate),
      items: [
        cleanUpdate.items[0],
        {
          ...cleanUpdate.items[0],
          id: "20000000-0000-4000-8000-000000000024",
        },
      ],
    });
    await expect(repository.saveExtraction({
      ...cleanSave,
      extraction: multiUpdate,
      allocation: extractionAllocation(multiUpdate),
    })).rejects.toBeInstanceOf(InvalidDependencyOutputError);
    await expect(repository.saveExtraction(cleanSave)).resolves.toEqual(cleanUpdate);
  });

  it("rejects an empty fixture update without onboarding lineage and permits a clean retry", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: UPDATE_SOURCE,
      timestamp: REVOKED_AT,
    });
    const emptyUpdate = extractInstructionsResponseSchema.parse({
      ...structuredClone(UPDATE_EXTRACTION),
      items: [],
      sourceEvidence: [],
    });
    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: emptyUpdate,
      allocation: {
        recordIds: [],
        timestamp: UPDATE_EXTRACTION.items[0]!.createdAt,
      },
      lineage: { previousInstructionContextsById: {} },
    })).rejects.toBeInstanceOf(InvalidDependencyOutputError);

    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });
    await repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: INITIAL_EXTRACTION,
      allocation: extractionAllocation(INITIAL_EXTRACTION),
    });
    await repository.updateInstruction({
      learnerId: LEARNER_ONE,
      instructionId: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      sourceRevision: SOURCE.revision,
      status: "confirmed",
      timestamp: REVOKED_AT,
    });
    const trustedContext = await repository.prepareExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
    });
    const cleanUpdate = await createFixtureInstructionExtractor().extract({
      ...trustedContext,
      excludedRanges: [],
      timestamp: UPDATE_EXTRACTION.items[0]!.createdAt,
      idFactory: () => BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
    });
    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: cleanUpdate,
      allocation: extractionAllocation(cleanUpdate),
      lineage: {
        previousInstructionContextsById: structuredClone(
          trustedContext.previousInstructionContextsById,
        ),
      },
    })).resolves.toEqual(cleanUpdate);
  });

  it.each([
    {
      kind: "quote",
      extraction: withFirstEvidence((evidence) => ({
        ...evidence,
        quote: "Forged text that never appeared in the persisted conversation.",
      })),
      excludedRanges: [],
    },
    {
      kind: "span",
      extraction: withFirstEvidence((evidence) => {
        const endMs = evidence.endMs - 100;
        return {
          ...evidence,
          id: createSourceEvidenceId({
            sourceConversationId: evidence.sourceConversationId,
            sourceRevision: evidence.sourceRevision,
            startMs: evidence.startMs,
            endMs,
          }),
          endMs,
        };
      }),
      excludedRanges: [],
    },
    {
      kind: "utterance ID/order",
      extraction: withFirstEvidence((evidence) => ({
        ...evidence,
        utteranceIds: ["onboarding-004"],
      })),
      excludedRanges: [],
    },
    {
      kind: "speaker",
      extraction: withFirstEvidence((evidence) => ({
        ...evidence,
        speakerLabel: "learner",
      })),
      excludedRanges: [],
    },
    {
      kind: "excluded overlap",
      extraction: INITIAL_EXTRACTION,
      excludedRanges: [{ startMs: 10_800, endMs: 17_400 }],
    },
  ])("rejects schema-valid forged $kind evidence and rolls back for retry", async ({
    extraction,
    excludedRanges,
  }) => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges,
      extraction,
      allocation: extractionAllocation(extraction),
    })).rejects.toBeInstanceOf(InvalidDependencyOutputError);

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: INITIAL_EXTRACTION,
      allocation: extractionAllocation(INITIAL_EXTRACTION),
    })).resolves.toEqual(INITIAL_EXTRACTION);
  });

  it.each([
    {
      kind: "dangling instruction linkage",
      extraction: withExtractedQuestion({
        instructionId: DANGLING_INSTRUCTION_ID,
        shareConsent: false,
      }),
    },
    {
      kind: "public sharing consent",
      extraction: withExtractedQuestion({
        instructionId: INITIAL_EXTRACTION.items[0]!.id,
        shareConsent: true,
      }),
    },
  ])("rejects extracted-question $kind and rolls back for retry", async ({ extraction }) => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction,
      allocation: extractionAllocation(extraction),
    })).rejects.toBeInstanceOf(InvalidDependencyOutputError);

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: INITIAL_EXTRACTION,
      allocation: extractionAllocation(INITIAL_EXTRACTION),
    })).resolves.toEqual(INITIAL_EXTRACTION);
  });

  it("rejects an extracted question linked to an instruction from another source", async () => {
    const repository = createMemoryRepository();
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      source: SOURCE,
      timestamp: IMPORTED_AT,
    });
    await repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_ONE,
      sourceRevision: SOURCE.revision,
      excludedRanges: [],
      extraction: INITIAL_EXTRACTION,
      allocation: extractionAllocation(INITIAL_EXTRACTION),
    });
    await repository.updateInstruction({
      learnerId: LEARNER_ONE,
      instructionId: INITIAL_EXTRACTION.items[0]!.id,
      sourceRevision: SOURCE.revision,
      status: "confirmed",
      timestamp: REVOKED_AT,
    });
    await repository.importSource({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      source: UPDATE_SOURCE,
      timestamp: REVOKED_AT,
    });
    const updateContext = await repository.prepareExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
    });
    const lineage = {
      previousInstructionContextsById: structuredClone(
        updateContext.previousInstructionContextsById,
      ),
    };
    const extraction = extractInstructionsResponseSchema.parse({
      ...structuredClone(UPDATE_EXTRACTION),
      openQuestions: [{
        id: EXTRACTED_QUESTION_ID,
        sourceConversationId: SOURCE_ID_TWO,
        sourceRevision: UPDATE_SOURCE.revision,
        instructionId: INITIAL_EXTRACTION.items[0]!.id,
        question: "Does the prior card answer this new-source question?",
        sourceEvidence: [UPDATE_EXTRACTION.sourceEvidence[0]!.id],
        status: "open",
        shareConsent: false,
        createdAt: UPDATE_EXTRACTION.items[0]!.createdAt,
        updatedAt: UPDATE_EXTRACTION.items[0]!.createdAt,
      }],
    });

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction,
      allocation: extractionAllocation(extraction),
      lineage,
    })).rejects.toBeInstanceOf(InvalidDependencyOutputError);

    await expect(repository.saveExtraction({
      learnerId: LEARNER_ONE,
      sourceConversationId: SOURCE_ID_TWO,
      sourceRevision: UPDATE_SOURCE.revision,
      excludedRanges: [],
      extraction: UPDATE_EXTRACTION,
      allocation: extractionAllocation(UPDATE_EXTRACTION),
      lineage,
    })).resolves.toEqual(UPDATE_EXTRACTION);
  });
});
