import { createServer, type RequestListener, type Server } from "node:http";

import {
  getBeeConversationResponseSchema,
  listBeeConversationsResponseSchema,
} from "@firstday/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpBeeGateway } from "./bee-gateway.js";

const BRIDGE_TOKEN = "bridge-token-that-is-at-least-32-characters";
const servers: Server[] = [];

async function bridge(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("HTTP Bee gateway", () => {
  it("forwards list fields and bridge authorization through real loopback HTTP", async () => {
    let receivedUrl = "";
    let receivedAuthorization = "";
    const baseUrl = await bridge((request, response) => {
      receivedUrl = request.url ?? "";
      receivedAuthorization = request.headers.authorization ?? "";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ items: [], nextCursor: "upstream-next" }));
    });
    const gateway = createHttpBeeGateway({ baseUrl, bearerToken: BRIDGE_TOKEN });

    const result = await gateway.listConversations({
      sourceKind: "fixture",
      query: "book & shop",
      cursor: "opaque+/=",
      limit: 7,
    });

    expect(listBeeConversationsResponseSchema.parse(result)).toEqual({ items: [], nextCursor: "upstream-next" });
    expect(receivedAuthorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
    const parsed = new URL(receivedUrl, baseUrl);
    expect(parsed.pathname).toBe("/v1/conversations");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      sourceKind: "fixture",
      query: "book & shop",
      cursor: "opaque+/=",
      limit: "7",
    });
  });

  it("validates and correlates detail responses", async () => {
    const baseUrl = await bridge((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        conversation: {
          id: "fixture-source",
          sourceKind: "fixture",
          title: "Fixture",
          startedAt: "2026-09-10T00:00:00.000Z",
          status: "processed",
          transcript: "Exact text",
          utterances: [{ id: "u1", startMs: 0, endMs: 1, text: "Exact text" }],
          revision: "r1",
        },
      }));
    });
    const gateway = createHttpBeeGateway({ baseUrl, bearerToken: BRIDGE_TOKEN });

    await expect(gateway.getConversation({ beeSourceId: "fixture-source", sourceKind: "fixture" }))
      .resolves.toEqual(getBeeConversationResponseSchema.parse({
        conversation: {
          id: "fixture-source",
          sourceKind: "fixture",
          title: "Fixture",
          startedAt: "2026-09-10T00:00:00.000Z",
          status: "processed",
          transcript: "Exact text",
          utterances: [{ id: "u1", startMs: 0, endMs: 1, text: "Exact text" }],
          revision: "r1",
        },
      }));
  });

  it.each([
    [404, "BEE_SOURCE_NOT_FOUND"],
    [409, "SOURCE_NOT_READY"],
    [503, "BEE_BRIDGE_UNAVAILABLE"],
    [401, "BEE_BRIDGE_UNAVAILABLE"],
  ])("maps bridge HTTP %i without relaying its body", async (status, code) => {
    const baseUrl = await bridge((_request, response) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ secret: "raw bridge secret" }));
    });
    const gateway = createHttpBeeGateway({ baseUrl, bearerToken: BRIDGE_TOKEN });

    await expect(gateway.getConversation({ beeSourceId: "fixture-source", sourceKind: "fixture" }))
      .rejects.toMatchObject({ code });
  });

  it("rejects a non-loopback bridge URL and malformed JSON output", async () => {
    expect(() => createHttpBeeGateway({
      baseUrl: "https://bridge.example.com",
      bearerToken: BRIDGE_TOKEN,
    })).toThrow();

    const baseUrl = await bridge((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end("{not-json");
    });
    const gateway = createHttpBeeGateway({ baseUrl, bearerToken: BRIDGE_TOKEN });
    await expect(gateway.health()).rejects.toMatchObject({ code: "BEE_BRIDGE_UNAVAILABLE" });
  });
});
