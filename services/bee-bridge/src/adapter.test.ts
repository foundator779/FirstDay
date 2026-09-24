import {
  beeBridgeHealthResponseSchema,
  beeSourceSchema,
  listBeeConversationsResponseSchema,
  recentBeeChangesResponseSchema,
  type BeeSource,
} from "@firstday/contracts";
import { describe, expect, it } from "vitest";

import {
  BeeBridgeError,
  BeeCliRunnerError,
  createBeeCliAdapter,
  createFixtureBeeAdapter,
  createNodeBeeCliRunner,
  type BeeCliRunner,
} from "./adapter.js";

const START_MS = 1_780_000_000_000;

function fixtureSource(overrides: Partial<BeeSource> = {}): BeeSource {
  const id = overrides.id ?? "fixture-onboarding";
  const startedAt = overrides.startedAt ?? new Date(START_MS).toISOString();
  return {
    id,
    sourceKind: "fixture",
    title: "Bookshop onboarding",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 5_000).toISOString(),
    status: "processed",
    transcript: "Welcome to the shop.\nReservations last five days.",
    utterances: [
      {
        id: `${id}-1`,
        startMs: 0,
        endMs: 2_000,
        text: "Welcome to the shop.",
        speaker: { label: "trainer", name: "Maya" },
      },
      {
        id: `${id}-2`,
        startMs: 2_500,
        endMs: 5_000,
        text: "Reservations last five days.",
        speaker: { label: "trainer", name: "Maya" },
      },
    ],
    revision: `${id}-r1`,
    speakers: [{ label: "trainer", name: "Maya" }],
    ...overrides,
  };
}

type FakeResponse = string | Error | ((args: readonly string[]) => string | Promise<string>);

function fakeRunner(responses: FakeResponse[]): BeeCliRunner & { calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;

  return {
    calls,
    async run(args) {
      calls.push([...args]);
      const response = responses[index];
      index += 1;
      if (response === undefined) {
        throw new Error("unexpected command");
      }
      if (response instanceof Error) {
        throw response;
      }
      const stdout = typeof response === "function" ? await response(args) : response;
      return { stdout };
    },
  };
}

function rawList(
  conversations: unknown[],
  nextCursor: string | null = null,
): string {
  return JSON.stringify({ conversations, next_cursor: nextCursor, timezone: "UTC" });
}

function rawDetail(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    conversation: {
      id: 42,
      start_time: START_MS,
      end_time: START_MS + 9_000,
      created_at: START_MS - 1_000,
      updated_at: START_MS + 10_000,
      state: "READY",
      short_summary: "\n  Bookshop training  \nignored line",
      summary: "Fallback summary",
      url: "https://app.bee.computer/conversations/42",
      transcriptions: [
        {
          id: 100,
          realtime: true,
          utterances: [
            {
              id: 999,
              start: START_MS,
              end: START_MS + 1_000,
              text: "Realtime draft",
              speaker: "draft",
            },
          ],
        },
        {
          id: 101,
          realtime: false,
          utterances: [
            {
              id: "second",
              start: START_MS + 4_000,
              end: START_MS + 7_000,
              text: "  Keep exact spacing.  ",
              speaker: "",
            },
            {
              id: 1,
              start: START_MS + 500,
              end: START_MS + 3_000,
              text: "Reservations last five days.",
              speaker: "Maya",
            },
            {
              id: 2,
              start: START_MS + 7_100,
              end: START_MS + 7_500,
              spoken_at: START_MS + 7_100,
              text: "   ",
              speaker: "Maya",
            },
          ],
        },
      ],
      ...overrides,
    },
    timezone: "UTC",
  });
}

function rawReadyDetail(id: number, offset: number): string {
  return rawDetail({
    id,
    start_time: START_MS + offset,
    end_time: START_MS + offset + 9_000,
    updated_at: START_MS + offset + 10_000,
    short_summary: `Conversation ${id}`,
    transcriptions: [
      {
        id: id * 10,
        realtime: false,
        utterances: [
          {
            id: id * 100,
            start: START_MS + offset + 500,
            end: START_MS + offset + 2_500,
            text: `Ready transcript ${id}.`,
            speaker: "Maya",
          },
        ],
      },
    ],
  });
}

function legacyStateCursor(
  operation: "list" | "changes",
  sourceKind: "bee" | "fixture",
  query: string,
  state: unknown,
): string {
  return `fdc1.${Buffer.from(JSON.stringify({
    version: 1,
    operation,
    sourceKind,
    query,
    state,
  }), "utf8").toString("base64url")}`;
}

function tamperCursor(cursor: string): string {
  const finalCharacter = cursor.at(-1);
  return `${cursor.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;
}

async function expectBridgeCode(
  promise: Promise<unknown>,
  code: BeeBridgeError["code"],
): Promise<BeeBridgeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BeeBridgeError);
    expect(error).toMatchObject({ code });
    return error as BeeBridgeError;
  }
  throw new Error(`Expected ${code}`);
}

async function expectRunnerClassification(
  promise: Promise<unknown>,
  classification: BeeCliRunnerError["classification"],
): Promise<BeeCliRunnerError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BeeCliRunnerError);
    expect(error).toMatchObject({ classification });
    return error as BeeCliRunnerError;
  }
  throw new Error(`Expected ${classification}`);
}

describe("createFixtureBeeAdapter", () => {
  it("returns validated summary-only pages in stable order and filters case-insensitively", async () => {
    const older = fixtureSource({
      id: "fixture-cafe",
      title: "Cafe closing",
      startedAt: new Date(START_MS - 60_000).toISOString(),
      endedAt: new Date(START_MS - 55_000).toISOString(),
    });
    const newer = fixtureSource({
      id: "fixture-bookshop-update",
      title: "BOOKSHOP policy update",
      startedAt: new Date(START_MS + 60_000).toISOString(),
      endedAt: new Date(START_MS + 65_000).toISOString(),
    });
    const adapter = createFixtureBeeAdapter([older, fixtureSource(), newer]);

    const health = await adapter.health();
    const page = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      query: "  bookshop  ",
      limit: 20,
    });
    const changes = await adapter.getRecentChanges({ sourceKind: "fixture", limit: 20 });

    expect(beeBridgeHealthResponseSchema.safeParse(health).success).toBe(true);
    expect(listBeeConversationsResponseSchema.safeParse(page).success).toBe(true);
    expect(recentBeeChangesResponseSchema.safeParse(changes).success).toBe(true);
    expect(health).toEqual({
      authenticated: true,
      lastSyncAt: new Date(START_MS + 60_000).toISOString(),
    });
    expect(page.items.map(({ id }) => id)).toEqual([
      "fixture-bookshop-update",
      "fixture-onboarding",
    ]);
    expect(changes.items.map(({ id }) => id)).toEqual([
      "fixture-bookshop-update",
      "fixture-onboarding",
      "fixture-cafe",
    ]);
    expect(page.items[0]).not.toHaveProperty("transcript");
    expect(page.items[0]).not.toHaveProperty("utterances");
  });

  it("snapshots inputs, deep-clones outputs, and deterministically deduplicates IDs", async () => {
    const original = fixtureSource();
    const newerRevision = fixtureSource({
      title: "Bookshop revision two",
      revision: "fixture-onboarding-r2",
    });
    const adapter = createFixtureBeeAdapter([original, newerRevision]);

    original.title = "Mutated after construction";
    const first = await adapter.getConversation("fixture-onboarding");
    first.utterances[0]!.text = "Mutated returned value";
    const second = await adapter.getConversation("fixture-onboarding");

    expect(second.title).toBe("Bookshop revision two");
    expect(second.utterances[0]?.text).toBe("Welcome to the shop.");
    expect((await adapter.listCandidateConversations({ sourceKind: "fixture" })).items).toHaveLength(1);
  });

  it("paginates locally and binds opaque cursors to operation, source kind, and query", async () => {
    const adapter = createFixtureBeeAdapter([
      fixtureSource({ id: "fixture-1", title: "Book one", revision: "fixture-1-r1" }),
      fixtureSource({ id: "fixture-2", title: "Book two", revision: "fixture-2-r1" }),
      fixtureSource({ id: "fixture-3", title: "Book three", revision: "fixture-3-r1" }),
    ]);

    const first = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      query: "BOOK",
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^fdc2\./);

    const second = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      query: " book ",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "fixture",
        query: "different",
        cursor: first.nextCursor!,
      }),
      "VALIDATION_ERROR",
    );
    await expectBridgeCode(
      adapter.getRecentChanges({ sourceKind: "fixture", cursor: first.nextCursor! }),
      "VALIDATION_ERROR",
    );
  });

  it("retries a valid cursor without consuming or changing its continuation", async () => {
    const adapter = createFixtureBeeAdapter([
      fixtureSource({ id: "fixture-1", revision: "fixture-1-r1" }),
      fixtureSource({ id: "fixture-2", revision: "fixture-2-r1" }),
      fixtureSource({ id: "fixture-3", revision: "fixture-3-r1" }),
    ]);
    const first = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
    });

    const page = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: first.nextCursor!,
    });
    const retry = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(retry).toEqual(page);
  });

  it("rejects a cursor issued by another adapter instance", async () => {
    const sources = [
      fixtureSource({ id: "fixture-1", revision: "fixture-1-r1" }),
      fixtureSource({ id: "fixture-2", revision: "fixture-2-r1" }),
    ];
    const issuingAdapter = createFixtureBeeAdapter(sources);
    const otherAdapter = createFixtureBeeAdapter(sources);
    const first = await issuingAdapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
    });

    await expectBridgeCode(
      otherAdapter.listCandidateConversations({
        sourceKind: "fixture",
        limit: 1,
        cursor: first.nextCursor!,
      }),
      "VALIDATION_ERROR",
    );
  });

  it("evicts the oldest continuation after the process-local state-count bound", async () => {
    const sources = Array.from({ length: 130 }, (_, index) =>
      fixtureSource({
        id: `fixture-${index + 1}`,
        revision: `fixture-${index + 1}-r1`,
      }),
    );
    const adapter = createFixtureBeeAdapter(sources);
    let page = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
    });
    const oldestCursor = page.nextCursor!;

    for (let index = 0; index < 128; index += 1) {
      page = await adapter.listCandidateConversations({
        sourceKind: "fixture",
        limit: 1,
        cursor: page.nextCursor!,
      });
    }

    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "fixture",
        limit: 1,
        cursor: oldestCursor,
      }),
      "VALIDATION_ERROR",
    );
  });

  it("keeps a valid input cursor pinned while issuing its successor at capacity", async () => {
    const adapter = createFixtureBeeAdapter([
      fixtureSource({ id: "fixture-1", revision: "fixture-1-r1" }),
      fixtureSource({ id: "fixture-2", revision: "fixture-2-r1" }),
      fixtureSource({ id: "fixture-3", revision: "fixture-3-r1" }),
    ]);
    let oldestCursor = "";

    for (let index = 0; index < 128; index += 1) {
      const page = await adapter.listCandidateConversations({
        sourceKind: "fixture",
        limit: 1,
      });
      if (index === 0) {
        oldestCursor = page.nextCursor!;
      }
    }

    const page = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: oldestCursor,
    });
    const retry = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: oldestCursor,
    });
    expect(retry).toEqual(page);
    expect(page.nextCursor).not.toBeNull();
    const successor = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(successor.items).toHaveLength(1);
  });

  it("keeps every cached replay successor usable across alternate limits at capacity", async () => {
    const adapter = createFixtureBeeAdapter([
      fixtureSource({ id: "fixture-1", revision: "fixture-1-r1" }),
      fixtureSource({ id: "fixture-2", revision: "fixture-2-r1" }),
      fixtureSource({ id: "fixture-3", revision: "fixture-3-r1" }),
      fixtureSource({ id: "fixture-4", revision: "fixture-4-r1" }),
    ]);
    const initial = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
    });
    const oneItemReplay = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: initial.nextCursor!,
    });

    for (let index = 0; index < 126; index += 1) {
      await adapter.listCandidateConversations({
        sourceKind: "fixture",
        limit: 1,
      });
    }
    await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 2,
      cursor: initial.nextCursor!,
    });

    const retry = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: initial.nextCursor!,
    });
    expect(retry).toEqual(oneItemReplay);
    expect(retry.nextCursor).not.toBeNull();
    const successor = await adapter.listCandidateConversations({
      sourceKind: "fixture",
      limit: 1,
      cursor: retry.nextCursor!,
    });
    expect(successor.items).toHaveLength(1);
  });

  it("rejects malformed cursors and reports a missing fixture without leaking the ID", async () => {
    const adapter = createFixtureBeeAdapter([fixtureSource()]);
    const malformed = await expectBridgeCode(
      adapter.listCandidateConversations({ sourceKind: "fixture", cursor: "not-a-cursor" }),
      "VALIDATION_ERROR",
    );
    const oversized = await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "fixture",
        cursor: `fdc2.${"a".repeat(17_000)}`,
      }),
      "VALIDATION_ERROR",
    );
    const missing = await expectBridgeCode(
      adapter.getConversation("private-conversation-name"),
      "BEE_SOURCE_NOT_FOUND",
    );

    expect(malformed.message).not.toContain("not-a-cursor");
    expect(oversized.message).not.toContain("aaaa");
    expect(missing.message).not.toContain("private-conversation-name");
  });

  it("rejects non-fixture or malformed injected sources at the canonical boundary", () => {
    expect(() =>
      createFixtureBeeAdapter([
        { ...fixtureSource(), sourceKind: "bee" } as BeeSource,
      ]),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() =>
      createFixtureBeeAdapter([
        { ...fixtureSource(), transcript: "" },
      ]),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("createBeeCliAdapter", () => {
  it("uses plain bee status and returns a canonical authenticated health result", async () => {
    const runner = fakeRunner([""]);
    const adapter = createBeeCliAdapter(runner);

    const result = await adapter.health();

    expect(result).toEqual({ authenticated: true });
    expect(beeBridgeHealthResponseSchema.safeParse(result).success).toBe(true);
    expect(runner.calls).toEqual([["status"]]);
  });

  it("returns unauthenticated health without surfacing failed command details", async () => {
    const runner = fakeRunner([
      new Error("token=bee-secret stderr=/Users/private/.bee/config"),
    ]);
    const adapter = createBeeCliAdapter(runner);

    await expect(adapter.health()).resolves.toEqual({ authenticated: false });
    expect(runner.calls).toEqual([["status"]]);
  });

  it("normalizes list IDs, epochs, titles, statuses, revisions, and nullable fields", async () => {
    const runner = fakeRunner([
      rawList([
        {
          id: 7,
          start_time: START_MS / 1_000,
          end_time: (START_MS + 5_000) / 1_000,
          updated_at: START_MS + 8_000,
          summary: "  Bookshop onboarding  ",
          state: "complete",
        },
        {
          id: "8",
          start_time: START_MS - 5_000,
          end_time: null,
          updated_at: null,
          summary: "   ",
          state: "error",
        },
      ]),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const page = await adapter.listCandidateConversations({ sourceKind: "bee", limit: 20 });

    expect(page).toEqual({
      items: [
        {
          id: "7",
          sourceKind: "bee",
          title: "Bookshop onboarding",
          startedAt: new Date(START_MS).toISOString(),
          endedAt: new Date(START_MS + 5_000).toISOString(),
          durationMs: 5_000,
          status: "processed",
          revision: `bee:7:${new Date(START_MS + 8_000).toISOString()}`,
        },
        {
          id: "8",
          sourceKind: "bee",
          title: "Bee conversation 8",
          startedAt: new Date(START_MS - 5_000).toISOString(),
          status: "failed",
        },
      ],
      nextCursor: null,
    });
    expect(listBeeConversationsResponseSchema.safeParse(page).success).toBe(true);
    expect(page.items[0]).not.toHaveProperty("transcript");
    expect(runner.calls).toEqual([
      ["conversations", "list", "--limit", "20", "--json"],
    ]);
  });

  it("walks upstream pages for a case-insensitive query and buffers overfilled results", async () => {
    const runner = fakeRunner([
      rawList(
        [
          { id: 1, start_time: START_MS, summary: "Cafe open", state: "ready" },
          { id: 2, start_time: START_MS - 1_000, summary: "Stock count", state: "ready" },
        ],
        "upstream-2",
      ),
      rawList(
        [
          { id: 3, start_time: START_MS + 3_000, summary: "Book C", state: "ready" },
          { id: 4, start_time: START_MS + 2_000, summary: "BOOK B", state: "ready" },
          { id: 5, start_time: START_MS + 1_000, summary: "Book A", state: "ready" },
        ],
        null,
      ),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const first = await adapter.listCandidateConversations({
      sourceKind: "bee",
      query: " book ",
      limit: 2,
    });
    const callsAfterFirst = runner.calls.length;
    const second = await adapter.listCandidateConversations({
      sourceKind: "bee",
      query: "BOOK",
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(first.items.map(({ id }) => id)).toEqual(["3", "4"]);
    expect(first.nextCursor).toMatch(/^fdc2\./);
    expect(second.items.map(({ id }) => id)).toEqual(["5"]);
    expect(second.nextCursor).toBeNull();
    expect(runner.calls).toHaveLength(callsAfterFirst);
    expect(runner.calls).toEqual([
      ["conversations", "list", "--limit", "2", "--json"],
      ["conversations", "list", "--limit", "2", "--cursor", "upstream-2", "--json"],
    ]);
  });

  it("walks enough upstream pages to satisfy a FirstDay limit above the CLI page size", async () => {
    const firstItems = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      start_time: START_MS - index * 1_000,
      summary: `Conversation ${index + 1}`,
      state: "ready",
    }));
    const secondItems = Array.from({ length: 5 }, (_, index) => ({
      id: index + 21,
      start_time: START_MS - (index + 20) * 1_000,
      summary: `Conversation ${index + 21}`,
      state: "ready",
    }));
    const runner = fakeRunner([
      rawList(firstItems, "next-page"),
      rawList(secondItems),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const page = await adapter.listCandidateConversations({ sourceKind: "bee", limit: 25 });

    expect(page.items).toHaveLength(25);
    expect(new Set(page.items.map(({ id }) => id)).size).toBe(25);
    expect(runner.calls).toEqual([
      ["conversations", "list", "--limit", "20", "--json"],
      ["conversations", "list", "--limit", "5", "--cursor", "next-page", "--json"],
    ]);
  });

  it("does not re-emit a conversation duplicated by a later upstream page", async () => {
    const runner = fakeRunner([
      rawList(
        [
          { id: 1, start_time: START_MS + 3_000, summary: "One", state: "ready" },
          { id: 2, start_time: START_MS + 2_000, summary: "Two", state: "ready" },
        ],
        "next-page",
      ),
      rawList([
        { id: 1, start_time: START_MS + 3_000, summary: "One", state: "ready" },
        { id: 3, start_time: START_MS + 1_000, summary: "Three", state: "ready" },
      ]),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const first = await adapter.listCandidateConversations({ sourceKind: "bee", limit: 1 });
    const second = await adapter.listCandidateConversations({
      sourceKind: "bee",
      limit: 1,
      cursor: first.nextCursor!,
    });
    const third = await adapter.listCandidateConversations({
      sourceKind: "bee",
      limit: 1,
      cursor: second.nextCursor!,
    });

    expect([
      first.items[0]?.id,
      second.items[0]?.id,
      third.items[0]?.id,
    ]).toEqual(["1", "2", "3"]);
  });

  it("rejects malformed, oversized, cross-operation, cross-query, and wrong-source cursors", async () => {
    const runner = fakeRunner([
      rawList(
        [
          { id: 1, start_time: START_MS, summary: "Book one", state: "ready" },
          { id: 2, start_time: START_MS - 1_000, summary: "Book two", state: "ready" },
        ],
      ),
    ]);
    const adapter = createBeeCliAdapter(runner);
    const page = await adapter.listCandidateConversations({
      sourceKind: "bee",
      query: "book",
      limit: 1,
    });

    await expectBridgeCode(
      adapter.listCandidateConversations({ sourceKind: "bee", cursor: "garbage" }),
      "VALIDATION_ERROR",
    );
    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "bee",
        cursor: `fdc2.${"a".repeat(17_000)}`,
      }),
      "VALIDATION_ERROR",
    );
    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "bee",
        query: "cafe",
        cursor: page.nextCursor!,
      }),
      "VALIDATION_ERROR",
    );
    await expectBridgeCode(
      adapter.getRecentChanges({ sourceKind: "bee", cursor: page.nextCursor! }),
      "VALIDATION_ERROR",
    );
    await expectBridgeCode(
      adapter.listCandidateConversations({ sourceKind: "fixture" }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects caller-invented list buffers without emitting them or running the CLI", async () => {
    const runner = fakeRunner([]);
    const adapter = createBeeCliAdapter(runner);
    const forgedCursor = legacyStateCursor("list", "bee", "", {
      started: true,
      exhausted: true,
      bufferedItems: [
        {
          id: "999",
          sourceKind: "bee",
          title: "Caller-invented conversation",
          startedAt: new Date(START_MS).toISOString(),
          status: "processed",
        },
      ],
      seenFingerprints: [],
    });

    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "bee",
        limit: 1,
        cursor: forgedCursor,
      }),
      "VALIDATION_ERROR",
    );
    expect(runner.calls).toEqual([]);
  });

  it("rejects caller-invented change IDs before any detail CLI lookup", async () => {
    const runner = fakeRunner([rawReadyDetail(999, 999_000)]);
    const adapter = createBeeCliAdapter(runner);
    const forgedCursor = legacyStateCursor("changes", "bee", "", {
      started: true,
      exhausted: true,
      bufferedIds: ["999"],
      seenFingerprints: [],
    });

    await expectBridgeCode(
      adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 1,
        cursor: forgedCursor,
      }),
      "VALIDATION_ERROR",
    );
    expect(runner.calls).toEqual([]);
  });

  it("rejects a modified authenticated cursor before running the CLI", async () => {
    const runner = fakeRunner([
      rawList(
        [
          { id: 1, start_time: START_MS, summary: "One", state: "ready" },
          { id: 2, start_time: START_MS - 1_000, summary: "Two", state: "ready" },
        ],
      ),
    ]);
    const adapter = createBeeCliAdapter(runner);
    const first = await adapter.listCandidateConversations({
      sourceKind: "bee",
      limit: 1,
    });
    const callsBeforeTamper = runner.calls.length;

    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "bee",
        limit: 1,
        cursor: tamperCursor(first.nextCursor!),
      }),
      "VALIDATION_ERROR",
    );
    expect(runner.calls).toHaveLength(callsBeforeTamper);
  });

  it("evicts old continuations at the aggregate-byte bound before the entry-count bound", async () => {
    const calls: string[][] = [];
    let batch = 0;
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        batch += 1;
        return {
          stdout: rawList(
            Array.from({ length: 100 }, (_, index) => ({
              id: `${batch}-${index}-${"x".repeat(220)}`,
              start_time: START_MS - index,
              summary: "T".repeat(250),
              state: "ready",
            })),
          ),
        };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const cursors: string[] = [];

    for (let index = 0; index < 75; index += 1) {
      const page = await adapter.listCandidateConversations({
        sourceKind: "bee",
        limit: 1,
      });
      cursors.push(page.nextCursor!);
    }

    const newest = await adapter.listCandidateConversations({
      sourceKind: "bee",
      limit: 1,
      cursor: cursors.at(-1)!,
    });
    expect(newest.items).toHaveLength(1);
    expect(calls).toHaveLength(75);
    await expectBridgeCode(
      adapter.listCandidateConversations({
        sourceKind: "bee",
        limit: 1,
        cursor: cursors[0]!,
      }),
      "VALIDATION_ERROR",
    );
  });

  it("normalizes a finalized transcript into relative exact spans and stable revision", async () => {
    const runner = fakeRunner([rawDetail()]);
    const adapter = createBeeCliAdapter(runner);

    const source = await adapter.getConversation("42");

    expect(source).toEqual({
      id: "42",
      sourceKind: "bee",
      title: "Bookshop training",
      startedAt: new Date(START_MS).toISOString(),
      endedAt: new Date(START_MS + 9_000).toISOString(),
      status: "processed",
      transcript: "Reservations last five days.\n  Keep exact spacing.  ",
      utterances: [
        {
          id: "1",
          startMs: 500,
          endMs: 3_000,
          text: "Reservations last five days.",
          speaker: { label: "Maya" },
        },
        {
          id: "second",
          startMs: 4_000,
          endMs: 7_000,
          text: "  Keep exact spacing.  ",
          speaker: { label: "unknown" },
        },
      ],
      sourceUrl: "https://app.bee.computer/conversations/42",
      revision: `bee:42:${new Date(START_MS + 10_000).toISOString()}`,
      speakers: [{ label: "Maya" }, { label: "unknown" }],
    });
    expect(beeSourceSchema.safeParse(source).success).toBe(true);
    expect(runner.calls).toEqual([["conversations", "get", "42", "--json"]]);
  });

  it("rejects live detail IDs that are not positive safe-integer syntax before execution", async () => {
    const runner = fakeRunner([rawDetail()]);
    const adapter = createBeeCliAdapter(runner);

    for (const id of ["0", "-1", "1.5", "01", "abc", "9007199254740992"]) {
      await expectBridgeCode(adapter.getConversation(id), "VALIDATION_ERROR");
    }
    expect(runner.calls).toEqual([]);
  });

  it.each([
    ["processing source", { state: "processing" }],
    ["missing revision", { updated_at: null }],
    ["missing exact start", {
      transcriptions: [
        {
          id: 1,
          realtime: false,
          utterances: [
            {
              id: 1,
              start: null,
              end: START_MS + 1_000,
              spoken_at: START_MS,
              text: "Spoken-at is not an evidence span.",
              speaker: "Maya",
            },
          ],
        },
      ],
    }],
    ["inverted exact range", {
      transcriptions: [
        {
          id: 1,
          realtime: false,
          utterances: [
            {
              id: 1,
              start: START_MS + 2_000,
              end: START_MS + 1_000,
              text: "Invalid range.",
              speaker: "Maya",
            },
          ],
        },
      ],
    }],
  ])("fails %s safely with SOURCE_NOT_READY", async (_name, overrides) => {
    const runner = fakeRunner([rawDetail(overrides)]);
    const adapter = createBeeCliAdapter(runner);

    await expectBridgeCode(adapter.getConversation("42"), "SOURCE_NOT_READY");
  });

  it("omits non-HTTP URLs and maps unknown processing states", async () => {
    const runner = fakeRunner([
      rawList([
        {
          id: 9,
          start_time: START_MS,
          summary: "Waiting",
          state: "mystery",
        },
      ]),
      rawDetail({ url: "file:///Users/private/transcript.txt" }),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const page = await adapter.listCandidateConversations({ sourceKind: "bee" });
    const source = await adapter.getConversation("42");

    expect(page.items[0]?.status).toBe("processing");
    expect(source).not.toHaveProperty("sourceUrl");
  });

  it("maps invalid JSON and failed commands to sanitized canonical errors", async () => {
    const secret = "bee-token-super-secret";
    const runner = fakeRunner([
      "not json /Users/private/.bee/config",
      new Error(`${secret} stderr raw-response`),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const invalid = await expectBridgeCode(
      adapter.listCandidateConversations({ sourceKind: "bee" }),
      "BEE_BRIDGE_UNAVAILABLE",
    );
    const failure = await expectBridgeCode(
      adapter.getConversation("42"),
      "BEE_BRIDGE_UNAVAILABLE",
    );

    for (const error of [invalid, failure]) {
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain("/Users/private");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("maps a typed missing-detail runner failure separately from offline or auth failures", async () => {
    const missingAdapter = createBeeCliAdapter(
      fakeRunner([new BeeCliRunnerError("notFound")]),
    );
    const offlineAdapter = createBeeCliAdapter(
      fakeRunner([new BeeCliRunnerError("unavailable")]),
    );

    const missing = await expectBridgeCode(
      missingAdapter.getConversation("42"),
      "BEE_SOURCE_NOT_FOUND",
    );
    const offline = await expectBridgeCode(
      offlineAdapter.getConversation("42"),
      "BEE_BRIDGE_UNAVAILABLE",
    );

    expect(missing.message).not.toContain("42");
    expect(offline.message).not.toContain("auth");
  });

  it("paginates heterogeneous recent changes by conversation ID and fetches current details", async () => {
    const firstChangedPage = JSON.stringify({
      meta: { next_cursor: "changed-next" },
      facts: [{ id: 999, text: "private fact" }],
      todos: [{ id: 998, text: "private todo" }],
      conversations: [{ id: 3 }, { id: "3" }, { id: 2 }],
      journals: [{ id: "journal-private" }],
    });
    const runner = fakeRunner([
      firstChangedPage,
      rawReadyDetail(3, 3_000),
      JSON.stringify({
        meta: { next_cursor: null },
        conversations: [{ id: 4 }],
        facts: [{ id: 997 }],
      }),
      rawReadyDetail(2, 2_000),
      rawReadyDetail(4, 4_000),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const first = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });
    const second = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(first.items.map(({ id }) => id)).toEqual(["3"]);
    expect(second.items.map(({ id }) => id)).toEqual(["4", "2"]);
    expect(first.items[0]).not.toHaveProperty("transcript");
    expect(recentBeeChangesResponseSchema.safeParse(first).success).toBe(true);
    expect(recentBeeChangesResponseSchema.safeParse(second).success).toBe(true);
    expect(runner.calls).toEqual([
      ["changed", "--json"],
      ["conversations", "get", "3", "--json"],
      ["changed", "--cursor", "changed-next", "--json"],
      ["conversations", "get", "2", "--json"],
      ["conversations", "get", "4", "--json"],
    ]);
    expect(runner.calls.flat()).not.toContain("999");
    expect(runner.calls.flat()).not.toContain("998");
  });

  it("does not re-emit a changed conversation duplicated by a later change page", async () => {
    const firstChangedPage = JSON.stringify({
      meta: { next_cursor: "changes-2" },
      conversations: [{ id: 1 }, { id: 2 }],
    });
    const runner = fakeRunner([
      firstChangedPage,
      rawReadyDetail(1, 3_000),
      rawReadyDetail(2, 2_000),
      JSON.stringify({
        meta: { next_cursor: null },
        conversations: [{ id: 1 }, { id: 3 }],
      }),
      rawReadyDetail(3, 1_000),
    ]);
    const adapter = createBeeCliAdapter(runner);

    const first = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });
    const second = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 1,
      cursor: first.nextCursor!,
    });
    const third = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 1,
      cursor: second.nextCursor!,
    });

    expect([
      first.items[0]?.id,
      second.items[0]?.id,
      third.items[0]?.id,
    ]).toEqual(["1", "2", "3"]);
  });

  it("does not re-emit an upstream duplicate after more than 256 emitted IDs", async () => {
    const calls: string[][] = [];
    const firstIds = Array.from({ length: 300 }, (_, index) => index + 1);
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          if (args.includes("--cursor")) {
            return {
              stdout: JSON.stringify({
                meta: { next_cursor: null },
                conversations: [{ id: 1 }, { id: 301 }],
              }),
            };
          }
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: "after-300" },
              conversations: firstIds.map((id) => ({ id })),
            }),
          };
        }
        const id = Number(args[2]);
        return { stdout: rawReadyDetail(id, id * 1_000) };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const emitted: string[] = [];
    let cursor: string | undefined;

    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      const page = await adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      emitted.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor ?? undefined;
    }

    expect(emitted).toHaveLength(301);
    expect(new Set(emitted).size).toBe(301);
    expect(emitted.filter((id) => id === "1")).toHaveLength(1);
    expect(emitted).toContain("301");
    expect(calls.filter(([command]) => command === "changed")).toEqual([
      ["changed", "--json"],
      ["changed", "--cursor", "after-300", "--json"],
    ]);
  });

  it.each([
    ["missing revision", { updated_at: null }],
    ["incomplete transcript", { transcriptions: [] }],
  ])("rejects a changed conversation with %s as SOURCE_NOT_READY", async (_name, overrides) => {
    const runner = fakeRunner([
      JSON.stringify({
        meta: { next_cursor: null },
        conversations: [{ id: 42 }],
      }),
      rawDetail(overrides),
    ]);
    const adapter = createBeeCliAdapter(runner);

    await expectBridgeCode(
      adapter.getRecentChanges({ sourceKind: "bee", limit: 1 }),
      "SOURCE_NOT_READY",
    );
  });

  it("resumes a change page with more than 100 conversation IDs without loss or repeats", async () => {
    const calls: string[][] = [];
    const ids = Array.from({ length: 102 }, (_, index) => index + 1);
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: null },
              conversations: ids.map((id) => ({ id })),
            }),
          };
        }
        const id = Number(args[2]);
        return {
          stdout: rawReadyDetail(id, id * 1_000),
        };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const emitted: string[] = [];
    let cursor: string | undefined;

    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const page = await adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      emitted.push(page.items[0]!.id);
      expect(page.nextCursor).not.toBeNull();
      expect(page.nextCursor!.length).toBeLessThanOrEqual(16 * 1024);
      cursor = page.nextCursor!;
    }

    expect(emitted).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(calls.filter(([command]) => command === "changed")).toHaveLength(1);
  });

  it("drains the stable change buffer before reading the stored upstream cursor", async () => {
    const calls: string[][] = [];
    let currentFirstPage = [1, 2, 3];
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          const cursorIndex = args.indexOf("--cursor");
          if (cursorIndex === -1) {
            return {
              stdout: JSON.stringify({
                meta: { next_cursor: "stable-next" },
                conversations: currentFirstPage.map((id) => ({ id })),
              }),
            };
          }
          expect(args[cursorIndex + 1]).toBe("stable-next");
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: null },
              conversations: [{ id: 2 }, { id: 4 }],
            }),
          };
        }
        const id = Number(args[2]);
        return { stdout: rawReadyDetail(id, id * 1_000) };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const emitted: string[] = [];

    let page = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });
    emitted.push(page.items[0]!.id);
    currentFirstPage = [99, 1];

    for (let index = 0; index < 3; index += 1) {
      page = await adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 1,
        cursor: page.nextCursor!,
      });
      emitted.push(page.items[0]!.id);
    }

    expect(emitted).toEqual(["1", "2", "3", "4"]);
    expect(calls.filter(([command]) => command === "changed")).toEqual([
      ["changed", "--json"],
      ["changed", "--cursor", "stable-next", "--json"],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("retries a live cursor deterministically without rerunning mutable upstream work", async () => {
    const calls: string[][] = [];
    let continuationReads = 0;
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          if (!args.includes("--cursor")) {
            return {
              stdout: JSON.stringify({
                meta: { next_cursor: "mutable-next" },
                conversations: [{ id: 1 }],
              }),
            };
          }
          continuationReads += 1;
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: null },
              conversations: [{ id: continuationReads === 1 ? 2 : 3 }],
            }),
          };
        }
        const id = Number(args[2]);
        return { stdout: rawReadyDetail(id, id * 1_000) };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const first = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });
    const page = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 1,
      cursor: first.nextCursor!,
    });
    const callsBeforeRetry = calls.length;

    const retry = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(retry).toEqual(page);
    expect(calls).toHaveLength(callsBeforeRetry);
  });

  it("coalesces concurrent retries of one live cursor before mutable upstream work", async () => {
    const calls: string[][] = [];
    let continuationReads = 0;
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          if (!args.includes("--cursor")) {
            return {
              stdout: JSON.stringify({
                meta: { next_cursor: "concurrent-next" },
                conversations: [{ id: 1 }],
              }),
            };
          }
          const read = ++continuationReads;
          await Promise.resolve();
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: null },
              conversations: [{ id: read === 1 ? 2 : 3 }],
            }),
          };
        }
        const id = Number(args[2]);
        return { stdout: rawReadyDetail(id, id * 1_000) };
      },
    };
    const adapter = createBeeCliAdapter(runner);
    const first = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });

    const [left, right] = await Promise.all([
      adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 1,
        cursor: first.nextCursor!,
      }),
      adapter.getRecentChanges({
        sourceKind: "bee",
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ]);

    expect(right).toEqual(left);
    expect(continuationReads).toBe(1);
    expect(calls.filter((args) => args[0] === "changed" && args.includes("--cursor"))).toHaveLength(1);
  });

  it("keeps a large stable remainder server-side behind a short cursor", async () => {
    const ids = Array.from({ length: 3_000 }, (_, index) => index + 1);
    const calls: string[][] = [];
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "changed") {
          return {
            stdout: JSON.stringify({
              meta: { next_cursor: null },
              conversations: ids.map((id) => ({ id })),
            }),
          };
        }
        const id = Number(args[2]);
        return { stdout: rawReadyDetail(id, id * 1_000) };
      },
    };
    const adapter = createBeeCliAdapter(runner);

    const first = await adapter.getRecentChanges({ sourceKind: "bee", limit: 1 });
    const second = await adapter.getRecentChanges({
      sourceKind: "bee",
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(first.items[0]?.id).toBe("1");
    expect(second.items[0]?.id).toBe("2");
    expect(first.nextCursor).toMatch(/^fdc2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first.nextCursor!.length).toBeLessThan(256);
    expect(calls.filter(([command]) => command === "changed")).toHaveLength(1);
  });

  it("fails safely when one continuation snapshot exceeds the 64 KiB bound", async () => {
    const ids = Array.from({ length: 10_000 }, (_, index) => index + 1);
    const calls: string[][] = [];
    const runner: BeeCliRunner = {
      async run(args) {
        calls.push([...args]);
        if (args[0] !== "changed") {
          throw new Error("detail lookup must not run for an oversized continuation");
        }
        return {
          stdout: JSON.stringify({
            meta: { next_cursor: null },
            conversations: ids.map((id) => ({ id })),
          }),
        };
      },
    };
    const adapter = createBeeCliAdapter(runner);

    await expectBridgeCode(
      adapter.getRecentChanges({ sourceKind: "bee", limit: 1 }),
      "BEE_BRIDGE_UNAVAILABLE",
    );
    expect(calls).toEqual([["changed", "--json"]]);
  });
});

describe("createNodeBeeCliRunner", () => {
  it("executes an argument array without a shell and returns bounded stdout", async () => {
    const runner = createNodeBeeCliRunner({
      executable: process.execPath,
      timeoutMs: 2_000,
      maxBufferBytes: 1_024,
    });

    const result = await runner.run([
      "-e",
      "process.stdout.write(process.argv[1])",
      "literal;$HOME;$(whoami)",
    ]);

    expect(result).toEqual({ stdout: "literal;$HOME;$(whoami)" });
  });

  it("sanitizes executable, environment, stderr, and output details on failure", async () => {
    const secret = "bridge-auth-secret";
    const runner = createNodeBeeCliRunner({
      executable: process.execPath,
      env: { FIRSTDAY_TEST_SECRET: secret },
      timeoutMs: 2_000,
      maxBufferBytes: 1_024,
    });

    const error = await expectRunnerClassification(
      runner.run([
        "-e",
        "process.stderr.write(process.env.FIRSTDAY_TEST_SECRET ?? ''); process.exit(7)",
      ]),
      "unavailable",
    );

    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(process.execPath);
    expect(error).not.toHaveProperty("stdout");
    expect(error).not.toHaveProperty("stderr");
    expect(error).not.toHaveProperty("cause");
  });

  it("classifies only a bounded canonical 404 signal without retaining stderr", async () => {
    const runner = createNodeBeeCliRunner({
      executable: process.execPath,
      timeoutMs: 2_000,
      maxBufferBytes: 1_024,
    });

    const error = await expectRunnerClassification(
      runner.run([
        "-e",
        "process.stderr.write('Request failed with status 404\\nprivate-output'); process.exit(1)",
      ]),
      "notFound",
    );
    expect(String(error)).not.toContain("private-output");
    expect(error).not.toHaveProperty("stderr");
    expect(error).not.toHaveProperty("cause");
  });
});
