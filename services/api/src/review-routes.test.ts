import {
  beeSourceSchema,
  createSourceEvidenceId,
  createOpenQuestionResponseSchema,
  errorEnvelopeSchema,
  extractInstructionsResponseSchema,
  updateInstructionResponseSchema,
  updateOpenQuestionResponseSchema,
  type BeeSource,
} from "@firstday/contracts";
import { BOOKSHOP_FIXTURE_IDS } from "@firstday/scenario-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};
import updateJson from "../../../fixtures/transcripts/bookshop-policy-update.json" with {
  type: "json",
};
import {
  createFixtureInstructionExtractor,
  type InstructionExtractor,
} from "./extraction.js";
import { createMemoryRepository } from "./memory-repository.js";
import type { FirstDayRepository } from "./repository.js";
import {
  buildApiServer,
  deterministicScenarioEngine,
  type ApiServer,
  type BeeGateway,
} from "./server.js";

const SOURCE = beeSourceSchema.parse(onboardingJson);
const UPDATE_SOURCE = beeSourceSchema.parse(updateJson);
const TOKEN = "learner-token";
const OTHER_TOKEN = "other-learner-token";
const OTHER_LEARNER_ID = "70000000-0000-4000-8000-000000000002";
const QUESTION_ID = "50000000-0000-4000-8000-000000000001";
const IMPOSTOR_SOURCE_ID = "10000000-0000-4000-8000-000000000099";
const IMPOSTOR_RESERVATION_ID = "20000000-0000-4000-8000-000000000091";
const IMPOSTOR_PICKUP_ID = "20000000-0000-4000-8000-000000000092";
const IMPOSTOR_RETURN_ID = "20000000-0000-4000-8000-000000000093";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const TIMESTAMP = "2026-09-10T16:01:00.000Z";
const servers: ApiServer[] = [];

function queue(values: readonly string[]) {
  const remaining = [...values];
  return () => remaining.shift() ?? "f0000000-0000-4000-8000-000000000099";
}

function extractionForSource(
  extractionInput: ReturnType<typeof extractInstructionsResponseSchema.parse>,
  sourceConversationId: string,
  instructionIds: readonly [string, string, string],
) {
  const extraction = structuredClone(extractionInput);
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

function extractionAllocation(
  extraction: ReturnType<typeof extractInstructionsResponseSchema.parse>,
) {
  const records = [...extraction.items, ...extraction.openQuestions];
  return {
    recordIds: records.map(({ id }) => id),
    timestamp: records[0]!.createdAt,
  };
}

function makeConfiguredServer(options: {
  sources?: readonly BeeSource[];
  extractor?: InstructionExtractor;
  repository?: FirstDayRepository;
  ids?: readonly string[];
  learnerByToken?: (token: string) => string;
} = {}) {
  const sources = options.sources ?? [SOURCE];
  const gateway: BeeGateway = {
    health: vi.fn(async () => ({ authenticated: true })),
    listConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getConversation: vi.fn(async ({ beeSourceId, sourceKind }) => {
      const source = sources.find(
        (candidate) => candidate.id === beeSourceId && candidate.sourceKind === sourceKind,
      );
      if (source === undefined) throw new Error("missing test source");
      return { conversation: source };
    }),
  };
  const server = buildApiServer({
    sessionVerifier: {
      verify: vi.fn(async (token) => ({
        learnerId: options.learnerByToken?.(token) ?? BOOKSHOP_FIXTURE_IDS.learnerId,
        access: "all" as const,
      })),
    },
    beeGateway: gateway,
    repository: options.repository ?? createMemoryRepository(),
    extractor: options.extractor ?? createFixtureInstructionExtractor(),
    scenarioEngine: deterministicScenarioEngine,
    clock: () => TIMESTAMP,
    idFactory: queue(options.ids ?? [
      BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      QUESTION_ID,
    ]),
    requestIdFactory: () => REQUEST_ID,
    allowedOrigins: [],
  });
  servers.push(server);
  return server;
}

function makeServer(source: BeeSource = SOURCE) {
  return makeConfiguredServer({ sources: [source] });
}

function headers() {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

async function importAndExtract(server: ApiServer) {
  await server.inject({
    method: "POST",
    url: "/api/imports",
    headers: headers(),
    payload: {
      beeSourceId: SOURCE.id,
      sourceKind: SOURCE.sourceKind,
      sourceRevision: SOURCE.revision,
      consent: { confirmed: true },
    },
  });
  const response = await server.inject({
    method: "POST",
    url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
    headers: headers(),
    payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
  });
  return extractInstructionsResponseSchema.parse(response.json());
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("instruction extraction and review routes", () => {
  it("extracts exactly three needs-review cards with exact evidence", async () => {
    const server = makeServer();
    const extraction = await importAndExtract(server);
    expect(extraction.items).toHaveLength(3);
    expect(extraction.items.every(({ status }) => status === "needsReview")).toBe(true);
    expect(extraction.sourceEvidence.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.reservationEvidenceId,
      BOOKSHOP_FIXTURE_IDS.pickupEvidenceId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnEvidenceId,
    ]);
  });

  it("rejects repeated extraction and extraction after consent revocation", async () => {
    const server = makeServer();
    await importAndExtract(server);
    const repeated = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
    });
    expect(repeated.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(repeated.json()).error.code).toBe("INVALID_STATE");

    const revokedServer = makeServer();
    await revokedServer.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: SOURCE.id,
        sourceKind: SOURCE.sourceKind,
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    await revokedServer.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/consent/revoke`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision },
    });
    const revoked = await revokedServer.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
    });
    expect(revoked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(revoked.json()).error.code).toBe("CONSENT_REVOKED");
  });

  it("allows one edit-and-confirm decision and makes reviewed content terminal", async () => {
    const server = makeServer();
    await importAndExtract(server);
    const confirmed = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: headers(),
      payload: {
        sourceRevision: SOURCE.revision,
        text: "Reservations stay active for five calendar days, with setup day as day one.",
        status: "confirmed",
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(updateInstructionResponseSchema.parse(confirmed.json()).instruction).toMatchObject({
      status: "confirmed",
      text: "Reservations stay active for five calendar days, with setup day as day one.",
    });

    for (const payload of [
      { sourceRevision: SOURCE.revision, status: "confirmed" },
      { sourceRevision: SOURCE.revision, text: "Change it after confirmation." },
      { sourceRevision: SOURCE.revision, status: "needsReview" },
    ]) {
      const response = await server.inject({
        method: "PATCH",
        url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
        headers: headers(),
        payload,
      });
      expect(response.statusCode).toBe(409);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("INVALID_STATE");
    }
  });

  it("makes rejection terminal with no persisted restore transition", async () => {
    const server = makeServer();
    await importAndExtract(server);
    const rejected = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.pickupInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "rejected" },
    });
    expect(updateInstructionResponseSchema.parse(rejected.json()).instruction.status).toBe("rejected");
    const restore = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.pickupInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "needsReview" },
    });
    expect(restore.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(restore.json()).error.code).toBe("INVALID_STATE");
  });

  it("passes prior confirmed snapshot context into update extraction", async () => {
    const server = makeConfiguredServer({
      sources: [SOURCE, UPDATE_SOURCE],
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
      ],
    });
    await importAndExtract(server);
    await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: UPDATE_SOURCE.id,
        sourceKind: UPDATE_SOURCE.sourceKind,
        sourceRevision: UPDATE_SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const response = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.updateSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: UPDATE_SOURCE.revision, excludedRanges: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(response.json())).toMatchObject({
      instructionRevision: BOOKSHOP_FIXTURE_IDS.updateInstructionRevision,
      items: [{
        id: BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
        supersedesId: BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        status: "needsReview",
      }],
    });
  });

  it("does not persist malformed extractor output and allows a clean retry", async () => {
    const fixtureExtractor = createFixtureInstructionExtractor();
    let calls = 0;
    const extractor: InstructionExtractor = {
      async extract(input) {
        calls += 1;
        if (calls === 1) return { upstreamSecret: "live-provider-token" } as never;
        return fixtureExtractor.extract(input);
      },
    };
    const server = makeConfiguredServer({ extractor });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: SOURCE.id,
        sourceKind: SOURCE.sourceKind,
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const request = {
      method: "POST" as const,
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
    };
    const malformed = await server.inject(request);
    expect(malformed.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(malformed.json()).error.code).toBe("INTERNAL_ERROR");
    expect(malformed.body).not.toContain("live-provider-token");

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(retried.json()).items).toHaveLength(3);
  });

  it("sanitizes extractor-substituted source identity and permits a clean retry", async () => {
    const fixtureExtractor = createFixtureInstructionExtractor();
    let calls = 0;
    const extractor: InstructionExtractor = {
      async extract(input) {
        const extraction = await fixtureExtractor.extract(input);
        calls += 1;
        if (calls !== 1) return extraction;
        return extractionForSource(extraction, IMPOSTOR_SOURCE_ID, [
          extraction.items[0]!.id,
          extraction.items[1]!.id,
          extraction.items[2]!.id,
        ]);
      },
    };
    const server = makeConfiguredServer({
      extractor,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        "20000000-0000-4000-8000-000000000011",
        "20000000-0000-4000-8000-000000000012",
        "20000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      ],
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: SOURCE.id,
        sourceKind: SOURCE.sourceKind,
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const request = {
      method: "POST" as const,
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
    };

    const substituted = await server.inject(request);
    expect(substituted.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(substituted.json()).error).toMatchObject({
      code: "INTERNAL_ERROR",
      details: {},
    });
    expect(substituted.body).not.toContain(IMPOSTOR_SOURCE_ID);

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(retried.json()).items).toHaveLength(3);
  });

  it("preserves the original exclusion snapshot when an extractor mutates its input", async () => {
    const fixtureExtractor = createFixtureInstructionExtractor();
    let calls = 0;
    const extractor: InstructionExtractor = {
      async extract(input) {
        calls += 1;
        if (calls === 1) input.excludedRanges.splice(0);
        return fixtureExtractor.extract(input);
      },
    };
    const server = makeConfiguredServer({
      extractor,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        "20000000-0000-4000-8000-000000000011",
        "20000000-0000-4000-8000-000000000012",
        "20000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      ],
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: SOURCE.id,
        sourceKind: SOURCE.sourceKind,
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const request = {
      method: "POST" as const,
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: {
        sourceRevision: SOURCE.revision,
        excludedRanges: [{ startMs: 10_800, endMs: 17_400 }],
      },
    };

    const mutated = await server.inject(request);
    expect(mutated.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(mutated.json()).error.code).toBe("INTERNAL_ERROR");

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(retried.json()).items.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
    ]);
  });

  it("retains trusted lineage when an extractor mutates its prepared context", async () => {
    const repository = createMemoryRepository();
    const fixtureExtractor = createFixtureInstructionExtractor();
    let updateCalls = 0;
    const extractor: InstructionExtractor = {
      async extract(input) {
        if (input.source.id === UPDATE_SOURCE.id && updateCalls++ === 0) {
          const impostor = input.previousConfirmedInstructions.find(
            ({ id }) => id === IMPOSTOR_RESERVATION_ID,
          );
          const context = input.previousInstructionContextsById?.[IMPOSTOR_RESERVATION_ID];
          if (impostor === undefined || context === undefined) {
            throw new Error("missing impostor test context");
          }
          input.previousConfirmedInstructions.splice(
            0,
            input.previousConfirmedInstructions.length,
            impostor,
          );
          context.sourceIdentity.beeSourceId = BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId;
        }
        return fixtureExtractor.extract(input);
      },
    };
    const server = makeConfiguredServer({
      sources: [SOURCE, UPDATE_SOURCE],
      extractor,
      repository,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
        "20000000-0000-4000-8000-000000000094",
        BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
      ],
    });
    const initial = await importAndExtract(server);
    await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });

    const impostorSource = beeSourceSchema.parse({
      ...structuredClone(SOURCE),
      id: "fixture-bookshop-impostor",
    });
    const impostorExtraction = extractionForSource(initial, IMPOSTOR_SOURCE_ID, [
      IMPOSTOR_RESERVATION_ID,
      IMPOSTOR_PICKUP_ID,
      IMPOSTOR_RETURN_ID,
    ]);
    await repository.importSource({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: IMPOSTOR_SOURCE_ID,
      source: impostorSource,
      timestamp: TIMESTAMP,
    });
    await repository.saveExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: IMPOSTOR_SOURCE_ID,
      sourceRevision: impostorSource.revision,
      excludedRanges: [],
      extraction: impostorExtraction,
      allocation: extractionAllocation(impostorExtraction),
    });
    await repository.updateInstruction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      instructionId: IMPOSTOR_RESERVATION_ID,
      sourceRevision: impostorSource.revision,
      status: "confirmed",
      timestamp: TIMESTAMP,
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: UPDATE_SOURCE.id,
        sourceKind: UPDATE_SOURCE.sourceKind,
        sourceRevision: UPDATE_SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const request = {
      method: "POST" as const,
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.updateSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: UPDATE_SOURCE.revision, excludedRanges: [] },
    };

    const mutated = await server.inject(request);
    expect(mutated.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(mutated.json()).error.code).toBe("INTERNAL_ERROR");

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(retried.json()).items[0]?.supersedesId).toBe(
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    );
  });

  it("rechecks prior-source consent after a deferred extractor before committing", async () => {
    const repository = createMemoryRepository();
    const fixtureExtractor = createFixtureInstructionExtractor();
    let markStarted: (() => void) | undefined;
    let releaseExtractor: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExtractor = resolve;
    });
    let shouldPause = true;
    const extractor: InstructionExtractor = {
      async extract(input) {
        if (input.source.id === UPDATE_SOURCE.id && shouldPause) {
          shouldPause = false;
          markStarted?.();
          await release;
        }
        return fixtureExtractor.extract(input);
      },
    };
    const server = makeConfiguredServer({
      sources: [SOURCE, UPDATE_SOURCE],
      extractor,
      repository,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
      ],
    });
    await importAndExtract(server);
    await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: UPDATE_SOURCE.id,
        sourceKind: UPDATE_SOURCE.sourceKind,
        sourceRevision: UPDATE_SOURCE.revision,
        consent: { confirmed: true },
      },
    });

    const pending = server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.updateSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: UPDATE_SOURCE.revision, excludedRanges: [] },
    });
    await started;
    await repository.revokeConsent({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      sourceRevision: SOURCE.revision,
      timestamp: TIMESTAMP,
    });
    releaseExtractor?.();

    const raced = await pending;
    expect(raced.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(raced.json()).error.code).toBe("CONSENT_REVOKED");
    await expect(repository.prepareExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      sourceRevision: UPDATE_SOURCE.revision,
    })).resolves.toMatchObject({ previousConfirmedInstructions: [] });
  });

  it("does not let an empty deferred update bypass prior-source revocation", async () => {
    const repository = createMemoryRepository();
    const fixtureExtractor = createFixtureInstructionExtractor();
    let markStarted: (() => void) | undefined;
    let releaseExtractor: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExtractor = resolve;
    });
    const extractor: InstructionExtractor = {
      async extract(input) {
        const extraction = await fixtureExtractor.extract(input);
        if (input.source.id !== UPDATE_SOURCE.id) return extraction;
        markStarted?.();
        await release;
        return extractInstructionsResponseSchema.parse({
          ...extraction,
          items: [],
          sourceEvidence: [],
        });
      },
    };
    const server = makeConfiguredServer({
      sources: [SOURCE, UPDATE_SOURCE],
      extractor,
      repository,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.replacementInstructionId,
      ],
    });
    await importAndExtract(server);
    await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: UPDATE_SOURCE.id,
        sourceKind: UPDATE_SOURCE.sourceKind,
        sourceRevision: UPDATE_SOURCE.revision,
        consent: { confirmed: true },
      },
    });

    const pending = server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.updateSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: UPDATE_SOURCE.revision, excludedRanges: [] },
    });
    await started;
    await repository.revokeConsent({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      sourceRevision: SOURCE.revision,
      timestamp: TIMESTAMP,
    });
    releaseExtractor?.();

    const raced = await pending;
    expect(raced.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(raced.json()).error.code).toBe("CONSENT_REVOKED");
    await expect(repository.prepareExtraction({
      learnerId: BOOKSHOP_FIXTURE_IDS.learnerId,
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.updateSourceConversationId,
      sourceRevision: UPDATE_SOURCE.revision,
    })).resolves.toMatchObject({ previousConfirmedInstructions: [] });
  });

  it.each([
    ["record ID", (extraction: ReturnType<typeof extractInstructionsResponseSchema.parse>) => {
      extraction.items[0]!.id = "20000000-0000-4000-8000-000000000099";
    }],
    ["timestamp", (extraction: ReturnType<typeof extractInstructionsResponseSchema.parse>) => {
      for (const item of extraction.items) {
        item.createdAt = "2026-09-10T00:00:00.000Z";
        item.updatedAt = "2026-09-10T00:00:00.000Z";
      }
    }],
  ] as const)("rejects extractor-substituted server-owned %s and allows retry", async (
    _kind,
    alter,
  ) => {
    const fixtureExtractor = createFixtureInstructionExtractor();
    let calls = 0;
    const extractor: InstructionExtractor = {
      async extract(input) {
        const extraction = structuredClone(await fixtureExtractor.extract(input));
        calls += 1;
        if (calls === 1) alter(extraction);
        return extractInstructionsResponseSchema.parse(extraction);
      },
    };
    const server = makeConfiguredServer({
      extractor,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        "20000000-0000-4000-8000-000000000011",
        "20000000-0000-4000-8000-000000000012",
        "20000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      ],
    });
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: SOURCE.id,
        sourceKind: SOURCE.sourceKind,
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
    });
    const request = {
      method: "POST" as const,
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
    };

    const substituted = await server.inject(request);
    expect(substituted.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(substituted.json()).error.code).toBe("INTERNAL_ERROR");

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(extractInstructionsResponseSchema.parse(retried.json()).items).toHaveLength(3);
  });

  it("hides another learner's instruction identifier", async () => {
    const server = makeConfiguredServer({
      learnerByToken: (token) => token === OTHER_TOKEN
        ? OTHER_LEARNER_ID
        : BOOKSHOP_FIXTURE_IDS.learnerId,
    });
    await importAndExtract(server);
    const response = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${BOOKSHOP_FIXTURE_IDS.reservationInstructionId}`,
      headers: {
        authorization: `Bearer ${OTHER_TOKEN}`,
        "content-type": "application/json",
      },
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });

    expect(response.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("returns the fixed canonical error when live extraction is not configured", async () => {
    const liveSource = beeSourceSchema.parse({
      ...SOURCE,
      id: "123",
      sourceKind: "bee",
      revision: "bee:123:r1",
    });
    const server = makeServer(liveSource);
    await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: {
        beeSourceId: liveSource.id,
        sourceKind: liveSource.sourceKind,
        sourceRevision: liveSource.revision,
        consent: { confirmed: true },
      },
    });
    const response = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
      headers: headers(),
      payload: { sourceRevision: liveSource.revision, excludedRanges: [] },
    });

    expect(response.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(response.json()).error).toMatchObject({
      code: "INVALID_STATE",
      message: "The requested transition is not allowed from the current state.",
    });
  });
});

describe("grounded open-question routes", () => {
  it("creates with default private sharing, updates while open, and makes resolution terminal", async () => {
    const server = makeServer();
    const extraction = await importAndExtract(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/open-questions",
      headers: headers(),
      payload: {
        sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        sourceRevision: SOURCE.revision,
        instructionId: BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        question: "Does the red cart rule apply after closing?",
        sourceEvidence: [extraction.items[2]!.sourceEvidence[0]],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(createOpenQuestionResponseSchema.parse(created.json()).openQuestion).toMatchObject({
      id: QUESTION_ID,
      status: "open",
      shareConsent: false,
    });

    const editedWhileOpen = await server.inject({
      method: "PATCH",
      url: `/api/open-questions/${QUESTION_ID}`,
      headers: headers(),
      payload: {
        sourceRevision: SOURCE.revision,
        status: "open",
        question: "Does the red cart rule apply after the shop closes?",
      },
    });
    expect(editedWhileOpen.statusCode).toBe(200);
    expect(updateOpenQuestionResponseSchema.parse(editedWhileOpen.json()).openQuestion.question).toBe(
      "Does the red cart rule apply after the shop closes?",
    );

    const resolved = await server.inject({
      method: "PATCH",
      url: `/api/open-questions/${QUESTION_ID}`,
      headers: headers(),
      payload: {
        sourceRevision: SOURCE.revision,
        status: "resolved",
        resolution: "Yes, use the cart after closing too.",
        shareConsent: true,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(updateOpenQuestionResponseSchema.parse(resolved.json()).openQuestion).toMatchObject({
      status: "resolved",
      shareConsent: true,
      resolution: "Yes, use the cart after closing too.",
    });

    const terminal = await server.inject({
      method: "PATCH",
      url: `/api/open-questions/${QUESTION_ID}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, question: "Try another edit." },
    });
    expect(terminal.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(terminal.json()).error.code).toBe("INVALID_STATE");
  });

  it("rejects unowned evidence and invalid resolved updates", async () => {
    const server = makeServer();
    await importAndExtract(server);
    const badEvidence = await server.inject({
      method: "POST",
      url: "/api/open-questions",
      headers: headers(),
      payload: {
        sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        sourceRevision: SOURCE.revision,
        question: "Unsupported?",
        sourceEvidence: [`evd_${"f".repeat(64)}`],
      },
    });
    expect(badEvidence.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(badEvidence.json()).error.code).toBe("RESOURCE_NOT_FOUND");

    const unresolved = await server.inject({
      method: "PATCH",
      url: `/api/open-questions/${QUESTION_ID}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "resolved" },
    });
    expect(unresolved.statusCode).toBe(422);
    expect(errorEnvelopeSchema.parse(unresolved.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
