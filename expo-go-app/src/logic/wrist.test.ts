// On your wrist: practice reminders written into Bee. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pack, PracticeReminder, RuleProgress } from "./types";
import { reminderDone, reminderText, reminderTimes } from "./wrist";

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const rule = (id: string) => ({ id, situation: "s", action: "a", quote: "q", keywords: [] });
const pack = (patch: Partial<Pack> = {}): Pack => ({
  id: "p1", title: "Juniper Café", place: "Café", trainer: "Rosa", sample: false, createdAt: NOW, source: "", rules: [rule("r1"), rule("r2"), rule("r3")],
  questions: [], pendingUpdates: [], ...patch,
});
const done = (last: number): RuleProgress => ({ level: 1, due: last + 86_400_000, seen: true, tries: 1, firstTryWins: 1, last });
const rem = (patch: Partial<PracticeReminder> = {}): PracticeReminder => ({ kind: "practise", via: "bee", id: "b1", at: NOW + 3600_000, createdAt: NOW, ruleIds: ["r1", "r2", "r3"], ...patch });

describe("on your wrist: practice reminders in Bee", () => {
  it("says what to practise, short enough for a watch", () => {
    assert.equal(reminderText(pack(), "practise", 3), "Practise Juniper Café before your shift: 3 steps in FirstDay Go");
    assert.equal(reminderText(pack(), "change", 1), "Rosa changed 1 step in Juniper Café: do the Change Drill in FirstDay Go");
    assert.equal(reminderText(pack({ trainer: "Your trainer" }), "change", 2), "Your trainer changed 2 steps in Juniper Café: do the Change Drill in FirstDay Go");
    const long = reminderText(pack({ title: "A very long training name that goes on and on forever" }), "practise", 1);
    assert.ok(long.includes("…") && long.length < 100);
  });

  it("is done only when every step it named was practised after it was set", () => {
    const r = rem();
    assert.equal(reminderDone(pack(), {}, r), false);
    assert.equal(reminderDone(pack(), { r1: done(NOW + 1), r2: done(NOW + 2) }, r), false, "one step still to go");
    assert.equal(reminderDone(pack(), { r1: done(NOW + 1), r2: done(NOW + 2), r3: done(NOW - 1) }, r), false, "practised before the reminder doesn't count");
    assert.equal(reminderDone(pack(), { r1: done(NOW + 1), r2: done(NOW + 2), r3: done(NOW + 3) }, r), true);
    assert.equal(reminderDone(pack({ rules: [rule("r1")] }), { r1: done(NOW + 1) }, r), true, "deleted steps don't block it");
  });

  it("a change reminder waits for the Change Drill", () => {
    const r = rem({ kind: "change", ruleIds: ["r2"] });
    const waiting = pack({ pendingUpdates: [{ ruleId: "r2", newAction: "new", newKeywords: [], quote: "q" }] as Pack["pendingUpdates"] });
    assert.equal(reminderDone(waiting, { r2: done(NOW + 5) }, r), false);
    assert.equal(reminderDone(pack(), { r2: done(NOW + 5) }, r), true);
  });

  it("offers times before the next shift", () => {
    const afternoon = reminderTimes(NOW).map((t) => t.label);
    assert.deepEqual(afternoon, ["In 1 hour", "Tonight, 7 PM", "Tomorrow, 7 AM", "Tomorrow, 9 AM"]);
    const evening = reminderTimes(new Date(2026, 9, 18, 20, 0, 0).getTime()).map((t) => t.label);
    assert.ok(!evening.includes("Tonight, 7 PM"));
    for (const t of reminderTimes(NOW)) assert.ok(t.at > NOW);
  });
});
