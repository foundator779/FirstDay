import {
  beeSourceSchema,
  createPracticeSetResponseSchema,
  errorEnvelopeSchema,
  extractInstructionsResponseSchema,
  getPracticeSetResponseSchema,
  type CreatePracticeSetResponse,
} from "@firstday/contracts";
import { BOOKSHOP_FIXTURE_IDS } from "@firstday/scenario-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};
import { createFixtureInstructionExtractor } from "./extraction.js";
import { createMemoryRepository } from "./memory-repository.js";
import {
  buildApiServer,
  deterministicScenarioEngine,
  type ApiServer,
  type BeeGateway,
  type ScenarioEngineFacade,
} from "./server.js";

const SOURCE = beeSourceSchema.parse(onboardingJson);
const STANDARD = createPracticeSetResponseSchema.parse(goldenJson.standardPractice);
const TOKEN = "learner-token";
const OTHER_TOKEN = "other-learner-token";
const OTHER_LEARNER_ID = "70000000-0000-4000-8000-000000000002";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const servers: ApiServer[] = [];

function queue<T>(values: readonly T[], fallback: T): () => T {
  const remaining = [...values];
  return () => remaining.shift() ?? fallback;
}

function makeServer(options: {
  scenarioEngine?: ScenarioEngineFacade;
  ids?: readonly string[];
} = {}) {
  const gateway: BeeGateway = {
    health: vi.fn(async () => ({ authenticated: true })),
    listConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getConversation: vi.fn(async () => ({ conversation: SOURCE })),
  };
  const server = buildApiServer({
    sessionVerifier: {
      verify: vi.fn(async (token) => ({
        learnerId: token === OTHER_TOKEN
          ? OTHER_LEARNER_ID
          : BOOKSHOP_FIXTURE_IDS.learnerId,
        access: "all" as const,
      })),
    },
    beeGateway: gateway,
    repository: createMemoryRepository(),
    extractor: createFixtureInstructionExtractor(),
    scenarioEngine: options.scenarioEngine ?? deterministicScenarioEngine,
    clock: queue([
      "2026-09-10T16:00:59.000Z",
      "2026-09-10T16:01:00.000Z",
      "2026-09-10T16:01:10.000Z",
      "2026-09-10T16:01:20.000Z",
      "2026-09-10T16:01:30.000Z",
      "2026-09-10T16:02:00.000Z",
      "2026-09-10T16:03:00.000Z",
    ], "2026-09-10T16:04:00.000Z"),
    idFactory: queue(options.ids ?? [
      BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
      BOOKSHOP_FIXTURE_IDS.reservationScenarioId,
      BOOKSHOP_FIXTURE_IDS.pickupScenarioId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnScenarioId,
    ], "f0000000-0000-4000-8000-000000000099"),
    requestIdFactory: () => REQUEST_ID,
    allowedOrigins: [],
  });
  servers.push(server);
  return server;
}

function headers(token = TOKEN) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function importAndExtract(server: ApiServer) {
  const imported = await server.inject({
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
  expect(imported.statusCode).toBe(201);

  const extracted = await server.inject({
    method: "POST",
    url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/extract`,
    headers: headers(),
    payload: { sourceRevision: SOURCE.revision, excludedRanges: [] },
  });
  expect(extracted.statusCode).toBe(200);
  return extractInstructionsResponseSchema.parse(extracted.json());
}

async function confirmAll(server: ApiServer) {
  for (const instructionId of [
    BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
    BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
  ]) {
    const response = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${instructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });
    expect(response.statusCode).toBe(200);
  }
}

const CREATE_REQUEST = {
  sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
  sourceRevision: SOURCE.revision,
  instructionIds: [
    BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
    BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
  ],
  title: "Bookshop first shift",
};

async function createPractice(server: ApiServer) {
  return server.inject({
    method: "POST",
    url: "/api/practice-sets",
    headers: headers(),
    payload: CREATE_REQUEST,
  });
}

function swapScenarioEvidence(generation: CreatePracticeSetResponse) {
  const altered = structuredClone(generation);
  const first = altered.scenarios[0]!;
  const second = altered.scenarios[1]!;
  [first.sourceEvidence, second.sourceEvidence] = [
    second.sourceEvidence,
    first.sourceEvidence,
  ];
  return createPracticeSetResponseSchema.parse(altered);
}

function substituteCreationMetadata(generation: CreatePracticeSetResponse) {
  const altered = structuredClone(generation);
  const practiceSetId = "30000000-0000-4000-8000-000000000021";
  const scenarioIds = [
    "40000000-0000-4000-8000-000000000021",
    "40000000-0000-4000-8000-000000000022",
    "40000000-0000-4000-8000-000000000023",
  ];
  altered.practiceSet.id = practiceSetId;
  altered.practiceSet.scenarioIds = scenarioIds;
  altered.practiceSet.createdAt = "2026-09-10T00:00:00.000Z";
  altered.practiceSet.updatedAt = "2026-09-10T00:00:00.000Z";
  altered.scenarios.forEach((scenario, index) => {
    scenario.id = scenarioIds[index]!;
    scenario.practiceSetId = practiceSetId;
  });
  return createPracticeSetResponseSchema.parse(altered);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("standard practice routes", () => {
  it("creates the exact three evidence-backed Rowan scenarios from confirmed cards", async () => {
    const server = makeServer();
    await importAndExtract(server);
    await confirmAll(server);

    const response = await createPractice(server);

    expect(response.statusCode).toBe(201);
    expect(createPracticeSetResponseSchema.parse(response.json())).toEqual(STANDARD);
  });

  it("reads the canonical bundle with zero distinct covered-scenario progress", async () => {
    const server = makeServer();
    await importAndExtract(server);
    await confirmAll(server);
    await createPractice(server);

    const response = await server.inject({
      method: "GET",
      url: `/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    const bundle = getPracticeSetResponseSchema.parse(response.json());
    expect(bundle).toMatchObject({
      practiceSet: STANDARD.practiceSet,
      scenarios: STANDARD.scenarios,
      progress: { completed: 0, total: 3 },
    });
    expect(bundle.instructions.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: BOOKSHOP_FIXTURE_IDS.reservationInstructionId, status: "confirmed" },
      { id: BOOKSHOP_FIXTURE_IDS.pickupInstructionId, status: "confirmed" },
      { id: BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId, status: "confirmed" },
    ]);
    expect(bundle.sourceEvidence).toEqual(STANDARD.sourceEvidence);
    expect(bundle).not.toHaveProperty("changeProposal");
  });

  it("requires owned confirmed instructions and rejects repeated creation", async () => {
    const unreviewedServer = makeServer();
    await importAndExtract(unreviewedServer);
    const unreviewed = await createPractice(unreviewedServer);
    expect(unreviewed.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(unreviewed.json()).error.code).toBe(
      "NO_CONFIRMED_INSTRUCTIONS",
    );

    const server = makeServer();
    await importAndExtract(server);
    await confirmAll(server);
    const foreignInstruction = await server.inject({
      method: "POST",
      url: "/api/practice-sets",
      headers: headers(),
      payload: {
        ...CREATE_REQUEST,
        instructionIds: [
          "20000000-0000-4000-8000-000000000099",
          BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
          BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        ],
      },
    });
    expect(foreignInstruction.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(foreignInstruction.json()).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    expect((await createPractice(server)).statusCode).toBe(201);
    const repeated = await createPractice(server);
    expect(repeated.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(repeated.json()).error.code).toBe("INVALID_STATE");
  });

  it("validates generator output before persistence and permits a clean retry", async () => {
    let generationCalls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      generateStandardPracticeSet(input) {
        generationCalls += 1;
        if (generationCalls === 1) {
          return { providerToken: "structured-output-secret" } as never;
        }
        return deterministicScenarioEngine.generateStandardPracticeSet(input);
      },
    };
    const server = makeServer({
      scenarioEngine,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        "30000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000012",
        "40000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
        BOOKSHOP_FIXTURE_IDS.reservationScenarioId,
        BOOKSHOP_FIXTURE_IDS.pickupScenarioId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnScenarioId,
      ],
    });
    await importAndExtract(server);
    await confirmAll(server);

    const malformed = await createPractice(server);
    expect(malformed.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(malformed.json()).error.code).toBe("INTERNAL_ERROR");
    expect(malformed.body).not.toContain("structured-output-secret");

    const retried = await createPractice(server);
    expect(retried.statusCode).toBe(201);
    const retryOutput = createPracticeSetResponseSchema.parse(retried.json());
    expect(retryOutput.practiceSet).toMatchObject({
      id: BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
      status: "ready",
      scenarioIds: STANDARD.practiceSet.scenarioIds,
    });
    expect(retryOutput.scenarios).toEqual(STANDARD.scenarios);
    expect(retryOutput.sourceEvidence).toEqual(STANDARD.sourceEvidence);
  });

  it.each([
    ["per-scenario evidence", swapScenarioEvidence],
    ["server-owned IDs and timestamps", substituteCreationMetadata],
  ] as const)("rejects generator-substituted %s and permits a clean retry", async (
    _kind,
    alter,
  ) => {
    let generationCalls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      generateStandardPracticeSet(input) {
        const generation = deterministicScenarioEngine.generateStandardPracticeSet(input);
        generationCalls += 1;
        return generationCalls === 1 ? alter(generation) : generation;
      },
    };
    const server = makeServer({
      scenarioEngine,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        "30000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000012",
        "40000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
        BOOKSHOP_FIXTURE_IDS.reservationScenarioId,
        BOOKSHOP_FIXTURE_IDS.pickupScenarioId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnScenarioId,
      ],
    });
    await importAndExtract(server);
    await confirmAll(server);

    const malformed = await createPractice(server);
    expect(malformed.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(malformed.json()).error.code).toBe("INTERNAL_ERROR");

    const retried = await createPractice(server);
    expect(retried.statusCode).toBe(201);
    expect(createPracticeSetResponseSchema.parse(retried.json())).toMatchObject({
      practiceSet: {
        id: BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
        scenarioIds: STANDARD.practiceSet.scenarioIds,
      },
      scenarios: STANDARD.scenarios,
      sourceEvidence: STANDARD.sourceEvidence,
    });
  });

  it("rejects a generator that mutates its scenario-ID input allocation", async () => {
    let generationCalls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      generateStandardPracticeSet(input) {
        generationCalls += 1;
        if (generationCalls === 1) {
          (input.scenarioIds as string[])[0] =
            "40000000-0000-4000-8000-000000000021";
        }
        return deterministicScenarioEngine.generateStandardPracticeSet(input);
      },
    };
    const server = makeServer({
      scenarioEngine,
      ids: [
        BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        "30000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000011",
        "40000000-0000-4000-8000-000000000012",
        "40000000-0000-4000-8000-000000000013",
        BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
        BOOKSHOP_FIXTURE_IDS.reservationScenarioId,
        BOOKSHOP_FIXTURE_IDS.pickupScenarioId,
        BOOKSHOP_FIXTURE_IDS.damagedReturnScenarioId,
      ],
    });
    await importAndExtract(server);
    await confirmAll(server);

    const mutated = await createPractice(server);
    expect(mutated.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(mutated.json()).error.code).toBe("INTERNAL_ERROR");

    const retried = await createPractice(server);
    expect(retried.statusCode).toBe(201);
    expect(createPracticeSetResponseSchema.parse(retried.json())).toMatchObject({
      practiceSet: {
        id: BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
        scenarioIds: STANDARD.practiceSet.scenarioIds,
      },
      scenarios: STANDARD.scenarios,
    });
  });

  it("hides another learner's practice-set identifier", async () => {
    const server = makeServer();
    await importAndExtract(server);
    await confirmAll(server);
    await createPractice(server);

    const response = await server.inject({
      method: "GET",
      url: `/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,
      headers: headers(OTHER_TOKEN),
    });
    expect(response.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("atomically stales affected sets on revocation and denies historical reads", async () => {
    const server = makeServer();
    await importAndExtract(server);
    await confirmAll(server);
    await createPractice(server);

    const revoked = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/consent/revoke`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      sourceConversation: { consentStatus: "revoked" },
      stalePracticeSetIds: [BOOKSHOP_FIXTURE_IDS.standardPracticeSetId],
    });

    const historical = await server.inject({
      method: "GET",
      url: `/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,
      headers: headers(),
    });
    expect(historical.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(historical.json()).error.code).toBe("CONSENT_REVOKED");

    const blocked = await createPractice(server);
    expect(blocked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(blocked.json()).error.code).toBe("CONSENT_REVOKED");
  });
});
