// My record: wins for performance reviews and promotions. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REAL_RECORDINGS } from "./replays";
import type { Pack, RuleProgress, Win } from "./types";
import { byMonth, findPraise, practiceWins, praiseWins, reviewText } from "./wins";

const NOW = Date.parse("2026-10-19T17:00:00-07:00");
const seen = (): RuleProgress => ({ level: 1, due: 0, seen: true, tries: 1, firstTryWins: 1 });
const pack = (patch: Partial<Pack> = {}): Pack => ({
  id: "p1", title: "Juniper Café", place: "", trainer: "Rosa", sample: false, createdAt: 0, source: "bee",
  rules: [
    { id: "mug", situation: "A customer brings back a cracked mug.", action: "Check the receipt, then put it in the blue crate by the sink.", quote: "", keywords: [], changedFrom: "Check the receipt first, then put the mug in the gray bin." },
    { id: "oat", situation: "Someone orders oat milk.", action: "Write OAT on the lid in capitals.", quote: "", keywords: [] },
  ],
  questions: [], pendingUpdates: [], ...patch,
});

describe("my record: praise from conversations", () => {
  it("finds praise and thanks, word for word, and nothing else", () => {
    const convo = [
      "Unknown: Hey, before you go, quick thing.",
      "Unknown: Great job handling that refund this morning. You checked the receipt and used the blue crate, exactly right.",
      "Unknown: And thanks for covering the register when Sam was late. That really helped.",
      "Unknown: Thanks. I've been practising.",
      "Unknown: It shows. Keep it up.",
    ].join("\n");
    assert.deepEqual(findPraise(convo), [
      "Great job handling that refund this morning. You checked the receipt and used the blue crate, exactly right.",
      "And thanks for covering the register when Sam was late. That really helped.",
    ]);
  });

  it("ignores instructions, requests to thank someone else, and the real training recordings", () => {
    assert.deepEqual(findPraise("Rosa: Can you thank Sam for covering?\nRosa: Please tell the team good job."), []);
    assert.deepEqual(findPraise("Rosa: When a customer brings back a cracked mug, check the receipt first."), []);
    for (const r of REAL_RECORDINGS) assert.deepEqual(findPraise(r.text), [], r.id);
  });

  it("suggests each one for you to keep, with a guess at who said it", () => {
    const w = praiseWins("Unknown: Well done on the rush today.", { id: "c1", at: NOW }, "Rosa", NOW);
    assert.equal(w.length, 1);
    assert.equal(w[0].suggested, true);
    assert.equal(w[0].who, "Rosa");
    assert.equal(w[0].quote, "Well done on the rush today.");
  });
});

describe("my record: what you learned", () => {
  it("records a training fully practised, once", () => {
    const p = pack({ rules: pack().rules.map(({ changedFrom: _c, ...r }) => r) });
    const progress = { mug: seen(), oat: seen() };
    const w = practiceWins({ packs: [p], progress, wins: [] }, "oat", true, NOW);
    assert.deepEqual(w.map((x) => x.text), ["Learned all 2 steps of Juniper Café"]);
    assert.deepEqual(practiceWins({ packs: [p], progress, wins: w }, "oat", true, NOW), []);
  });

  it("records a changed step answered the new way, and not before every step is practised", () => {
    const w = practiceWins({ packs: [pack()], progress: { mug: seen() }, wins: [] }, "mug", true, NOW);
    assert.deepEqual(w.map((x) => x.text), ["Picked up Rosa's change: Check the receipt, then put it in the blue crate by the sink"]);
    assert.deepEqual(practiceWins({ packs: [pack()], progress: { mug: seen() }, wins: [] }, "mug", false, NOW), []);
  });
});

describe("my record: for your review", () => {
  const wins: Win[] = [
    { id: "a", kind: "practice", text: "Learned all 3 steps of Juniper Café", at: Date.parse("2026-10-18T09:00:00-07:00"), suggested: false, key: "learned:p1" },
    { id: "b", kind: "praise", text: "Great job handling that refund this morning.", quote: "Great job handling that refund this morning.", who: "Rosa", at: Date.parse("2026-10-19T08:00:00-07:00"), suggested: false, source: "bee" },
    { id: "c", kind: "praise", text: "Thanks for covering.", quote: "Thanks for covering.", at: NOW, suggested: true },
    { id: "d", kind: "praise", text: "Nice work.", quote: "Nice work.", who: "Sam", at: Date.parse("2026-09-30T12:00:00-07:00"), suggested: false, source: "pasted" },
  ];
  it("groups kept wins by month, newest first, leaving out ones you haven't kept", () => {
    const g = byMonth(wins);
    assert.deepEqual(g.map((x) => [x.month, x.wins.map((w) => w.id)]), [["October 2026", ["b", "a"]], ["September 2026", ["d"]]]);
  });
  it("writes a dated, quoted list to paste into a self-review", () => {
    assert.equal(
      reviewText(wins),
      [
        "My record (from FirstDay Go)", "",
        "October 2026",
        "• Oct 19: “Great job handling that refund this morning.” (Rosa), recorded by Bee",
        "• Oct 18: Learned all 3 steps of Juniper Café", "",
        "September 2026",
        "• Sep 30: “Nice work.” (Sam)",
      ].join("\n"),
    );
    assert.equal(reviewText([]), "");
  });
});
