// Run with: npm test   (node:test through tsx; no device or network needed)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeLocally } from "./analyze";
import { askLocally } from "./ask";
import { cleanSnapshot, EMPTY_BEE, mergeBee, packsForCoach } from "./beeSync";
import { parseDue } from "./dates";
import { extract, matchUpdates } from "./extract";
import { SAMPLE_CONVERSATION, samplePacks } from "./samples";
import { buildChoices, compareUnderstanding, gradeWords, nextProgress, nextTraining, queueFor } from "./training";
import type { AppState, BeeSnapshot, Rule } from "./types";

const NOW = new Date(2026, 9, 2, 11, 0, 0).getTime(); // Fri Oct 2 2026, 11:00 local
const LIBRARY = `Maya: This is a fictional training conversation for the FirstDay demo.
When a visitor borrows a reading kit, record the kit number in the blue ledger.
If a visitor collects a reserved map, ask for the collection code before handing it over.
Whenever a visitor returns a torn poster, place it in the green repair tray.
If a visitor asks for an extension, maybe allow another day.`;

describe("extract: training conversation -> work rules", () => {
  it("finds every stated procedure with its exact source quote", () => {
    const { candidates } = extract(LIBRARY);
    assert.equal(candidates.length, 3);
    assert.deepEqual(candidates.map((c) => c.action), [
      "Record the kit number in the blue ledger.",
      "Ask for the collection code before handing it over.",
      "Place it in the green repair tray.",
    ]);
    for (const c of candidates) assert.ok(LIBRARY.includes(c.quote), `quote must be verbatim: ${c.quote}`);
  });

  it("turns tentative language into a question for the trainer, never a rule", () => {
    const { candidates, questions } = extract(LIBRARY);
    assert.ok(!candidates.some((c) => /extension/i.test(c.quote)));
    assert.equal(questions.length, 1);
    assert.match(questions[0]!, /maybe allow another day/);
  });

  it("phrases 'Before you…' as a scene", () => {
    const { candidates } = extract("Before you hand over a reserved book, ask for both the reservation name and the phone number.");
    assert.equal(candidates[0]!.situation, "You're about to hand over a reserved book.");
  });

  it("marks explicit updates", () => {
    const { candidates } = extract("Maya: Update: When a visitor borrows a reading kit, record the kit number in the orange ledger.");
    assert.equal(candidates[0]!.isUpdate, true);
  });
});

describe("matchUpdates: Change Drill detection", () => {
  const lib = samplePacks(NOW)[0]!;
  it("matches a changed rule to the rule it replaces", () => {
    const { candidates } = extract("Update: When a visitor borrows a reading kit, record the kit number in the orange ledger.");
    const pack = { ...lib, rules: lib.rules.map((r) => ({ ...r, situation: r.quote.split(",")[0]! })) };
    const { updates, added } = matchUpdates(pack, candidates, () => "new");
    assert.equal(added.length, 0);
    assert.equal(updates[0]!.ruleId, "lib-kit");
    assert.match(updates[0]!.newAction, /orange ledger/);
  });

  it("never overwrites an unrelated general rule", () => {
    const general: Rule = { id: "g1", situation: "During your shift.", action: "Remember to clock out on the tablet.", quote: "", keywords: [] };
    const pack = { ...lib, rules: [...lib.rules, general] };
    const { updates, added } = matchUpdates(pack, extract("Never use your phone at the desk.").candidates, () => "new");
    assert.equal(updates.length, 0);
    assert.equal(added.length, 1);
  });

  it("keeps only one update per rule", () => {
    const pack = { ...lib, rules: lib.rules.map((r) => ({ ...r, situation: r.quote.split(",")[0]! })) };
    const { candidates } = extract("When a visitor borrows a reading kit, record it in the orange ledger.\nWhen a visitor borrows a reading kit, record it in the purple ledger.");
    const { updates } = matchUpdates(pack, candidates, () => "new");
    assert.equal(updates.length, 1);
    assert.match(updates[0]!.newAction, /purple/);
  });
});

describe("practice: choices, grading, understanding", () => {
  const lib = samplePacks(NOW)[0]!;
  const kit = lib.rules[0]!;

  it("offers exactly one correct choice and two distinct wrong ones", () => {
    const choices = buildChoices(kit, lib, 0);
    assert.equal(choices.length, 3);
    assert.equal(choices.filter((c) => c.correct).length, 1);
    assert.equal(new Set(choices.map((c) => c.text)).size, 3);
  });

  it("uses the old rule as a trap answer in a Change Drill", () => {
    const changed = { ...kit, action: "Record the kit number in the orange ledger.", changedFrom: kit.action };
    assert.ok(buildChoices(changed, lib, 0).some((c) => !c.correct && c.text === kit.action));
  });

  it("accepts a paraphrase with the key words, rejects a vague answer", () => {
    assert.equal(gradeWords("I'd write the kit numbers into the blue ledger", kit).pass, true);
    assert.equal(gradeWords("I'd just hand it over", kit).pass, false);
  });

  it("rejects the old answer after a rule changes", () => {
    const changed = { ...kit, action: "Record the kit number in the orange ledger.", keywords: ["kit", "number", "orange", "ledger"], changedFrom: kit.action };
    assert.equal(gradeWords("record the kit number in the blue ledger", changed).pass, false);
    const u = compareUnderstanding("write the kit number in the blue ledger", changed);
    assert.equal(u.verdict, "different");
    assert.deepEqual(u.outdated, ["blue"]);
  });
});

describe("spaced review and next-up", () => {
  it("spaces correct answers out and brings misses back soon", () => {
    const right = nextProgress(undefined, true, NOW);
    assert.equal(right.level, 1);
    assert.equal(right.due - NOW, 86400_000);
    const miss = nextProgress(right, false, NOW);
    assert.equal(miss.level, 0);
    assert.equal(miss.due - NOW, 10 * 60_000);
  });

  it("starts with unseen rules, then offers the Change Drill once a pack is learned", () => {
    const packs = samplePacks(NOW);
    const state = { packs, progress: {}, settings: { cardsPerSession: 3 }, resume: null } as unknown as AppState;
    assert.deepEqual(nextTraining(state, NOW), { kind: "learn", packId: "sample-library", count: 3 });
    assert.deepEqual(queueFor(packs[0]!, "learn", {}, 3, NOW), ["lib-kit", "lib-map", "lib-poster"]);
    const learned = Object.fromEntries(packs[0]!.rules.map((r) => [r.id, nextProgress(undefined, true, NOW)]));
    assert.equal(nextTraining({ ...state, progress: learned }, NOW).kind, "change");
  });
});

describe("everyday capture: to-dos, memories, reminders", () => {
  const a = analyzeLocally(SAMPLE_CONVERSATION.text, NOW);

  it("finds the to-dos someone asked for or I committed to, with due times", () => {
    const texts = a.todos.map((t) => t.text);
    assert.ok(texts.includes("Restock the receipt paper by noon"));
    assert.ok(texts.includes("Email Priya the schedule tomorrow at 9am"));
    const email = a.todos.find((t) => t.text.startsWith("Email Priya"))!;
    assert.equal(new Date(email.due!).getHours(), 9);
  });

  it("writes memories from the right person's point of view", () => {
    const texts = a.memories.map((m) => m.text);
    assert.ok(texts.includes("Your shift ends at 4 on Fridays."));
    assert.ok(texts.some((t) => t.startsWith("Dana's birthday is next Thursday")));
  });

  it("treats a bare command in an everyday note as a to-do, not a work rule", () => {
    const note = analyzeLocally("Call the dentist tomorrow at 3. Also the car needs washing.", NOW);
    assert.equal(note.rules.length, 0);
    assert.ok(note.todos.some((t) => t.text.startsWith("Call the dentist") && new Date(t.due!).getHours() === 15));
  });

  it("parses everyday times", () => {
    assert.equal(new Date(parseDue("call mom tomorrow", NOW)!).getDate(), 3);
    assert.equal(new Date(parseDue("at 3", NOW)!).getHours(), 15);
    assert.equal(parseDue("in 20 minutes", NOW)! - NOW, 20 * 60_000);
    assert.equal(parseDue("nothing time-like here", NOW), undefined);
  });

  it("answers from saved memories and says where the answer came from", () => {
    const state = {
      packs: [], todos: [], conversations: [],
      memories: [{ id: "m1", text: "Your shift ends at 4 on Fridays.", suggested: false, kind: "work", at: NOW }],
    } as unknown as AppState;
    const answer = askLocally("when does my shift end?", state, NOW);
    assert.match(answer.text, /shift ends at 4/);
    assert.deepEqual(answer.sources, ["m1"]);
  });
});

describe("two-way Bee sync", () => {
  const base = (patch: Partial<AppState> = {}) =>
    ({ packs: [], progress: {}, todos: [], memories: [], conversations: [], bee: EMPTY_BEE, ...patch }) as unknown as AppState;
  const snap = (patch: Partial<BeeSnapshot>): BeeSnapshot =>
    ({ facts: null, todos: null, suggestions: null, daily: null, insights: null, complete: { facts: true, todos: true, suggestions: true }, failed: [], ...patch });

  it("brings in Bee facts as memories: unconfirmed ones wait in the sorter", () => {
    const r = mergeBee(base(), snap({ facts: [{ id: "f1", text: "You like oat milk.", confirmed: true }, { id: "f2", text: "Sam is your manager.", confirmed: false }] }), NOW);
    const byFact = new Map(r.state.memories.map((m) => [m.beeFactId, m]));
    assert.equal(byFact.get("f1")!.suggested, false);
    assert.equal(byFact.get("f2")!.suggested, true);
    assert.equal(r.added.memories, 2);
  });

  it("never duplicates, keeps the user's own edit, and follows deletes made in Bee", () => {
    const once = mergeBee(base(), snap({ facts: [{ id: "f1", text: "Old text", confirmed: true }, { id: "f2", text: "Gone soon", confirmed: true }] }), NOW).state;
    const edited = { ...once, memories: once.memories.map((m) => (m.beeFactId === "f1" ? { ...m, previousText: m.text, text: "My fix" } : m)) };
    const twice = mergeBee(edited, snap({ facts: [{ id: "f1", text: "Old text", confirmed: true }] }), NOW + 10, NOW + 5).state;
    assert.equal(twice.memories.length, 1);
    assert.equal(twice.memories[0]!.text, "My fix");
  });

  it("doesn't bring back a memory the user forgot only on the phone", () => {
    const hidden = base({ bee: { ...EMPTY_BEE, hidden: ["fact:f1"] } });
    assert.equal(mergeBee(hidden, snap({ facts: [{ id: "f1", text: "x", confirmed: true }] }), NOW).state.memories.length, 0);
  });

  it("mirrors Bee to-dos and completes them when Bee does", () => {
    const later = NOW + 3 * 3600_000;
    const first = mergeBee(base(), snap({ todos: [{ id: "t1", text: "Buy stamps", completed: false, alarmAt: later }] }), NOW).state;
    const t = first.todos[0]!;
    assert.equal(t.beeTodoId, "t1");
    assert.equal(t.due, later);
    assert.equal(t.bucket, "now");
    const done = mergeBee(first, snap({ todos: [{ id: "t1", text: "Buy stamps", completed: true }] }), NOW).state;
    assert.equal(done.todos[0]!.bucket, "done");
  });

  it("shows Bee's suggestions to sort, and drops them once handled in the Bee app", () => {
    const s1 = mergeBee(base(), snap({ suggestions: [{ id: "s1", text: "Send the invoice" }] }), NOW).state;
    assert.equal(s1.todos[0]!.suggested, true);
    assert.equal(s1.todos[0]!.beeSuggestionId, "s1");
    const s2 = mergeBee(s1, snap({ suggestions: [] }), NOW + 10, NOW + 5).state;
    assert.equal(s2.todos.length, 0);
    const partial = mergeBee(s1, snap({ suggestions: [], complete: { facts: true, todos: true, suggestions: false } }), NOW + 10, NOW + 5).state;
    assert.equal(partial.todos.length, 1);
  });

  it("keeps the daily summary and insights, and reports what Bee couldn't give", () => {
    const r = mergeBee(base(), snap({ daily: { date: "2026-10-02", lines: ["Met Sam", "Shift swap"] }, insights: [{ id: "i1", text: "You talk most after lunch" }], failed: ["facts"] }), NOW);
    assert.deepEqual(r.state.bee.daily!.lines, ["Met Sam", "Shift swap"]);
    assert.deepEqual(r.state.bee.insights, ["You talk most after lunch"]);
    assert.match(r.state.bee.lastError!, /facts/);
  });

  it("never deletes on a partial or empty-looking list", () => {
    const once = mergeBee(base(), snap({ facts: [{ id: "f1", text: "Keep me", confirmed: true }] }), NOW).state;
    const partial = mergeBee(once, snap({ facts: [], complete: { facts: false, todos: false, suggestions: false } }), NOW + 10, NOW + 5).state;
    assert.equal(partial.memories.length, 1);
    const whole = mergeBee(once, snap({ facts: [] }), NOW + 10, NOW + 5).state;
    assert.equal(whole.memories.length, 0);
  });

  it("unlinks, rather than deletes, something the user wrote here when it vanishes from Bee", () => {
    const mine = base({ memories: [{ id: "m1", text: "I park on level 2.", kind: "me", suggested: false, at: NOW, beeFactId: "f9", linkedAt: NOW - 1000 }] as AppState["memories"] });
    const r = mergeBee(mine, snap({ facts: [] }), NOW + 5000, NOW).state;
    assert.equal(r.memories.length, 1);
    assert.equal(r.memories[0]!.beeFactId, undefined);
  });

  it("keeps an item linked after the sync started", () => {
    const fresh = base({ memories: [{ id: "m1", text: "x", kind: "me", suggested: false, at: NOW, beeFactId: "f9", fromBee: true, linkedAt: NOW + 10 }] as AppState["memories"] });
    assert.equal(mergeBee(fresh, snap({ facts: [] }), NOW + 20, NOW).state.memories.length, 1);
  });

  it("links a Bee item to the same text here instead of importing a duplicate", () => {
    const pushedButUnlinked = base({ todos: [{ id: "t1", text: "Buy stamps", bucket: "now", suggested: false, steps: [], createdAt: NOW }] as AppState["todos"] });
    const r = mergeBee(pushedButUnlinked, snap({ todos: [{ id: "b1", text: "buy stamps", completed: false }] }), NOW).state;
    assert.equal(r.todos.length, 1);
    assert.equal(r.todos[0]!.beeTodoId, "b1");
  });

  it("lets the user untick a Bee to-do without the next sync ticking it again", () => {
    const done = mergeBee(
      base({ todos: [{ id: "t1", text: "Buy stamps", bucket: "now", suggested: false, steps: [], createdAt: NOW, beeTodoId: "b1", beeDone: false }] as AppState["todos"] }),
      snap({ todos: [{ id: "b1", text: "Buy stamps", completed: true }] }),
      NOW,
    ).state;
    assert.equal(done.todos[0]!.bucket, "done");
    const unticked = { ...done, todos: done.todos.map((t) => ({ ...t, bucket: "now" as const })) };
    const again = mergeBee(unticked, snap({ todos: [{ id: "b1", text: "Buy stamps", completed: true }] }), NOW).state;
    assert.equal(again.todos[0]!.bucket, "now");
  });

  it("doesn't let Bee's own alarm become a second FirstDay nudge", () => {
    const r = mergeBee(base(), snap({ todos: [{ id: "b1", text: "Call back", completed: false, alarmAt: NOW + 3600_000 }] }), NOW).state;
    assert.equal(r.todos[0]!.beeAlarm, true);
  });

  it("rejects malformed brain replies instead of trusting them", () => {
    const clean = cleanSnapshot({ facts: [{ id: 5, text: "x" }, { id: "ok", text: "  kept  ", confirmed: "yes" }, null], todos: "nope", daily: { lines: "x" }, complete: { facts: "yes" } });
    assert.deepEqual(clean.facts, [{ id: "ok", text: "kept", confirmed: false }]);
    assert.equal(clean.todos, null);
    assert.equal(clean.daily, null);
    assert.equal(clean.complete.facts, false);
  });

  it("shares confirmed rules with practice levels for the coach skill", () => {
    const packs = samplePacks(NOW);
    const rule = packs[0]!.rules[0]!;
    const out = packsForCoach({ packs, progress: { [rule.id]: { level: 3, due: NOW, seen: true, tries: 2, firstTryWins: 2 } } });
    assert.equal(out[0]!.rules[0]!.level, 3);
    assert.equal(out[0]!.rules[0]!.quote, rule.quote);
  });
});
