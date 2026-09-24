import {
  beeSourceSchema,
  createOpenQuestionResponseSchema,
  extractInstructionsResponseSchema,
  importConversationResponseSchema,
  updateInstructionResponseSchema,
} from "@firstday/contracts";
import { describe, expect, it, vi } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};

import {
  FirstDayClientError,
  createFirstDayApiClient,
  type FetchImplementation,
} from "./api.js";

const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const SOURCE = beeSourceSchema.parse(onboardingJson);
const EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const SOURCE_CONVERSATION = importConversationResponseSchema.parse({
  sourceConversation: {
    id: EXTRACTION.sourceConversationId,
    learnerId: "70000000-0000-4000-8000-000000000001",
    beeSourceId: SOURCE.id,
    sourceKind: SOURCE.sourceKind,
    title: SOURCE.title,
    startedAt: SOURCE.startedAt,
    endedAt: SOURCE.endedAt,
    transcriptHash: "a".repeat(64),
    sourceRevision: SOURCE.revision,
    consentStatus: "confirmed",
    consentConfirmedAt: "2026-09-10T16:00:59.000Z",
    status: "ready",
    importedAt: "2026-09-10T16:00:59.000Z",
    updatedAt: "2026-09-10T16:00:59.000Z",
  },
});

describe("FirstDay typed API client", () => {
  it("checks public health and lists authenticated Bee conversations with encoded filters", async () => {
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            service: "firstday-api",
            version: "0.2.0",
            beeBridge: "authenticated",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "bee-bookshop-onboarding",
                sourceKind: "bee",
                title: "Bookshop onboarding",
                startedAt: "2026-09-10T16:00:00.000Z",
                status: "processed",
                revision: "bee-bookshop-onboarding-r1",
              },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const client = createFirstDayApiClient({
      baseUrl: "http://127.0.0.1:3000/",
      sessionToken: "learner-session",
      fetchImplementation,
    });

    await expect(client.health()).resolves.toMatchObject({ beeBridge: "authenticated" });
    await expect(
      client.listConversations({
        sourceKind: "bee",
        query: "book & shop",
        limit: 20,
      }),
    ).resolves.toMatchObject({ items: [{ id: "bee-bookshop-onboarding" }] });

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/health");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).not.toHaveProperty("authorization");
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:3000/api/bee/conversations?sourceKind=bee&query=book+%26+shop&limit=20",
    );
    expect(fetchImplementation.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer learner-session", accept: "application/json" },
    });
  });

  it("preserves canonical API error codes and request IDs", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "BEE_BRIDGE_UNAVAILABLE",
            message: "Bee bridge is unavailable.",
            details: {},
            requestId: REQUEST_ID,
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createFirstDayApiClient({
      baseUrl: "http://127.0.0.1:3000",
      sessionToken: "learner-session",
      fetchImplementation,
    });

    await expect(client.listConversations({ sourceKind: "bee" })).rejects.toMatchObject({
      name: "FirstDayClientError",
      code: "BEE_BRIDGE_UNAVAILABLE",
      requestId: REQUEST_ID,
      status: 503,
    });
  });

  it("rejects malformed success bodies as invalid responses", async () => {
    const client = createFirstDayApiClient({
      baseUrl: "http://127.0.0.1:3000",
      sessionToken: "learner-session",
      fetchImplementation: vi.fn<FetchImplementation>(async () =>
        new Response(JSON.stringify({ items: [{ transcript: "must stay private" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    const result = client.listConversations({ sourceKind: "bee" });
    await expect(result).rejects.toBeInstanceOf(FirstDayClientError);
    await expect(result).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("uses the canonical source, import, extraction, decision, and question endpoints", async () => {
    const confirmedInstruction = updateInstructionResponseSchema.parse({
      instruction: {
        ...EXTRACTION.items[0],
        status: "confirmed",
        updatedAt: "2026-09-10T16:02:00.000Z",
      },
    });
    const openQuestion = createOpenQuestionResponseSchema.parse({
      openQuestion: {
        id: "50000000-0000-4000-8000-000000000001",
        sourceConversationId: EXTRACTION.sourceConversationId,
        sourceRevision: EXTRACTION.sourceRevision,
        instructionId: EXTRACTION.items[0]?.id,
        question: "Does this five-day hold include public holidays?",
        sourceEvidence: EXTRACTION.items[0]?.sourceEvidence,
        status: "open",
        shareConsent: false,
        createdAt: "2026-09-10T16:03:00.000Z",
        updatedAt: "2026-09-10T16:03:00.000Z",
      },
    });
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ conversation: SOURCE }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SOURCE_CONVERSATION), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(EXTRACTION), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(confirmedInstruction), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(openQuestion), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createFirstDayApiClient({
      baseUrl: "http://127.0.0.1:3000",
      sessionToken: "learner-session",
      fetchImplementation,
    });

    await client.getConversation({ beeSourceId: SOURCE.id, sourceKind: "fixture" });
    await client.importConversation({
      beeSourceId: SOURCE.id,
      sourceKind: "fixture",
      sourceRevision: SOURCE.revision,
      consent: { confirmed: true },
    });
    await client.extractInstructions({
      sourceConversationId: EXTRACTION.sourceConversationId,
      sourceRevision: SOURCE.revision,
      excludedRanges: [{ startMs: 44_100, endMs: 48_900, reason: "Closing chat" }],
    });
    await client.updateInstruction({
      instructionId: EXTRACTION.items[0]!.id,
      sourceRevision: SOURCE.revision,
      status: "confirmed",
    });
    await client.createOpenQuestion({
      sourceConversationId: EXTRACTION.sourceConversationId,
      sourceRevision: SOURCE.revision,
      instructionId: EXTRACTION.items[0]!.id,
      question: "Does this five-day hold include public holidays?",
      sourceEvidence: EXTRACTION.items[0]!.sourceEvidence,
      shareConsent: false,
    });

    expect(fetchImplementation.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [
        "http://127.0.0.1:3000/api/bee/conversations/fixture-bookshop-onboarding?sourceKind=fixture",
        "GET",
      ],
      ["http://127.0.0.1:3000/api/imports", "POST"],
      [
        `http://127.0.0.1:3000/api/source-conversations/${EXTRACTION.sourceConversationId}/extract`,
        "POST",
      ],
      [
        `http://127.0.0.1:3000/api/instructions/${EXTRACTION.items[0]!.id}`,
        "PATCH",
      ],
      ["http://127.0.0.1:3000/api/open-questions", "POST"],
    ]);
    expect(
      fetchImplementation.mock.calls.slice(1).map(([, init]) =>
        JSON.parse(String(init?.body)),
      ),
    ).toEqual([
      {
        beeSourceId: SOURCE.id,
        sourceKind: "fixture",
        sourceRevision: SOURCE.revision,
        consent: { confirmed: true },
      },
      {
        sourceRevision: SOURCE.revision,
        excludedRanges: [{ startMs: 44_100, endMs: 48_900, reason: "Closing chat" }],
      },
      {
        sourceRevision: SOURCE.revision,
        status: "confirmed",
      },
      {
        sourceConversationId: EXTRACTION.sourceConversationId,
        sourceRevision: SOURCE.revision,
        instructionId: EXTRACTION.items[0]!.id,
        question: "Does this five-day hold include public holidays?",
        sourceEvidence: EXTRACTION.items[0]!.sourceEvidence,
        shareConsent: false,
      },
    ]);
  });
});
