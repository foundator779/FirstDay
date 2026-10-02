import {
  beeSourceSchema,
  createAttemptResponseSchema,
  errorEnvelopeSchema,
  extractInstructionsResponseSchema,
  getPracticeSetResponseSchema,
  type InputMode,
} from "@firstday/contracts";
import {
  BOOKSHOP_FIXTURE_IDS,
  ScenarioEngineError,
} from "@firstday/scenario-engine";
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
const EVALUATIONS = goldenJson.evaluations;
const TOKEN = "learner-token";
const OTHER_TOKEN = "other-learner-token";
const OTHER_LEARNER_ID = "70000000-0000-4000-8000-000000000002";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_IDS = Array.from(
  { length: 12 },
  (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const servers: ApiServer[] = [];

function queue<T>(values: readonly T[], fallback: T): () => T {
  const remaining = [...values];
  return () => remaining.shift() ?? fallback;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeServer(options: { scenarioEngine?: ScenarioEngineFacade } = {}) {
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
      "2026-09-10T16:04:00.000Z",
      "2026-09-10T16:05:00.000Z",
      "2026-09-10T16:06:00.000Z",
      "2026-09-10T16:07:00.000Z",
      "2026-09-10T16:08:00.000Z",
      "2026-09-10T16:09:00.000Z",
      "2026-09-10T16:10:00.000Z",
      "2026-09-10T16:11:00.000Z",
      "2026-09-10T16:12:00.000Z",
    ], "2026-09-10T16:59:00.000Z"),
    idFactory: queue([
      BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
      BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
      BOOKSHOP_FIXTURE_IDS.standardPracticeSetId,
      BOOKSHOP_FIXTURE_IDS.reservationScenarioId,
      BOOKSHOP_FIXTURE_IDS.pickupScenarioId,
      BOOKSHOP_FIXTURE_IDS.damagedReturnScenarioId,
      ...ATTEMPT_IDS,
    ], "50000000-0000-4000-8000-999999999999"),
    requestIdFactory: () => REQUEST_ID,
    allowedOrigins: [],
  });
  servers.push(server);
  return server;
}

function headers(token = TOKEN) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function setupPractice(server: ApiServer) {
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
  expect(extractInstructionsResponseSchema.parse(extracted.json()).items).toHaveLength(3);
  for (const instructionId of [
    BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
    BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
  ]) {
    const confirmed = await server.inject({
      method: "PATCH",
      url: `/api/instructions/${instructionId}`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, status: "confirmed" },
    });
    expect(confirmed.statusCode).toBe(200);
  }
  const practice = await server.inject({
    method: "POST",
    url: "/api/practice-sets",
    headers: headers(),
    payload: {
      sourceConversationId: BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId,
      sourceRevision: SOURCE.revision,
      instructionIds: [
        BOOKSHOP_FIXTURE_IDS.damagedReturnInstructionId,
        BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
        BOOKSHOP_FIXTURE_IDS.pickupInstructionId,
      ],
      title: "Bookshop first shift",
    },
  });
  expect(practice.statusCode).toBe(201);
}

function attemptRequest(
  scenarioId: string,
  responseText: string,
  inputMode: InputMode,
  overrides: Partial<{ sourceRevision: string; instructionRevision: string }> = {},
) {
  return {
    method: "POST" as const,
    url: `/api/scenarios/${scenarioId}/attempts`,
    headers: headers(),
    payload: {
      sourceRevision: overrides.sourceRevision ?? SOURCE.revision,
      instructionRevision:
        overrides.instructionRevision ?? BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
      responseText,
      inputMode,
    },
  };
}

async function readPractice(server: ApiServer) {
  const response = await server.inject({
    method: "GET",
    url: `/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,
    headers: headers(),
  });
  expect(response.statusCode).toBe(200);
  return getPracticeSetResponseSchema.parse(response.json());
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("scenario attempt routes", () => {
  it("uses one evaluator path for exact missed, partial, and covered voice/text progression", async () => {
    const evaluateScenario = vi.fn(deterministicScenarioEngine.evaluateScenario);
    const server = makeServer({
      scenarioEngine: { ...deterministicScenarioEngine, evaluateScenario },
    });
    await setupPractice(server);

    const journey = [
      { example: EVALUATIONS[2]!, mode: "voice" as const, status: "ready", next: "retry" },
      { example: EVALUATIONS[1]!, mode: "text" as const, status: "ready", next: "retry" },
      { example: EVALUATIONS[0]!, mode: "voice" as const, status: "inProgress", next: "continue" },
    ];
    for (const [index, step] of journey.entries()) {
      const response = await server.inject(
        attemptRequest(step.example.scenarioId, step.example.responseText, step.mode),
      );
      expect(response.statusCode).toBe(200);
      const output = createAttemptResponseSchema.parse(response.json());
      expect(output.practiceSet.status).toBe(step.status);
      expect(output.nextAction).toBe(step.next);
      expect(output.attempt).toMatchObject({
        id: ATTEMPT_IDS[index],
        scenarioId: step.example.scenarioId,
        sourceRevision: SOURCE.revision,
        instructionRevision: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
        responseText: step.example.responseText,
        inputMode: step.mode,
        ...step.example.expected,
      });
      expect(output.instructions.map(({ id }) => id)).toEqual(
        output.scenario.expectedRuleIds,
      );
      expect(output.sourceEvidence.map(({ id }) => id)).toEqual(
        output.scenario.sourceEvidence,
      );
    }
    expect(evaluateScenario).toHaveBeenCalledTimes(3);
    const firstEvaluationContext = evaluateScenario.mock.calls[0]?.[0];
    expect(firstEvaluationContext?.instructions.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.reservationInstructionId,
    ]);
    expect(firstEvaluationContext?.sourceEvidence.map(({ id }) => id)).toEqual([
      BOOKSHOP_FIXTURE_IDS.reservationEvidenceId,
    ]);
    expect((await readPractice(server)).progress).toEqual({ completed: 1, total: 3 });

    const repeated = await server.inject(
      attemptRequest(EVALUATIONS[0]!.scenarioId, EVALUATIONS[0]!.responseText, "text"),
    );
    expect(repeated.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(repeated.json()).error.code).toBe("INVALID_STATE");

    for (const [index, example] of [EVALUATIONS[3]!, EVALUATIONS[6]!].entries()) {
      const response = await server.inject(
        attemptRequest(example.scenarioId, example.responseText, index === 0 ? "text" : "voice"),
      );
      expect(response.statusCode).toBe(200);
      const output = createAttemptResponseSchema.parse(response.json());
      expect(output.attempt).toMatchObject(example.expected);
      expect(output.practiceSet.status).toBe(index === 0 ? "inProgress" : "complete");
      expect(output.nextAction).toBe(index === 0 ? "continue" : "complete");
    }

    const completed = await readPractice(server);
    expect(completed.practiceSet.status).toBe("complete");
    expect(completed.progress).toEqual({ completed: 3, total: 3 });
    const afterComplete = await server.inject(
      attemptRequest(EVALUATIONS[4]!.scenarioId, EVALUATIONS[4]!.responseText, "text"),
    );
    expect(afterComplete.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(afterComplete.json()).error.code).toBe("INVALID_STATE");
  });

  it("enforces learner ownership and both optimistic revision guards before evaluation", async () => {
    const evaluateScenario = vi.fn(deterministicScenarioEngine.evaluateScenario);
    const server = makeServer({
      scenarioEngine: { ...deterministicScenarioEngine, evaluateScenario },
    });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;

    for (const request of [
      attemptRequest(example.scenarioId, example.responseText, "text", {
        sourceRevision: "fixture-bookshop-onboarding-stale",
      }),
      attemptRequest(example.scenarioId, example.responseText, "voice", {
        instructionRevision: "bookshop-instructions-stale",
      }),
    ]) {
      const response = await server.inject(request);
      expect(response.statusCode).toBe(409);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("REVISION_CONFLICT");
    }
    const foreign = await server.inject({
      ...attemptRequest(example.scenarioId, example.responseText, "text"),
      headers: headers(OTHER_TOKEN),
    });
    expect(foreign.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(foreign.json()).error.code).toBe("RESOURCE_NOT_FOUND");
    expect(evaluateScenario).not.toHaveBeenCalled();
  });

  it("rejects schema-valid forged evaluator evidence without state mutation and allows retry", async () => {
    let calls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      evaluateScenario(input) {
        calls += 1;
        if (calls === 1) {
          return {
            result: "covered",
            matchedRuleIds: [...input.scenario.expectedRuleIds],
            missedRuleIds: [],
            sourceEvidence: [BOOKSHOP_FIXTURE_IDS.pickupEvidenceId],
            feedback: "forged-provider-secret",
          };
        }
        return deterministicScenarioEngine.evaluateScenario(input);
      },
    };
    const server = makeServer({ scenarioEngine });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;
    const request = attemptRequest(example.scenarioId, example.responseText, "text");

    const forged = await server.inject(request);
    expect(forged.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(forged.json()).error.code).toBe("INTERNAL_ERROR");
    expect(forged.body).not.toContain("forged-provider-secret");
    expect((await readPractice(server)).progress).toEqual({ completed: 0, total: 3 });

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(createAttemptResponseSchema.parse(retried.json()).attempt).toMatchObject(
      example.expected,
    );
    expect((await readPractice(server)).progress).toEqual({ completed: 1, total: 3 });
  });

  it("sanitizes evaluator ScenarioEngineError failures without consuming the attempt", async () => {
    let calls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      evaluateScenario(input) {
        calls += 1;
        if (calls === 1) {
          throw new ScenarioEngineError(
            "INVALID_STATE",
            "provider-secret trusted context diagnostic",
          );
        }
        return deterministicScenarioEngine.evaluateScenario(input);
      },
    };
    const server = makeServer({ scenarioEngine });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;
    const request = attemptRequest(example.scenarioId, example.responseText, "text");

    const failed = await server.inject(request);
    expect(failed.statusCode).toBe(500);
    expect(errorEnvelopeSchema.parse(failed.json()).error.code).toBe("INTERNAL_ERROR");
    expect(failed.body).not.toContain("provider-secret");
    expect((await readPractice(server)).progress).toEqual({ completed: 0, total: 3 });

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(createAttemptResponseSchema.parse(retried.json())).toMatchObject({
      attempt: { id: ATTEMPT_IDS[0], ...example.expected },
      practiceSet: { status: "inProgress" },
    });
    expect((await readPractice(server)).progress).toEqual({ completed: 1, total: 3 });
  });

  it("rejects evaluator metadata substitution and invalid rule partitions atomically", async () => {
    let calls = 0;
    const scenarioEngine: ScenarioEngineFacade = {
      ...deterministicScenarioEngine,
      evaluateScenario(input) {
        calls += 1;
        const valid = deterministicScenarioEngine.evaluateScenario(input);
        if (calls === 1) {
          return {
            ...valid,
            id: "50000000-0000-4000-8000-777777777777",
            sourceRevision: "provider-substituted-source-revision",
            createdAt: "2026-09-10T00:00:00.000Z",
            feedback: "dependency-allocation-secret",
          } as ReturnType<ScenarioEngineFacade["evaluateScenario"]>;
        }
        if (calls === 2) {
          return {
            ...valid,
            matchedRuleIds: [BOOKSHOP_FIXTURE_IDS.pickupInstructionId],
            feedback: "dependency-partition-secret",
          };
        }
        return valid;
      },
    };
    const server = makeServer({ scenarioEngine });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;
    const request = attemptRequest(example.scenarioId, example.responseText, "text");

    for (const secret of ["dependency-allocation-secret", "dependency-partition-secret"]) {
      const rejected = await server.inject(request);
      expect(rejected.statusCode).toBe(500);
      expect(errorEnvelopeSchema.parse(rejected.json()).error.code).toBe("INTERNAL_ERROR");
      expect(rejected.body).not.toContain(secret);
      expect((await readPractice(server)).progress).toEqual({ completed: 0, total: 3 });
    }

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(createAttemptResponseSchema.parse(retried.json())).toMatchObject({
      practiceSet: { status: "inProgress" },
      attempt: { id: ATTEMPT_IDS[2], ...example.expected },
    });
    expect((await readPractice(server)).progress).toEqual({ completed: 1, total: 3 });
  });

  it("returns reviewSource for needs-review without advancing a ready set", async () => {
    let calls = 0;
    const evaluateScenario = vi.fn<ScenarioEngineFacade["evaluateScenario"]>((input) => {
      calls += 1;
      if (calls === 1) {
        return {
          result: "needsReview",
          matchedRuleIds: [],
          missedRuleIds: [...input.scenario.expectedRuleIds],
          sourceEvidence: [...input.scenario.sourceEvidence],
          feedback: "Review the source evidence before trying this scenario again.",
        };
      }
      return deterministicScenarioEngine.evaluateScenario(input);
    });
    const server = makeServer({
      scenarioEngine: { ...deterministicScenarioEngine, evaluateScenario },
    });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;
    const request = attemptRequest(example.scenarioId, example.responseText, "voice");

    const needsReview = await server.inject(request);
    expect(needsReview.statusCode).toBe(200);
    const output = createAttemptResponseSchema.parse(needsReview.json());
    expect(output).toMatchObject({
      practiceSet: { status: "ready" },
      attempt: { result: "needsReview" },
      nextAction: "reviewSource",
    });
    expect((await readPractice(server)).progress).toEqual({ completed: 0, total: 3 });

    const retried = await server.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(createAttemptResponseSchema.parse(retried.json())).toMatchObject({
      practiceSet: { status: "inProgress" },
      attempt: { result: "covered" },
      nextAction: "continue",
    });
    expect(evaluateScenario).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent covered attempts so one succeeds and progress stays distinct", async () => {
    const server = makeServer();
    await setupPractice(server);
    const example = EVALUATIONS[0]!;
    const request = attemptRequest(example.scenarioId, example.responseText, "voice");

    const responses = await Promise.all([server.inject(request), server.inject(request)]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    const conflict = responses.find(({ statusCode }) => statusCode === 409)!;
    expect(errorEnvelopeSchema.parse(conflict.json()).error.code).toBe("INVALID_STATE");
    expect((await readPractice(server)).progress).toEqual({ completed: 1, total: 3 });
  });

  it("rechecks revocation after a paused evaluator before persisting an attempt", async () => {
    type EvaluationInput = Parameters<ScenarioEngineFacade["evaluateScenario"]>[0];
    type Evaluation = Awaited<ReturnType<ScenarioEngineFacade["evaluateScenario"]>>;
    const started = deferred<EvaluationInput>();
    const completed = deferred<Evaluation>();
    const evaluateScenario: ScenarioEngineFacade["evaluateScenario"] = (input: EvaluationInput) => {
      started.resolve(input);
      return completed.promise;
    };
    const server = makeServer({
      scenarioEngine: { ...deterministicScenarioEngine, evaluateScenario },
    });
    await setupPractice(server);
    const example = EVALUATIONS[0]!;

    const pendingAttempt = server.inject(
      attemptRequest(example.scenarioId, example.responseText, "voice"),
    );
    const evaluationInput = await started.promise;
    const revoked = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${BOOKSHOP_FIXTURE_IDS.onboardingSourceConversationId}/consent/revoke`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision },
    });
    expect(revoked.statusCode).toBe(200);
    completed.resolve(deterministicScenarioEngine.evaluateScenario(evaluationInput));

    const rejected = await pendingAttempt;
    expect(rejected.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(rejected.json()).error.code).toBe(
      "STALE_PRACTICE_SET",
    );
    expect(revoked.json().stalePracticeSetIds).toContain(BOOKSHOP_FIXTURE_IDS.standardPracticeSetId);
    const historical=await server.inject({method:"GET",url:`/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,headers:headers()});
    expect(historical.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(historical.json()).error.code).toBe("CONSENT_REVOKED");
  });

  it("stales a completed set on revocation and blocks subsequent attempts", async () => {
    const server = makeServer();
    await setupPractice(server);
    for (const example of [EVALUATIONS[0]!, EVALUATIONS[3]!, EVALUATIONS[6]!]) {
      const response = await server.inject(
        attemptRequest(example.scenarioId, example.responseText, "text"),
      );
      expect(response.statusCode).toBe(200);
    }
    expect((await readPractice(server)).practiceSet.status).toBe("complete");

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
    const historical=await server.inject({method:"GET",url:`/api/practice-sets/${BOOKSHOP_FIXTURE_IDS.standardPracticeSetId}`,headers:headers()});
    expect(historical.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(historical.json()).error.code).toBe("CONSENT_REVOKED");

    const blocked = await server.inject(
      attemptRequest(EVALUATIONS[4]!.scenarioId, EVALUATIONS[4]!.responseText, "voice"),
    );
    expect(blocked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(blocked.json()).error.code).toBe(
      "STALE_PRACTICE_SET",
    );
  });
});
