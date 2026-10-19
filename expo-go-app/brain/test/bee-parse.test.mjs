// How the brain reads the Bee CLI's JSON. Shapes follow what real recordings returned
// (services/bee-bridge/src/adapter.ts and its tests, and docs/friction-log.md #1); the text is fictional.
// Run: node --test "brain/test/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isProcessed, listOf, parseConversation, parseConversationList, parseDaily, parseFacts, parseInsights, parseSuggestions, parseTodos,
  speakerName, strictPage, summaryLines, toMs, validId,
} from "../bee.mjs";

const T0 = Date.parse("2026-10-03T16:00:00Z");

/** The real reply shape of `bee conversations get <id> --json`: wrapped, realtime draft first, reported timing. */
const realGet = {
  conversation: {
    id: 42,
    start_time: T0,
    end_time: T0 + 9_000,
    created_at: T0 - 1_000,
    updated_at: T0 + 10_000,
    state: "READY",
    short_summary: "\n  Bookshop training  \nignored line",
    summary: "Fallback summary",
    transcriptions: [
      { id: 100, realtime: true, utterances: [{ id: 999, start: T0, end: T0 + 1_000, text: "Realtime draft", speaker: "draft" }] },
      {
        id: 101,
        realtime: false,
        utterances: [
          // Small relative start/end next to a wall-clock spoken_at, a tie, a zero-length line, and a blank line.
          { id: 3, start: 4.2, end: 4.2, spoken_at: T0 + 7_100, text: "  Then tell Sam.  ", speaker: { label: "speaker_1", name: "Maya" } },
          { id: 1, start: 0.5, end: 3.0, spoken_at: T0 + 500, text: "Reservations last five days.", speaker: "Maya" },
          { id: 2, start: 3.1, end: 4.0, spoken_at: T0 + 7_100, text: "Count the set-aside day as day one.", speaker: { label: "user" } },
          { id: 4, start: 4.3, end: 4.3, spoken_at: T0 + 8_000, text: "   ", speaker: "" },
        ],
      },
    ],
  },
  timezone: "UTC",
};

test("conversations get: unwraps { conversation }, skips the realtime draft, orders by spoken_at, keeps ties in Bee's order", () => {
  const c = parseConversation(realGet, "42");
  assert.equal(c.title, "Bookshop training");
  assert.equal(c.at, T0);
  assert.deepEqual(c.text.split("\n"), ["Maya: Reservations last five days.", "Maya: Then tell Sam.", "Me: Count the set-aside day as day one."]);
  assert.ok(!c.text.includes("Realtime draft"));
});

test("conversations get: a bare conversation object works too; a different id or an unfinished one is refused", () => {
  assert.equal(parseConversation(realGet.conversation, "42").title, "Bookshop training");
  assert.throws(() => parseConversation(realGet, "43"), /bee-mismatch/);
  assert.throws(() => parseConversation({ conversation: { ...realGet.conversation, state: "PROCESSING" } }, "42"), /not-ready/);
  assert.throws(() => parseConversation({ conversation: { ...realGet.conversation, transcriptions: [] } }, "42"), /not-ready/);
});

test("conversations get: never mixes clocks when only some lines have spoken_at", () => {
  const mixed = structuredClone(realGet);
  delete mixed.conversation.transcriptions[1].utterances[1].spoken_at;
  const c = parseConversation(mixed, "42");
  // Falls back to `start` for every line (all have one): 0.5 < 3.1 < 4.2.
  assert.deepEqual(c.text.split("\n").map((l) => l.split(": ")[1]), ["Reservations last five days.", "Count the set-aside day as day one.", "Then tell Sam."]);
});

test("conversations list: the real wrapper, epoch milliseconds, processing state", () => {
  const list = parseConversationList({
    conversations: [
      { id: 1, start_time: T0, short_summary: "Café open", state: "ready" },
      { id: 2, start_time: T0 / 1000, summary: "## Stock count\nmore", state: "processing" },
      { start_time: T0, summary: "no id" },
    ],
    next_cursor: null,
    timezone: "UTC",
  });
  assert.deepEqual(list.map((c) => [c.id, c.title, c.at, c.ready]), [["1", "Café open", T0, true], ["2", "Stock count", T0, false]]);
});

test("facts, to-dos, suggestions, daily summary and insights", () => {
  assert.deepEqual(parseFacts({ facts: [{ id: "f1", text: "Your manager is Dana.", confirmed: true }, { id: 2, fact: "Shift ends at four." }, { id: "x" }] }), [
    { id: "f1", text: "Your manager is Dana.", confirmed: true },
    { id: "2", text: "Shift ends at four.", confirmed: false },
  ]);
  assert.deepEqual(parseTodos({ todos: [{ id: "t1", text: "Order receipt paper", completed: false, alarm_at: "2026-10-08T16:00:00Z" }] }), [
    { id: "t1", text: "Order receipt paper", completed: false, alarmAt: Date.parse("2026-10-08T16:00:00Z") },
  ]);
  assert.deepEqual(parseSuggestions({ todo_suggestions: [{ id: "s1", todo: { text: "Restock cups" } }] }), [{ id: "s1", text: "Restock cups" }]);
  const daily = parseDaily({ daily: [{ id: "d1", date: "2026-10-06", summary: "## Your day\n- Trained on the register with Rosa\n- ok\n* Learned where cracked mugs go" }] });
  assert.deepEqual(daily.lines, ["Trained on the register with Rosa", "Learned where cracked mugs go"]);
  assert.deepEqual(parseInsights({ insights: [{ id: "i1", text: "**You learn best in short sessions.**\nmore" }] }), [{ id: "i1", text: "You learn best in short sessions." }], "markdown bold doesn't leak onto Today");
});

test("strictPage: deletions are mirrored only from a whole list, never from an empty-looking or unknown reply", () => {
  assert.equal(strictPage({ facts: [{ id: 1 }] }, ["facts"], 100).complete, true);
  assert.equal(strictPage({ facts: [{ id: 1 }], next_cursor: "abc" }, ["facts"], 100).complete, false);
  assert.equal(strictPage({ facts: new Array(100).fill({ id: 1 }) }, ["facts"], 100).complete, false, "a full page may have more");
  assert.throws(() => strictPage({ something: "else" }, ["facts"], 100), /bee-shape/);
});

test("small helpers: times, states, speakers, ids", () => {
  assert.equal(toMs(T0 / 1000), T0);
  assert.equal(toMs("2026-10-03T16:00:00Z"), T0);
  assert.equal(toMs(""), undefined);
  assert.equal(isProcessed("COMPLETED"), true);
  assert.equal(isProcessed(undefined), true);
  assert.equal(isProcessed("processing"), false);
  assert.equal(speakerName({ is_user: true }), "Me");
  assert.equal(speakerName({ label: "speaker_2" }), "speaker_2");
  assert.equal(validId("abc_123-x"), true);
  assert.equal(validId("1; rm -rf /"), false, "ids never reach the CLI unless they're plain");
  assert.deepEqual(listOf({ data: [{ id: 1 }] }, ["items"]), [{ id: 1 }]);
  assert.deepEqual(summaryLines("# Title\n- one two three\n- no"), ["one two three"]);
});
