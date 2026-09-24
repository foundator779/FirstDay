import {
  beeSourceSchema,
  errorEnvelopeSchema,
  importConversationResponseSchema,
  revokeConsentResponseSchema,
} from "@firstday/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

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
} from "./server.js";

const SOURCE = beeSourceSchema.parse(onboardingJson);
const LEARNER_ID = "70000000-0000-4000-8000-000000000001";
const OTHER_LEARNER_ID = "70000000-0000-4000-8000-000000000002";
const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "learner-token";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const TIMESTAMP = "2026-09-11T12:00:00.000Z";

const servers: ApiServer[] = [];

function build(options: {
  repository?: ReturnType<typeof createMemoryRepository>;
  learnerId?: string;
  source?: typeof SOURCE;
} = {}) {
  const repository = options.repository ?? createMemoryRepository();
  const getConversation = vi.fn(async () => ({ conversation: options.source ?? SOURCE }));
  const beeGateway: BeeGateway = {
    health: vi.fn(async () => ({ authenticated: true })),
    listConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getConversation,
  };
  const ids = [SOURCE_ID];
  const server = buildApiServer({
    sessionVerifier: {
      verify: vi.fn(async () => ({ learnerId: options.learnerId ?? LEARNER_ID, access: "all" as const })),
    },
    beeGateway,
    repository,
    extractor: createFixtureInstructionExtractor(),
    scenarioEngine: deterministicScenarioEngine,
    clock: () => TIMESTAMP,
    idFactory: () => ids.shift() ?? "10000000-0000-4000-8000-000000000099",
    requestIdFactory: () => REQUEST_ID,
    allowedOrigins: [],
  });
  servers.push(server);
  return { server, repository, getConversation };
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

function importPayload() {
  return {
    beeSourceId: SOURCE.id,
    sourceKind: SOURCE.sourceKind,
    sourceRevision: SOURCE.revision,
    consent: { confirmed: true },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("POST /api/imports", () => {
  it.each([
    {},
    { consent: { confirmed: false } },
    { beeSourceId: 42, sourceKind: "invalid", consent: { confirmed: false } },
  ])("gives literal consent precedence for %#", async (payload) => {
    const { server, getConversation } = build();
    const response = await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("CONSENT_REQUIRED");
    expect(getConversation).not.toHaveBeenCalled();
  });

  it("imports the exact previewed revision as a ready compact source", async () => {
    const { server } = build();
    const response = await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: importPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = importConversationResponseSchema.parse(response.json());
    expect(body.sourceConversation).toMatchObject({
      id: SOURCE_ID,
      learnerId: LEARNER_ID,
      beeSourceId: SOURCE.id,
      sourceKind: "fixture",
      sourceRevision: SOURCE.revision,
      transcriptHash: "dfee89c91fa321314980bf085e216ff6941c4929709e7c2b6ffa11b79330c3bf",
      consentStatus: "confirmed",
      status: "ready",
    });
    expect(response.body).not.toContain(SOURCE.transcript);
  });

  it("returns the original record for an identical repeated import", async () => {
    const { server } = build();
    const first = await server.inject({ method: "POST", url: "/api/imports", headers: headers(), payload: importPayload() });
    const second = await server.inject({ method: "POST", url: "/api/imports", headers: headers(), payload: importPayload() });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });

  it("rejects a bridge revision different from the consented preview", async () => {
    const { server } = build();
    const response = await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: headers(),
      payload: { ...importPayload(), sourceRevision: "previewed-other-revision" },
    });
    expect(response.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("REVISION_CONFLICT");
  });
});

describe("POST /api/source-conversations/:id/consent/revoke", () => {
  it("revokes the learner's exact source revision", async () => {
    const { server } = build();
    await server.inject({ method: "POST", url: "/api/imports", headers: headers(), payload: importPayload() });
    const response = await server.inject({
      method: "POST",
      url: `/api/source-conversations/${SOURCE_ID}/consent/revoke`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision, reason: "Remove it." },
    });

    expect(response.statusCode).toBe(200);
    const body = revokeConsentResponseSchema.parse(response.json());
    expect(body.sourceConversation.consentStatus).toBe("revoked");
    expect(body.stalePracticeSetIds).toEqual([]);
  });

  it("does not reveal a source owned by a different learner", async () => {
    const repository = createMemoryRepository();
    const owner = build({ repository, learnerId: LEARNER_ID });
    await owner.server.inject({ method: "POST", url: "/api/imports", headers: headers(), payload: importPayload() });
    const stranger = build({ repository, learnerId: OTHER_LEARNER_ID });
    const response = await stranger.server.inject({
      method: "POST",
      url: `/api/source-conversations/${SOURCE_ID}/consent/revoke`,
      headers: headers(),
      payload: { sourceRevision: SOURCE.revision },
    });

    expect(response.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
