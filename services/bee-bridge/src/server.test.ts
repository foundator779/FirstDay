import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  beeBridgeHealthResponseSchema,
  errorEnvelopeSchema,
  getBeeConversationResponseSchema,
  listBeeConversationsResponseSchema,
  recentBeeChangesResponseSchema,
  type BeeAdapter,
  type BeeAdapterRegistry,
  type BeeSource,
  type SourceKind,
} from "@firstday/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BeeBridgeError, type BeeCliRunner } from "./adapter.js";
import {
  BRIDGE_START_FAILURE_MESSAGE,
  DEFAULT_BEE_BRIDGE_PORT,
  LOOPBACK_HOST,
  createBeeCliChildEnvironment,
  createProductionBridgeServer,
  loadBookshopFixtureSources,
  readBridgeRuntimeConfig,
} from "./index.js";
import {
  buildBridgeServer,
  listenOnLoopback,
  type BridgeServer,
} from "./server.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TOKEN = "firstday-bridge-test-token-32-characters";
const WRONG_TOKEN = "wrong-firstday-bridge-token-32-chars";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";

function fixtureSource(
  sourceKind: SourceKind = "fixture",
  overrides: Partial<BeeSource> = {},
): BeeSource {
  const id = overrides.id ?? `${sourceKind}-bookshop-onboarding`;
  return {
    id,
    sourceKind,
    title: "Bookshop onboarding",
    startedAt: "2026-09-10T16:00:00.000Z",
    endedAt: "2026-09-10T16:00:05.000Z",
    status: "processed",
    transcript: "Reservations last five days.",
    utterances: [
      {
        id: `${id}-utterance-1`,
        startMs: 0,
        endMs: 5_000,
        text: "Reservations last five days.",
        speaker: { label: "trainer", name: "Maya" },
      },
    ],
    revision: `${sourceKind}:${id}:r1`,
    speakers: [{ label: "trainer", name: "Maya" }],
    ...overrides,
  };
}

type AdapterOverrides = Partial<{
  health: BeeAdapter["health"];
  listCandidateConversations: BeeAdapter["listCandidateConversations"];
  getConversation: BeeAdapter["getConversation"];
  getRecentChanges: BeeAdapter["getRecentChanges"];
}>;

function adapter(sourceKind: SourceKind, overrides: AdapterOverrides = {}): BeeAdapter {
  const source = fixtureSource(sourceKind);
  return {
    sourceKind,
    async health() {
      return { authenticated: true, lastSyncAt: source.startedAt };
    },
    async listCandidateConversations() {
      return {
        items: [
          {
            id: source.id,
            sourceKind,
            title: source.title,
            startedAt: source.startedAt,
            endedAt: source.endedAt,
            status: source.status,
            revision: source.revision,
          },
        ],
        nextCursor: null,
      };
    },
    async getConversation() {
      return source;
    },
    async getRecentChanges() {
      return {
        items: [
          {
            id: source.id,
            sourceKind,
            title: source.title,
            startedAt: source.startedAt,
            endedAt: source.endedAt,
            status: source.status,
            revision: source.revision,
          },
        ],
        nextCursor: null,
      };
    },
    ...overrides,
  };
}

function registry(overrides: Partial<BeeAdapterRegistry> = {}): BeeAdapterRegistry {
  return {
    bee: adapter("bee"),
    fixture: adapter("fixture"),
    ...overrides,
  };
}

function createServer(
  adapters: BeeAdapterRegistry = registry(),
  bearerToken = TOKEN,
): BridgeServer {
  return buildBridgeServer({
    registry: adapters,
    bearerToken,
    requestIdFactory: () => REQUEST_ID,
  });
}

function authorization(token = TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function expectCanonicalError(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
): void {
  expect(response.statusCode).toBe(status);
  const body = response.json();
  expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({
    error: {
      code,
      details: {},
      requestId: REQUEST_ID,
    },
  });
}

const openServers = new Set<BridgeServer>();

afterEach(async () => {
  await Promise.all([...openServers].map(async (server) => server.close()));
  openServers.clear();
  vi.restoreAllMocks();
});

describe("buildBridgeServer authentication and startup invariants", () => {
  it.each([
    "",
    "short",
    " firstday-bridge-token-that-is-long-enough",
    "firstday-bridge-token-that-is-long-enough ",
    "firstday bridge token that is long enough",
    "firstday-bridge-token-that-is-long\nenough",
    "é".repeat(32),
    "\u0001".repeat(32),
    ":".repeat(32),
  ])("rejects an ambiguous or undersized configured token without echoing it", (token) => {
    let error: unknown;
    try {
      createServer(registry(), token);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BeeBridgeError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
    if (token.length > 0) {
      expect(String(error)).not.toContain(token);
    }
  });

  it.each([
    undefined,
    "",
    "Basic Zm9vOmJhcg==",
    "Bearer",
    `Bearer  ${TOKEN}`,
    `bearer ${TOKEN}`,
    `Bearer ${TOKEN} trailing`,
    `Bearer ${WRONG_TOKEN}`,
  ])("rejects malformed or incorrect authorization %#", async (header) => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      ...(header === undefined ? {} : { headers: { authorization: header } }),
    });
    expectCanonicalError(response, 401, "UNAUTHENTICATED");
    expect(response.body).not.toContain(TOKEN);
    expect(response.body).not.toContain(WRONG_TOKEN);
  });

  it("does not invoke an adapter after authentication fails", async () => {
    const health = vi.fn(async () => ({ authenticated: true as const }));
    const server = createServer(registry({ bee: adapter("bee", { health }) }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: authorization(WRONG_TOKEN),
    });

    expectCanonicalError(response, 401, "UNAUTHENTICATED");
    expect(health).not.toHaveBeenCalled();
  });

  it("authenticates health against the live adapter only", async () => {
    const beeHealth = vi.fn(async () => ({
      authenticated: true as const,
      lastSyncAt: "2026-09-11T17:00:00.000Z",
    }));
    const fixtureHealth = vi.fn(async () => {
      throw new Error("fixture health must not be called");
    });
    const server = createServer(registry({
      bee: adapter("bee", { health: beeHealth }),
      fixture: adapter("fixture", { health: fixtureHealth }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(beeBridgeHealthResponseSchema.parse(response.json())).toEqual({
      authenticated: true,
      lastSyncAt: "2026-09-11T17:00:00.000Z",
    });
    expect(beeHealth).toHaveBeenCalledOnce();
    expect(fixtureHealth).not.toHaveBeenCalled();
  });
});

describe("bridge route validation and adapter selection", () => {
  it("parses and forwards a strict normalized conversation-list request", async () => {
    const list = vi.fn(async () => ({
      items: [],
      nextCursor: null,
    }));
    const server = createServer(registry({
      fixture: adapter("fixture", { listCandidateConversations: list }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture&query=onboarding&cursor=opaque&limit=2",
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(listBeeConversationsResponseSchema.parse(response.json())).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(list).toHaveBeenCalledWith({
      sourceKind: "fixture",
      query: "onboarding",
      cursor: "opaque",
      limit: 2,
    });
  });

  it("selects live and fixture adapters without fallback", async () => {
    const liveList = vi.fn(async () => ({ items: [], nextCursor: null }));
    const fixtureList = vi.fn(async () => ({ items: [], nextCursor: null }));
    const adapters = registry({
      bee: adapter("bee", { listCandidateConversations: liveList }),
      fixture: adapter("fixture", { listCandidateConversations: fixtureList }),
    });
    const server = createServer(adapters);
    openServers.add(server);

    await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=bee",
      headers: authorization(),
    });
    await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });

    expect(liveList).toHaveBeenCalledTimes(1);
    expect(fixtureList).toHaveBeenCalledTimes(1);
  });

  it("returns a correlated full conversation envelope", async () => {
    const source = fixtureSource("fixture", { id: "fixture-selected" });
    const getConversation = vi.fn(async () => source);
    const server = createServer(registry({
      fixture: adapter("fixture", { getConversation }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations/fixture-selected?sourceKind=fixture",
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(getBeeConversationResponseSchema.parse(response.json())).toEqual({ conversation: source });
    expect(getConversation).toHaveBeenCalledWith("fixture-selected");
  });

  it("returns recent changes from the selected adapter", async () => {
    const changes = vi.fn(async () => ({
      items: [],
      nextCursor: null,
    }));
    const server = createServer(registry({
      bee: adapter("bee", { getRecentChanges: changes }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/changes?sourceKind=bee&cursor=opaque&limit=7",
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(recentBeeChangesResponseSchema.parse(response.json())).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(changes).toHaveBeenCalledWith({
      sourceKind: "bee",
      cursor: "opaque",
      limit: 7,
    });
  });

  it.each([
    "/v1/conversations",
    "/v1/conversations?sourceKind=unknown",
    "/v1/conversations?sourceKind=fixture&unknown=value",
    "/v1/conversations?sourceKind=fixture&limit=0",
    "/v1/conversations?sourceKind=fixture&limit=101",
    "/v1/conversations?sourceKind=fixture&limit=1.5",
    "/v1/conversations?sourceKind=fixture&cursor=",
    "/v1/conversations?sourceKind=fixture&query=one&query=two",
    "/v1/changes?sourceKind=fixture&query=not-allowed",
    "/v1/conversations/fixture-selected?sourceKind=fixture&beeSourceId=other",
  ])("rejects an invalid flattened request: %s", async (url) => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method: "GET",
      url,
      headers: authorization(),
    });
    expectCanonicalError(response, 422, "VALIDATION_ERROR");
  });

  it("rejects a body on a GET route", async () => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: { ...authorization(), "content-type": "application/json" },
      payload: { sourceKind: "bee" },
    });
    expectCanonicalError(response, 422, "VALIDATION_ERROR");
  });

  it.each([
    { label: "malformed URL encoding", url: "/v1/conversations/%ZZ?sourceKind=fixture" },
    {
      label: "an overlong path parameter",
      url: `/v1/conversations/${"a".repeat(1_025)}?sourceKind=fixture`,
    },
  ])("sanitizes router-level validation for $label", async ({ url }) => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method: "GET",
      url,
      headers: authorization(),
    });

    expectCanonicalError(response, 422, "VALIDATION_ERROR");
    expect(response.body).not.toContain(url);
  });

  it.each([
    {
      label: "malformed URL encoding without authorization",
      url: "/v1/conversations/%ZZ?sourceKind=fixture",
      headers: undefined,
    },
    {
      label: "malformed URL encoding with the wrong token",
      url: "/v1/conversations/%ZZ?sourceKind=fixture",
      headers: authorization(WRONG_TOKEN),
    },
    {
      label: "an overlong path parameter without authorization",
      url: `/v1/conversations/${"a".repeat(1_025)}?sourceKind=fixture`,
      headers: undefined,
    },
    {
      label: "an overlong path parameter with the wrong token",
      url: `/v1/conversations/${"a".repeat(1_025)}?sourceKind=fixture`,
      headers: authorization(WRONG_TOKEN),
    },
  ])("authenticates router-level validation for $label", async ({ url, headers }) => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method: "GET",
      url,
      ...(headers === undefined ? {} : { headers }),
    });

    expectCanonicalError(response, 401, "UNAUTHENTICATED");
    expect(response.body).not.toContain(url);
    expect(response.body).not.toContain(WRONG_TOKEN);
  });
});

describe("bridge response validation and canonical errors", () => {
  it("rejects a registry adapter whose identity does not match its slot, including empty pages", async () => {
    const mismatched = adapter("bee", {
      async listCandidateConversations() {
        return { items: [], nextCursor: null };
      },
    });
    const server = createServer(registry({
      fixture: mismatched,
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });
    expectCanonicalError(response, 500, "INTERNAL_ERROR");
  });

  it("rejects a list item whose source kind does not match the request", async () => {
    const server = createServer(registry({
      fixture: adapter("fixture", {
        async listCandidateConversations() {
          const source = fixtureSource("bee");
          return {
            items: [{
              id: source.id,
              sourceKind: source.sourceKind,
              title: source.title,
              startedAt: source.startedAt,
              status: source.status,
            }],
            nextCursor: null,
          };
        },
      }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });
    expectCanonicalError(response, 500, "INTERNAL_ERROR");
  });

  it.each([
    ["wrong ID", fixtureSource("fixture", { id: "other-id" })],
    ["wrong kind", fixtureSource("bee", { id: "fixture-selected" })],
  ])("rejects detail output with %s", async (_label, source) => {
    const server = createServer(registry({
      fixture: adapter("fixture", {
        async getConversation() {
          return source;
        },
      }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations/fixture-selected?sourceKind=fixture",
      headers: authorization(),
    });
    expectCanonicalError(response, 500, "INTERNAL_ERROR");
  });

  it("rejects schema-invalid adapter output as an internal error", async () => {
    const invalidHealth = async () => ({ authenticated: "yes" }) as never;
    const server = createServer(registry({
      bee: adapter("bee", { health: invalidHealth }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: authorization(),
    });
    expectCanonicalError(response, 500, "INTERNAL_ERROR");
  });

  it.each([
    ["BEE_SOURCE_NOT_FOUND", 404],
    ["SOURCE_NOT_READY", 409],
    ["BEE_BRIDGE_UNAVAILABLE", 503],
    ["VALIDATION_ERROR", 422],
    ["INTERNAL_ERROR", 500],
  ] as const)("maps adapter %s to HTTP %i", async (code, status) => {
    const server = createServer(registry({
      fixture: adapter("fixture", {
        async listCandidateConversations() {
          throw new BeeBridgeError(code);
        },
      }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });
    expectCanonicalError(response, status, code);
  });

  it("sanitizes unexpected failures without logging or returning secrets, paths, or stacks", async () => {
    const sentinel = "sentinel-bridge-secret";
    const stderr = vi.spyOn(process.stderr, "write");
    const server = createServer(registry({
      fixture: adapter("fixture", {
        async listCandidateConversations() {
          throw new Error(`${sentinel} /Users/private/.config Error: stack detail`);
        },
      }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });

    expectCanonicalError(response, 500, "INTERNAL_ERROR");
    expect(response.body).not.toContain(sentinel);
    expect(response.body).not.toContain("/Users/private");
    expect(response.body).not.toContain("stack detail");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("does not misclassify an adapter SyntaxError as a client validation failure", async () => {
    const server = createServer(registry({
      fixture: adapter("fixture", {
        async listCandidateConversations() {
          throw new SyntaxError("upstream JSON included sentinel-private-output");
        },
      }),
    }));
    openServers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture",
      headers: authorization(),
    });

    expectCanonicalError(response, 500, "INTERNAL_ERROR");
    expect(response.body).not.toContain("sentinel-private-output");
  });

  it.each([
    ["GET", "/v1/not-a-route"],
    ["POST", "/v1/health"],
  ] as const)("returns a canonical 404 for unknown %s %s", async (method, url) => {
    const server = createServer();
    openServers.add(server);
    const response = await server.inject({
      method,
      url,
      headers: authorization(),
    });
    expectCanonicalError(response, 404, "RESOURCE_NOT_FOUND");
  });

  it("does not expose Fastify's implicit HEAD aliases", async () => {
    const health = vi.fn(async () => ({ authenticated: true as const }));
    const server = createServer(registry({ bee: adapter("bee", { health }) }));
    openServers.add(server);

    const response = await server.inject({
      method: "HEAD",
      url: "/v1/health",
      headers: authorization(),
    });

    expectCanonicalError(response, 404, "RESOURCE_NOT_FOUND");
    expect(health).not.toHaveBeenCalled();
  });

  it("does not grant browser CORS access", async () => {
    const server = createServer();
    openServers.add(server);
    const getResponse = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: { ...authorization(), origin: "https://malicious.example" },
    });
    const optionsResponse = await server.inject({
      method: "OPTIONS",
      url: "/v1/health",
      headers: {
        ...authorization(),
        origin: "https://malicious.example",
        "access-control-request-method": "GET",
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(optionsResponse.statusCode).toBe(404);
    for (const response of [getResponse, optionsResponse]) {
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(response.headers["access-control-allow-methods"]).toBeUndefined();
    }
  });
});

describe("production configuration and loopback lifecycle", () => {
  it("passes only Bee and runtime variables to the Bee CLI child process", () => {
    const parentEnvironment = {
      HOME: "/Users/demo",
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      HTTPS_PROXY: "http://127.0.0.1:8080",
      BEE_AUTH_TOKEN: "bee-owned-credential",
      BEE_CLI_PATH: "/opt/bee/bin/bee",
      FIRSTDAY_BEE_BRIDGE_TOKEN: "bridge-only-secret",
      FIRSTDAY_API_PRIVATE_KEY: "api-only-secret",
      SUPABASE_SERVICE_ROLE_KEY: "database-only-secret",
      EXPO_PUBLIC_FIRSTDAY_API_URL: "http://127.0.0.1:3000",
      AWS_SECRET_ACCESS_KEY: "unrelated-process-secret",
    };

    expect(createBeeCliChildEnvironment(parentEnvironment)).toEqual({
      HOME: "/Users/demo",
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      HTTPS_PROXY: "http://127.0.0.1:8080",
      BEE_AUTH_TOKEN: "bee-owned-credential",
    });
    expect(parentEnvironment.FIRSTDAY_BEE_BRIDGE_TOKEN).toBe("bridge-only-secret");
  });

  it("reads canonical environment names with safe defaults", () => {
    expect(readBridgeRuntimeConfig({
      FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN,
    })).toEqual({
      bearerToken: TOKEN,
      port: DEFAULT_BEE_BRIDGE_PORT,
      beeCliPath: "bee",
    });
    expect(readBridgeRuntimeConfig({
      FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN,
      FIRSTDAY_BEE_BRIDGE_PORT: "3210",
      BEE_CLI_PATH: "/opt/bee/bin/bee",
    })).toEqual({
      bearerToken: TOKEN,
      port: 3_210,
      beeCliPath: "/opt/bee/bin/bee",
    });
  });

  it("documents only the canonical server-side bridge variables", async () => {
    const example = await readFile(`${PROJECT_ROOT}/.env.example`, "utf8");
    expect(example).toContain("# The Bee bridge always binds to 127.0.0.1");
    expect(example).toContain("FIRSTDAY_BEE_BRIDGE_PORT=3100");
    expect(example).toContain("FIRSTDAY_BEE_BRIDGE_TOKEN=\n");
    expect(example).toContain("BEE_CLI_PATH=bee");
    expect(example).not.toMatch(/^BEE_BRIDGE_HOST=/mu);
    expect(example).not.toMatch(/^BEE_BRIDGE_PORT=/mu);
    expect(example).not.toMatch(/^EXPO_PUBLIC_.*(?:BEE|BRIDGE|CLI|SERVICE_ROLE)/mu);
  });

  it.each([
    {},
    { FIRSTDAY_BEE_BRIDGE_TOKEN: "too-short" },
    { FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN, FIRSTDAY_BEE_BRIDGE_PORT: "0" },
    { FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN, FIRSTDAY_BEE_BRIDGE_PORT: "-1" },
    { FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN, FIRSTDAY_BEE_BRIDGE_PORT: "65536" },
    { FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN, FIRSTDAY_BEE_BRIDGE_PORT: "3.1" },
    { FIRSTDAY_BEE_BRIDGE_TOKEN: TOKEN, BEE_CLI_PATH: "" },
  ])("rejects invalid production configuration %#", (environment) => {
    expect(() => readBridgeRuntimeConfig(environment)).toThrowError(BeeBridgeError);
  });

  it("rejects ephemeral port zero in the production server factory", async () => {
    const runner: BeeCliRunner = {
      async run() {
        return { stdout: "" };
      },
    };
    let error: unknown;
    let server: BridgeServer | undefined;
    try {
      server = await createProductionBridgeServer({
        bearerToken: TOKEN,
        port: 0,
        beeCliPath: "bee",
      }, { runner });
    } catch (caught) {
      error = caught;
    }
    if (server !== undefined) {
      await server.close();
    }
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("loads the canonical redacted bookshop fixtures", async () => {
    const sources = await loadBookshopFixtureSources();
    expect(sources.map(({ id }) => id)).toEqual([
      "fixture-bookshop-onboarding",
      "fixture-bookshop-policy-update",
    ]);
    expect(sources.every(({ sourceKind }) => sourceKind === "fixture")).toBe(true);
    expect(sources.every(({ transcript }) => transcript.length > 0)).toBe(true);
  });

  it("constructs production live and fixture adapters behind one registry", async () => {
    const calls: string[][] = [];
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        return { stdout: "" };
      },
    };
    const server = await createProductionBridgeServer({
      bearerToken: TOKEN,
      port: DEFAULT_BEE_BRIDGE_PORT,
      beeCliPath: "bee",
    }, { runner });
    openServers.add(server);

    const fixtureResponse = await server.inject({
      method: "GET",
      url: "/v1/conversations?sourceKind=fixture&limit=1",
      headers: authorization(),
    });
    const healthResponse = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: authorization(),
    });

    expect(fixtureResponse.statusCode).toBe(200);
    expect(listBeeConversationsResponseSchema.parse(fixtureResponse.json()).items).toHaveLength(1);
    expect(healthResponse.statusCode).toBe(200);
    expect(beeBridgeHealthResponseSchema.parse(healthResponse.json()).authenticated).toBe(true);
    expect(calls).toEqual([["status"]]);
  });

  it("listens on an ephemeral port at IPv4 loopback only", async () => {
    const server = createServer();
    openServers.add(server);
    const address = await listenOnLoopback(server, 0);

    expect(address.host).toBe(LOOPBACK_HOST);
    expect(address.port).toBeGreaterThan(0);
    const socketAddress = server.server.address();
    expect(socketAddress).not.toBeNull();
    expect(typeof socketAddress).not.toBe("string");
    if (socketAddress !== null && typeof socketAddress !== "string") {
      expect(socketAddress.address).toBe(LOOPBACK_HOST);
      expect(socketAddress.port).toBe(address.port);
    }

    const response = await fetch(`http://${LOOPBACK_HOST}:${address.port}/v1/health`, {
      headers: authorization(),
    });
    expect(response.status).toBe(200);
    expect(beeBridgeHealthResponseSchema.parse(await response.json())).toEqual({
      authenticated: true,
      lastSyncAt: "2026-09-10T16:00:00.000Z",
    });
  });

  it("can be imported without starting a listener or requiring configuration", async () => {
    const script = [
      "delete process.env.FIRSTDAY_BEE_BRIDGE_TOKEN;",
      'await import("./services/bee-bridge/src/index.ts");',
      'process.stdout.write("imported\\n");',
    ].join("");
    const result = await execFileAsync(
      process.execPath,
      ["--conditions=development", "--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: PROJECT_ROOT },
    );
    expect(result.stdout).toBe("imported\n");
    expect(result.stderr).toBe("");
  });

  it("reports direct-start failures using only the fixed safe message", async () => {
    let failure: Awaited<ReturnType<typeof execFileAsync>> | undefined;
    try {
      await execFileAsync(
        process.execPath,
        ["--conditions=development", "--import", "tsx", "services/bee-bridge/src/index.ts"],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            FIRSTDAY_BEE_BRIDGE_TOKEN: "secret-that-must-not-appear",
            FIRSTDAY_BEE_BRIDGE_PORT: "invalid-port",
          },
        },
      );
    } catch (error) {
      failure = error as Awaited<ReturnType<typeof execFileAsync>>;
    }
    expect(failure).toBeDefined();
    expect(failure?.stdout).toBe("");
    expect(failure?.stderr).toBe(`${BRIDGE_START_FAILURE_MESSAGE}\n`);
    expect(failure?.stderr).not.toContain("secret-that-must-not-appear");
  });

  it("keeps bridge and service-role credentials out of all mobile text artifacts", async () => {
    const forbidden = [
      "FIRSTDAY_BEE_BRIDGE_TOKEN",
      "BEE_CLI_PATH",
      "SUPABASE_SERVICE_ROLE_KEY",
      "sentinel-bridge-secret",
      TOKEN,
    ];
    const mobileRoot = `${PROJECT_ROOT}/apps/mobile`;
    const textExtensions = new Set([
      ".css", ".html", ".js", ".json", ".jsx", ".map", ".mjs", ".ts", ".tsx",
    ]);

    async function collect(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".expo") {
          continue;
        }
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          files.push(...await collect(path));
        } else if (textExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
          files.push(path);
        }
      }
      return files;
    }

    const files = await collect(mobileRoot);
    for (const path of files) {
      const content = await readFile(path, "utf8");
      for (const value of forbidden) {
        expect(content, `${value} leaked into ${path}`).not.toContain(value);
      }
    }
  });
});
