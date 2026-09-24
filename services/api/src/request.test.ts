import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { flattenRequest } from "./request.js";

function request(input: Partial<FastifyRequest>): FastifyRequest {
  return {
    query: {},
    params: {},
    headers: {},
    method: "POST",
    ...input,
  } as unknown as FastifyRequest;
}

describe("flattenRequest", () => {
  it("preserves nested JSON body arrays and objects for canonical schema validation", () => {
    expect(
      flattenRequest(
        request({
          params: { sourceConversationId: "source-1" },
          body: {
            excludedRanges: [{ startMs: 100, endMs: 200 }],
            instructionIds: ["instruction-1", "instruction-2"],
            consent: { confirmed: true },
          },
        }),
      ),
    ).toEqual({
      sourceConversationId: "source-1",
      excludedRanges: [{ startMs: 100, endMs: 200 }],
      instructionIds: ["instruction-1", "instruction-2"],
      consent: { confirmed: true },
    });
  });

  it("continues to reject duplicate transport keys and array-valued query input", () => {
    expect(() =>
      flattenRequest(
        request({
          query: { sourceKind: ["fixture", "bee"] },
        }),
      ),
    ).toThrow();

    expect(() =>
      flattenRequest(
        request({
          query: { source: { kind: "fixture" } },
        }),
      ),
    ).toThrow();

    expect(() =>
      flattenRequest(
        request({
          params: { sourceConversationId: "source-1" },
          body: { sourceConversationId: "source-2" },
        }),
      ),
    ).toThrow();
  });
});
