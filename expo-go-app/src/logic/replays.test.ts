// The real Bee recordings anyone can replay. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeLocally } from "./analyze";
import { matchUpdates, ruleFromCandidate } from "./extract";
import { REAL_RECORDINGS, realRecording } from "./replays";
import type { Pack } from "./types";

const NOW = Date.parse("2026-10-18T08:00:00-07:00");
const cafe = realRecording("real-bee-2026-10-18-cafe")!;
const update = realRecording("real-bee-2026-10-18-update")!;

describe("real Bee recordings (replay)", () => {
  it("are Bee's own transcripts, from October 18, 2026", () => {
    assert.equal(new Set(REAL_RECORDINGS.map((r) => r.id)).size, REAL_RECORDINGS.length);
    for (const r of REAL_RECORDINGS) {
      assert.ok(r.text.split("\n").every((l) => l.startsWith("Unknown: ")), "Bee labels every speaker Unknown");
      assert.equal(new Date(r.recordedAt).toISOString().slice(0, 10), "2026-10-18");
    }
  });

  it("the café training gives 3 work steps, 1 question and 1 to-do, even on the phone", () => {
    const a = analyzeLocally(cafe.text, NOW);
    assert.deepEqual(a.rules.map((r) => r.action), [
      "Check the receipt first, then put the mug in the gray bin.",
      "Write OAT on the lid in capitals.",
      "Wipe the steam wand and run it for three seconds.",
    ]);
    // Every step keeps the trainer's exact words.
    for (const r of a.rules) assert.ok(cafe.text.includes(r.quote), r.quote);
    // "Maybe" never becomes a rule: it's a question for the trainer.
    assert.equal(a.questions.length, 1);
    assert.match(a.questions[0], /Maybe we'll start giving refunds on Sundays too/);
    assert.deepEqual(a.todos.map((t) => t.text), ["Restock the paper cups by noon tomorrow"]);
  });

  it("Rosa's update changes the cracked-mug step, so it becomes a Change Drill", () => {
    const first = analyzeLocally(cafe.text, NOW);
    const pack: Pack = {
      id: "p", title: "Juniper Café", place: "", trainer: "Rosa", sample: false, createdAt: NOW, source: "bee",
      rules: first.rules.map((r, i) => ruleFromCandidate({ ...r, isUpdate: false }, `r${i}`)), questions: [], pendingUpdates: [],
    };
    const later = analyzeLocally(update.text, NOW + 18 * 60_000);
    assert.equal(later.rules.length, 1);
    const { updates, added } = matchUpdates(pack, later.rules.map((r) => ({ ...r, isUpdate: false })), () => "new");
    assert.equal(added.length, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].ruleId, "r0");
    assert.match(updates[0].newAction, /blue crate by the sink/);
  });
});
