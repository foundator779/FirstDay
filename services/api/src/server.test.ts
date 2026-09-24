import { request as httpRequest } from "node:http";

import {
  errorEnvelopeSchema,
  getBeeConversationResponseSchema,
  healthResponseSchema,
  listBeeConversationsResponseSchema,
  type BeeSource,
  type ListBeeConversationsResponse,
} from "@firstday/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./errors.js";
import { createFixtureInstructionExtractor } from "./extraction.js";
import { createMemoryRepository } from "./memory-repository.js";
import {
  buildApiServer,
  deterministicScenarioEngine,
  listenOnLoopback,
  type ApiServer,
  type BeeGateway,
  type SessionVerifier,
} from "./server.js";

const LEARNER_ID = "70000000-0000-4000-8000-000000000001";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const SESSION_TOKEN = "learner-session-token";

const FIXTURE_SOURCE: BeeSource = {
  id: "fixture-source",
  sourceKind: "fixture",
  title: "Fixture onboarding",
  startedAt: "2026-09-10T16:00:00.000Z",
  endedAt: "2026-09-10T16:00:03.000Z",
  status: "processed",
  transcript: "Use the register checklist.",
  utterances: [
    {
      id: "utterance-1",
      startMs: 0,
      endMs: 3_000,
      text: "Use the register checklist.",
    },
  ],
  revision: "fixture-r1",
};

const openServers: ApiServer[] = [];

function fullSessionVerifier(access: "all" | "fixtureOnly" = "all"): SessionVerifier {
  return {
    verify: vi.fn(async (token: string) => {
      if (token !== SESSION_TOKEN) throw new Error("invalid token secret");
      return { learnerId: LEARNER_ID, access };
    }),
  };
}

function gateway(overrides: Partial<BeeGateway> = {}): BeeGateway {
  return {
    health: vi.fn(async () => ({ authenticated: true })),
    listConversations: vi.fn(async (input): Promise<ListBeeConversationsResponse> => ({
      items: [
        {
          id: "fixture-source",
          sourceKind: input.sourceKind,
          title: "Fixture onboarding",
          startedAt: "2026-09-10T16:00:00.000Z",
          status: "processed" as const,
          revision: "fixture-r1",
        },
      ],
      nextCursor: null,
    })),
    getConversation: vi.fn(async () => ({ conversation: FIXTURE_SOURCE })),
    ...overrides,
  };
}

function makeServer(options: {
  beeGateway?: BeeGateway;
  sessionVerifier?: SessionVerifier;
  origins?: string[];
} = {}): ApiServer {
  const server = buildApiServer({
    sessionVerifier: options.sessionVerifier ?? fullSessionVerifier(),
    beeGateway: options.beeGateway ?? gateway(),
    repository: createMemoryRepository(),
    extractor: createFixtureInstructionExtractor(),
    scenarioEngine: deterministicScenarioEngine,
    clock: () => "2026-09-11T12:00:00.000Z",
    idFactory: () => "a0000000-0000-4000-8000-000000000001",
    requestIdFactory: () => REQUEST_ID,
    allowedOrigins: options.origins ?? ["http://localhost:8081"],
  });
  openServers.push(server);
  return server;
}

function authHeaders(origin?: string): Record<string, string> {
  return {
    authorization: `Bearer ${SESSION_TOKEN}`,
    ...(origin === undefined ? {} : { origin }),
  };
}

type LoopbackResponse = {
  statusCode: number;
  body: string;
};

async function requestLoopback(input: {
  port: number;
  path: string;
  authorization?: string;
}): Promise<LoopbackResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: input.port,
        method: "GET",
        path: input.path,
        headers: input.authorization === undefined
          ? undefined
          : { authorization: input.authorization },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => server.close()));
});

describe("GET /health", () => {
  it.each([
    [{ authenticated: true }, "authenticated"],
    [{ authenticated: false }, "unauthenticated"],
  ] as const)("maps bridge health %#", async (bridgeHealth, expected) => {
    const server = makeServer({
      beeGateway: gateway({ health: vi.fn(async () => bridgeHealth) }),
      sessionVerifier: { verify: vi.fn(async () => { throw new Error("must not run"); }) },
    });

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      ok: true,
      service: "firstday-api",
      version: "0.2.0",
      beeBridge: expected,
    });
  });

  it("reports unavailable for transport or malformed bridge health", async () => {
    for (const health of [
      vi.fn(async () => { throw new Error("token and raw body"); }),
      vi.fn(async () => ({ authenticated: "yes" } as never)),
    ]) {
      const server = makeServer({ beeGateway: gateway({ health }) });
      const response = await server.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ beeBridge: "unavailable" });
    }
  });
});

describe("learner-authenticated Bee proxy", () => {
  it("requires one exact Bearer session and sanitizes verifier failures", async () => {
    const server = makeServer();

    for (const authorization of [undefined, "bearer learner-session-token", "Bearer", "Bearer wrong token"]) {
      const response = await server.inject({
        method: "GET",
        url: "/api/bee/conversations?sourceKind=fixture",
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });
      expect(response.statusCode).toBe(401);
      const body = errorEnvelopeSchema.parse(response.json());
      expect(body.error).toEqual({
        code: "UNAUTHENTICATED",
        message: "A valid FirstDay learner session is required.",
        details: {},
        requestId: REQUEST_ID,
      });
      expect(response.body).not.toContain("invalid token secret");
    }
  });

  it("forwards normalized list inputs without re-filtering", async () => {
    const listConversations = vi.fn(async () => ({
      items: [
        {
          id: "fixture-source",
          sourceKind: "fixture" as const,
          title: "Unmatched title intentionally preserved",
          startedAt: "2026-09-10T16:00:00.000Z",
          status: "processed" as const,
        },
      ],
      nextCursor: "next-handle",
    }));
    const server = makeServer({ beeGateway: gateway({ listConversations }) });

    const response = await server.inject({
      method: "GET",
      url: "/api/bee/conversations?sourceKind=fixture&query=bookshop&cursor=opaque&limit=07",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(listBeeConversationsResponseSchema.parse(response.json()).items[0]?.title).toBe(
      "Unmatched title intentionally preserved",
    );
    expect(listConversations).toHaveBeenCalledWith({
      sourceKind: "fixture",
      query: "bookshop",
      cursor: "opaque",
      limit: 7,
    });
  });

  it("gets a complete source and correlates its kind and ID", async () => {
    const getConversation = vi.fn(async () => ({ conversation: FIXTURE_SOURCE }));
    const server = makeServer({ beeGateway: gateway({ getConversation }) });

    const response = await server.inject({
      method: "GET",
      url: "/api/bee/conversations/fixture-source?sourceKind=fixture",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(getBeeConversationResponseSchema.parse(response.json())).toEqual({
      conversation: FIXTURE_SOURCE,
    });
    expect(getConversation).toHaveBeenCalledWith({
      beeSourceId: "fixture-source",
      sourceKind: "fixture",
    });
  });

  it.each([
    ["list", gateway({ listConversations: vi.fn(async () => ({ items: [{ ...FIXTURE_SOURCE, id: "x", sourceKind: "bee" }], nextCursor: null })) as unknown as BeeGateway["listConversations"] })],
    ["detail-id", gateway({ getConversation: vi.fn(async () => ({ conversation: { ...FIXTURE_SOURCE, id: "different" } })) as unknown as BeeGateway["getConversation"] })],
    ["detail-kind", gateway({ getConversation: vi.fn(async () => ({ conversation: { ...FIXTURE_SOURCE, sourceKind: "bee" } })) as unknown as BeeGateway["getConversation"] })],
  ])("rejects malformed or uncorrelated %s gateway output", async (kind, beeGateway) => {
    const server = makeServer({ beeGateway });
    const response = await server.inject({
      method: "GET",
      url: kind === "list"
        ? "/api/bee/conversations?sourceKind=fixture"
        : "/api/bee/conversations/fixture-source?sourceKind=fixture",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(500);
    const body = errorEnvelopeSchema.parse(response.json());
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body).not.toContain("different");
  });

  it("prevents a public fixture-demo session from accessing live Bee data", async () => {
    const liveList = vi.fn();
    const server = makeServer({
      sessionVerifier: fullSessionVerifier("fixtureOnly"),
      beeGateway: gateway({ listConversations: liveList }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/bee/conversations?sourceKind=bee",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("FORBIDDEN");
    expect(liveList).not.toHaveBeenCalled();
  });

  it("replaces dependency-provided ApiError messages with the canonical safe message", async () => {
    const server = makeServer({
      beeGateway: gateway({
        listConversations: vi.fn(async () => {
          throw new ApiError(
            "BEE_BRIDGE_UNAVAILABLE",
            "bridge token secret-token and raw upstream response",
          );
        }),
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/bee/conversations?sourceKind=fixture",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(503);
    expect(errorEnvelopeSchema.parse(response.json()).error.message).toBe(
      "The local Bee bridge is not reachable.",
    );
    expect(response.body).not.toContain("secret-token");
    expect(response.body).not.toContain("raw upstream response");
  });
});

describe("HTTP boundary", () => {
  it("rejects duplicate query values, unknown fields, collisions, and GET bodies", async () => {
    const server = makeServer();
    const requests = [
      { method: "GET" as const, url: "/api/bee/conversations?sourceKind=fixture&sourceKind=bee" },
      { method: "GET" as const, url: "/api/bee/conversations?sourceKind=fixture&unknown=x" },
      { method: "GET" as const, url: "/api/bee/conversations/fixture-source?sourceKind=fixture&beeSourceId=collision" },
      {
        method: "GET" as const,
        url: "/api/bee/conversations?sourceKind=fixture",
        payload: "{}",
        headers: { ...authHeaders(), "content-type": "application/json" },
      },
    ];

    for (const request of requests) {
      const response = await server.inject({ ...request, headers: request.headers ?? authHeaders() });
      expect(response.statusCode).toBe(422);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("emits exact CORS headers only for configured origins", async () => {
    const server = makeServer({ origins: ["http://localhost:8081"] });
    const allowed = await server.inject({
      method: "GET",
      url: "/api/bee/conversations?sourceKind=fixture",
      headers: authHeaders("http://localhost:8081"),
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    expect(allowed.headers.vary).toContain("Origin");

    const denied = await server.inject({
      method: "GET",
      url: "/api/bee/conversations?sourceKind=fixture",
      headers: authHeaders("http://evil.example"),
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows exact-origin unauthenticated preflight", async () => {
    const verifier = fullSessionVerifier();
    const server = makeServer({ sessionVerifier: verifier });
    const response = await server.inject({
      method: "OPTIONS",
      url: "/api/bee/conversations",
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization, content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, POST, PATCH, OPTIONS");
    expect(response.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("uses canonical errors for authenticated unknown routes and unsupported methods", async () => {
    const server = makeServer();
    for (const request of [
      { method: "GET" as const, url: "/api/not-a-route" },
      { method: "DELETE" as const, url: "/api/bee/conversations" },
    ]) {
      const response = await server.inject({ ...request, headers: authHeaders() });
      expect(response.statusCode).toBe(404);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
    }
  });

  it("listens only on IPv4 loopback with an ephemeral test port", async () => {
    const server = makeServer();
    const address = await listenOnLoopback(server, 0);
    expect(address.host).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    expect(server.server.address()).toMatchObject({ address: "127.0.0.1" });
  });

  it("authenticates and canonicalizes malformed URLs before router handling", async () => {
    const server = makeServer();
    const { port } = await listenOnLoopback(server, 0);

    for (const [authorization, expectedStatus, expectedCode] of [
      [undefined, 401, "UNAUTHENTICATED"],
      ["Bearer wrong-token", 401, "UNAUTHENTICATED"],
      [`Bearer ${SESSION_TOKEN}`, 422, "VALIDATION_ERROR"],
    ] as const) {
      const response = await requestLoopback({
        port,
        path: "/api/%",
        ...(authorization === undefined ? {} : { authorization }),
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(errorEnvelopeSchema.parse(JSON.parse(response.body)).error.code).toBe(expectedCode);
      expect(response.body).not.toContain("invalid token secret");
    }
  });

  it("authenticates then rejects malformed query percent encodings before Bee access", async () => {
    const listConversations = vi.fn(async () => ({ items: [], nextCursor: null }));
    const server = makeServer({ beeGateway: gateway({ listConversations }) });
    const { port } = await listenOnLoopback(server, 0);

    for (const path of [
      "/api/bee/conversations?sourceKind=fixture&cursor=%",
      "/api/bee/conversations?sourceKind=fixture&cursor=%ZZ",
      "/api/bee/conversations?sourceKind=fixture&query=%E0%A4%A",
    ]) {
      for (const [authorization, expectedStatus, expectedCode] of [
        [undefined, 401, "UNAUTHENTICATED"],
        ["Bearer wrong-token", 401, "UNAUTHENTICATED"],
        [`Bearer ${SESSION_TOKEN}`, 422, "VALIDATION_ERROR"],
      ] as const) {
        const response = await requestLoopback({
          port,
          path,
          ...(authorization === undefined ? {} : { authorization }),
        });
        expect(response.statusCode).toBe(expectedStatus);
        expect(errorEnvelopeSchema.parse(JSON.parse(response.body)).error.code).toBe(expectedCode);
      }
    }
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("accepts headers above Node's default while enforcing the API URL limit", async () => {
    const server = makeServer();
    const { port } = await listenOnLoopback(server, 0);

    for (const cursorLength of [18 * 1024, 21 * 1024]) {
      for (const [authorization, expectedStatus, expectedCode] of [
        [undefined, 401, "UNAUTHENTICATED"],
        ["Bearer wrong-token", 401, "UNAUTHENTICATED"],
        [`Bearer ${SESSION_TOKEN}`, 422, "VALIDATION_ERROR"],
      ] as const) {
        const response = await requestLoopback({
          port,
          path: `/api/bee/conversations?sourceKind=fixture&cursor=${"x".repeat(cursorLength)}`,
          ...(authorization === undefined ? {} : { authorization }),
        });
        expect(response.statusCode).toBe(expectedStatus);
        expect(errorEnvelopeSchema.parse(JSON.parse(response.body)).error.code).toBe(expectedCode);
      }
    }
  });

  it("maps malformed JSON, unsupported content types, and oversized bodies to canonical validation errors", async () => {
    const server = makeServer();
    for (const request of [
      {
        method: "POST" as const,
        url: "/api/imports",
        headers: { ...authHeaders(), "content-type": "application/json" },
        payload: "{broken",
      },
      {
        method: "POST" as const,
        url: "/api/imports",
        headers: { ...authHeaders(), "content-type": "text/plain" },
        payload: "plain",
      },
      {
        method: "POST" as const,
        url: "/api/imports",
        headers: { ...authHeaders(), "content-type": "application/json" },
        payload: JSON.stringify({ value: "x".repeat(70 * 1024) }),
      },
    ]) {
      const response = await server.inject(request);
      expect(response.statusCode, `${request.headers["content-type"]}:${request.payload.length}`).toBe(422);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it.each([
    "application/json",
    "Application/JSON",
    "application/json; charset=utf-8",
    "application/json ; Charset=UTF-8",
  ])("accepts the canonical JSON content type %s", async (contentType) => {
    const server = makeServer();
    const response = await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: { ...authHeaders(), "content-type": contentType },
      payload: JSON.stringify({
        sourceKind: "fixture",
        beeSourceId: "fixture-source",
        sourceRevision: "fixture-r1",
        consent: { confirmed: true },
      }),
    });

    expect(response.statusCode).toBe(201);
  });

  it.each([
    "application/json; charset=latin1",
    "application/json; profile=firstday",
    "application/json; charset=utf-8; charset=utf-8",
    "application/json; charset=utf-8; profile=firstday",
    'application/json; charset="utf-8"',
    "application/json\u00a0;\u00a0charset=utf-8",
    "application/json\n",
  ])("rejects non-canonical JSON content type %s before route logic", async (contentType) => {
    const getConversation = vi.fn(async () => ({ conversation: FIXTURE_SOURCE }));
    const server = makeServer({ beeGateway: gateway({ getConversation }) });
    const response = await server.inject({
      method: "POST",
      url: "/api/imports",
      headers: { ...authHeaders(), "content-type": contentType },
      payload: JSON.stringify({
        sourceKind: "fixture",
        beeSourceId: "fixture-source",
        sourceRevision: "fixture-r1",
        consent: { confirmed: true },
      }),
    });

    expect(response.statusCode).toBe(422);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(getConversation).not.toHaveBeenCalled();
  });
});
