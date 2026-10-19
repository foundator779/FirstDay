// Team trainings, questions for the trainer, and what Today shows. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_BEE } from "./beeSync";
import { migrateQuestions, openQuestions, questionsFrom, quoteOf, withPackQuestions } from "./questions";
import { samplePacks } from "./samples";
import { applyDirect, applyTeamUpdate, cleanRemote, normalizeCode, packFromTeam, toWire, updateMessage, validCode, type RemoteTeam } from "./team";
import { keywordsFor } from "./text";
import { nextThings, readiness } from "./today";
import { compareUnderstanding, gradeWords } from "./training";
import type { AppState, Pack, RuleProgress } from "./types";

const NOW = new Date(2026, 9, 7, 9, 0, 0).getTime();
const seen = (level = 2): RuleProgress => ({ level, due: NOW + 86_400_000, seen: true, tries: 1, firstTryWins: 1 });

function state(patch: Partial<AppState> = {}): AppState {
  return {
    version: 2, packs: [], progress: {}, resume: null, today: { date: "", count: 0 }, conversations: [], todos: [], memories: [], chat: [],
    suggestedRules: [], brain: null, onboarded: true, bee: EMPTY_BEE, moods: [], reflection: null, questions: [], coach: null, teamRequests: [],
    settings: { cardsPerSession: 3, answerStyle: "choices", focusMinutes: 0, readAloud: false, bigText: false, haptics: true, nudges: true, cloudAi: true, syncToBee: true },
    ...patch,
  };
}

const remote = (rules: RemoteTeam["rules"], version = 2): RemoteTeam => ({ code: "K7P2QX", title: "Juniper Café", trainer: "Rosa", place: "Café", version, rules, questions: [] });
const MUG = { id: "r-mug", situation: "A customer brings back a cracked mug.", action: "Check the receipt, then put the mug in the grey bin.", quote: "When a customer brings back a cracked mug, check the receipt, then put the mug in the grey bin." };
const OAT = { id: "r-oat", situation: "Someone orders oat milk.", action: "Write OAT on the lid in capitals.", quote: "If someone orders oat milk, write OAT on the lid in capitals." };
const MUG_NEW = { ...MUG, action: "Check the receipt, then put it in the blue crate by the sink.", quote: "From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink." };

describe("team trainings: a trainer's change reaches trainees as a Change Drill", () => {
  const joined = packFromTeam(remote([MUG, OAT], 1), NOW);

  it("a trainee's copy keeps the trainer's exact words and the team link", () => {
    assert.equal(joined.id, "team-K7P2QX");
    assert.equal(joined.rules[0]!.quote, MUG.quote);
    assert.deepEqual(joined.team, { code: "K7P2QX", role: "trainee", version: 1, syncedAt: NOW, ruleIds: ["r-mug", "r-oat"] });
    assert.ok(joined.rules[0]!.keywords.includes("receipt"), "key words are filled in for grading");
  });

  it("a changed step you practised becomes a pending update (Change Drill)", () => {
    const r = applyTeamUpdate(joined, { "r-mug": seen() }, remote([MUG_NEW, OAT]), NOW);
    assert.equal(r.drills, 1);
    assert.equal(r.pack.rules[0]!.action, MUG.action, "the old way stays until you drill it");
    assert.deepEqual(r.pack.pendingUpdates.map((u) => [u.ruleId, u.newAction]), [["r-mug", MUG_NEW.action]]);
    assert.equal(r.pack.pendingUpdates[0]!.quote, MUG_NEW.quote);
    assert.equal(r.pack.team?.version, 2);
  });

  it("a changed step you haven't practised just changes: nothing to unlearn", () => {
    const r = applyTeamUpdate(joined, {}, remote([MUG_NEW, OAT]), NOW);
    assert.equal(r.quiet, 1);
    assert.equal(r.drills, 0);
    assert.equal(r.pack.rules[0]!.action, MUG_NEW.action);
    assert.equal(r.pack.pendingUpdates.length, 0);
  });

  it("keeps a change you confirmed yourself when the team didn't touch that step", () => {
    const own = { ...joined, pendingUpdates: [{ ruleId: "r-mug", newAction: "Put it in the blue crate.", newKeywords: ["blue", "crate"], quote: "Put it in the blue crate." }] };
    const r = applyTeamUpdate(own, { "r-mug": seen() }, remote([MUG, OAT], 2), NOW);
    assert.deepEqual(r.pack.pendingUpdates.map((u) => u.newAction), ["Put it in the blue crate."]);
    assert.equal(r.drills, 0);
  });

  it("adds new steps, drops removed ones, and forgets a change the trainer took back", () => {
    const wand = { id: "r-wand", situation: "You're about to close.", action: "Wipe the steam wand.", quote: "Before closing, wipe the steam wand." };
    const step1 = applyTeamUpdate(joined, { "r-mug": seen() }, remote([MUG_NEW, OAT]), NOW);
    const step2 = applyTeamUpdate(step1.pack, { "r-mug": seen() }, remote([MUG, wand], 3), NOW);
    assert.equal(step2.added, 1);
    assert.equal(step2.removed, 1);
    assert.deepEqual(step2.pack.rules.map((r) => r.id), ["r-mug", "r-wand"]);
    assert.equal(step2.pack.pendingUpdates.length, 0, "changed back before you drilled it: no drill");
  });

  it("steps you added to a team training yourself survive the trainer's updates", () => {
    const mineRule = { id: "rule-mine", situation: "A regular asks for the usual.", action: "Check the notes card by the till.", quote: "Check the notes card by the till.", keywords: ["notes", "card", "till"] };
    const withMine: Pack = { ...joined, rules: [...joined.rules, mineRule] };
    const r = applyTeamUpdate(withMine, {}, remote([MUG_NEW]), NOW);
    assert.deepEqual(r.pack.rules.map((x) => x.id), ["r-mug", "rule-mine"], "the trainer removed r-oat; yours stays");
    assert.equal(r.removed, 1);
    assert.deepEqual(r.pack.team?.ruleIds, ["r-mug"]);
  });

  it("the trainer's own change applies at once and is marked to send", () => {
    const mine: Pack = { ...joined, id: "p", team: { code: "K7P2QX", role: "trainer", version: 1, syncedAt: NOW } };
    const p = applyDirect(mine, [{ ruleId: "r-mug", newAction: MUG_NEW.action, newKeywords: [], quote: MUG_NEW.quote }], []);
    assert.equal(p.rules[0]!.action, MUG_NEW.action);
    assert.equal(p.rules[0]!.changedFrom, MUG.action);
    assert.equal(p.team?.dirty, true);
    const wire = toWire(p);
    assert.ok(!("changedFrom" in wire.rules[0]!), "the old action and practice data never leave the phone");
    assert.equal(wire.rules[0]!.quote, MUG_NEW.quote);
  });

  it("validates codes and replies from the service", () => {
    assert.equal(normalizeCode(" k7p-2qx "), "K7P2QX");
    assert.equal(validCode("K7P2QX"), true);
    assert.equal(validCode("K7P2Q0"), false, "no look-alike characters");
    assert.equal(cleanRemote({ code: "K7P2QX", version: 0, rules: [] }), null);
    const clean = cleanRemote({ code: "K7P2QX", version: 2, title: "  Café ", rules: [MUG, { id: "", situation: "x", action: "y" }, "junk"], questions: [1, "ok"] });
    assert.equal(clean?.rules.length, 1);
    assert.equal(clean?.title, "Café");
    assert.deepEqual(clean?.questions, ["ok"]);
  });

  it("tells the trainee what happened in plain words", () => {
    assert.equal(updateMessage("Rosa", "Juniper Café", { drills: 1, quiet: 0, added: 1, removed: 0 }), "Rosa changed 1 step you've practised, added 1 new step in Juniper Café.");
    assert.equal(updateMessage("Rosa", "Juniper Café", { drills: 0, quiet: 0, added: 0, removed: 0 }), null);
  });
});

describe("questions for the trainer", () => {
  it("vague lines become questions with the exact quote, never duplicated", () => {
    const qs = questionsFrom(["“Maybe allow another day” — what is the exact rule here?", "“Maybe allow another day” — what is the exact rule here?"], "c1", NOW);
    assert.equal(qs.length, 1);
    assert.equal(qs[0]!.quote, "Maybe allow another day");
    assert.equal(quoteOf("No quote here"), undefined);
  });

  it("moves old 'Ask your trainer' to-dos into questions once, and lists sample questions", () => {
    const packs = samplePacks(NOW);
    const s = state({
      packs,
      todos: [
        { id: "t1", text: "Ask your trainer: “Maybe we'll do refunds on Sundays” — what is the exact rule here?", bucket: "later", suggested: true, steps: [], createdAt: NOW },
        { id: "t2", text: "Restock cups", bucket: "now", suggested: false, steps: [], createdAt: NOW },
        { id: "t3", text: "Ask Mom: pick up the meds", bucket: "now", suggested: false, steps: [], createdAt: NOW },
        { id: "t4", text: "Ask your trainer: “Maybe close early” — what is the exact rule here?", bucket: "later", suggested: false, steps: [], createdAt: NOW, beeTodoId: "b9" },
      ],
    });
    const once = migrateQuestions(s, NOW);
    assert.deepEqual(once.todos.map((t) => t.id), ["t2", "t3", "t4"], "only unlinked 'Ask your trainer' to-dos move");
    assert.ok(once.questions.some((q) => q.quote === "Maybe we'll do refunds on Sundays"));
    assert.ok(once.questions.some((q) => q.packId === "sample-library"), "the sample's question is listed with its training");
    const twice = migrateQuestions(once, NOW);
    assert.equal(twice.questions.length, once.questions.length, "safe to run on every load");
    assert.equal(withPackQuestions(once.questions, packs[0]!, NOW), once.questions);
  });

  it("asked questions leave the open list", () => {
    const qs = questionsFrom(["A?", "B?"], "c", NOW);
    assert.equal(openQuestions({ questions: [{ ...qs[0]!, askedAt: NOW }, qs[1]!] }).length, 1);
  });
});

describe("Today: one job, being ready for your next shift", () => {
  const packs = samplePacks(NOW);
  const lib = packs[0]!;

  it("starts with a new Bee recording, then a change you practised, then steps to check", () => {
    const allSeen = Object.fromEntries(lib.rules.map((r) => [r.id, seen()]));
    const s = state({
      packs: [lib],
      progress: allSeen,
      suggestedRules: [{ id: "sr", fromId: "c", situation: "x", action: "y", quote: "y" }],
      bee: { ...EMPTY_BEE, inbox: [{ id: "b1", title: "Quick update from Rosa", at: NOW }] },
    });
    const kinds = nextThings(s, NOW).map((n) => n.kind);
    assert.deepEqual(kinds.slice(0, 3), ["bee", "change", "steps"]);
    const change = nextThings(s, NOW).find((n) => n.kind === "change")!;
    assert.equal(change.params?.mode, "change");
  });

  it("never puts to-dos, memories or patterns on Today", () => {
    const s = state({
      todos: [{ id: "t", text: "Email Priya", bucket: "now", suggested: false, steps: [], createdAt: NOW }],
      memories: [{ id: "m", text: "Dana is my manager", kind: "people", suggested: true, at: NOW }],
    });
    assert.deepEqual(nextThings(s, NOW), []);
  });

  it("offers practice, questions to ask, and a team update to send", () => {
    const trainerPack: Pack = { ...lib, id: "mine", team: { code: "K7P2QX", role: "trainer", version: 1, syncedAt: NOW, dirty: true, members: 3 }, pendingUpdates: [] };
    const s = state({ packs: [trainerPack], questions: questionsFrom(["Ask about Sundays?"], "c", NOW) });
    const things = nextThings(s, NOW);
    assert.deepEqual(things.map((n) => n.kind), ["practice", "questions", "team"]);
    assert.match(things[2]!.sub, /3 people will get a Change Drill/);
  });

  it("tells a trainer when someone is waiting to be let in", () => {
    const trainerPack: Pack = { ...lib, id: "mine", team: { code: "K7P2QX", role: "trainer", version: 1, syncedAt: NOW, members: 1, requests: 2 }, pendingUpdates: [] };
    const card = nextThings(state({ packs: [trainerPack], progress: Object.fromEntries(lib.rules.map((r) => [r.id, seen(4)])) }), NOW)[0]!;
    assert.equal(card.kind, "team");
    assert.match(card.title, /2 people want to join/);
    assert.equal(card.href, "/pack/mine");
  });

  it("sums up readiness across trainings", () => {
    const s = state({ packs: [lib], progress: { "lib-kit": seen(3), "lib-map": seen(1) }, questions: questionsFrom(["Q?"], "c", NOW) });
    const r = readiness(s, NOW);
    assert.equal(r.total, lib.rules.length);
    assert.equal(r.solid, 1);
    assert.equal(r.learned, 2);
    assert.equal(r.questions, 1);
  });
});

describe("grading after a change that names the old way", () => {
  // Rosa's update: "…put it in the blue crate by the sink, not the grey bin."
  const action = "Check the receipt, then put it in the blue crate by the sink, not the grey bin.";
  const rule = { id: "r", situation: "A customer brings back a cracked mug.", action, quote: action, keywords: keywordsFor(action), changedFrom: "Check the receipt first, then put the mug in the grey bin." };

  it("never takes key words from the contrast clause", () => {
    assert.deepEqual(keywordsFor(action), ["check", "receipt", "put", "blue", "crate"]);
    assert.deepEqual(keywordsFor("Use the yellow board instead of the red one."), ["use", "yellow", "board"]);
  });

  it("the old answer fails even though the new rule mentions it; the new answer passes", () => {
    assert.equal(gradeWords("I check the receipt and put it in the grey bin", rule).pass, false);
    assert.equal(gradeWords("check the receipt, then the blue crate by the sink", rule).pass, true);
    assert.deepEqual(compareUnderstanding("receipt, then the grey bin", rule).outdated, ["grey", "bin"]);
  });

  it("saying the new rule word for word, contrast and all, passes (typed or spoken without commas)", () => {
    assert.equal(gradeWords(action, rule).pass, true);
    assert.equal(gradeWords("check the receipt then put it in the blue crate by the sink not the grey bin", rule).pass, true);
    assert.equal(compareUnderstanding(action, rule).verdict, "match");
  });
});
