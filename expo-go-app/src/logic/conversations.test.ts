import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationsByTraining, conversationsForPack, foundLine, stepsFrom, trainingOf } from "./conversations";
import type { AppState, Conversation, Pack } from "./types";

const convo = (id: string, at: number, text: string): Conversation => ({ id, title: id, at, source: "bee", text, summary: [], analyzedBy: "cloud" });
const rule = (id: string, quote: string) => ({ id, situation: "s", action: "a", quote, keywords: [] });

const cafe: Pack = {
  id: "p-cafe", title: "Juniper Café", place: "", trainer: "Rosa", sample: false, createdAt: 10, source: "",
  rules: [
    rule("mug", "When a customer brings back a cracked mug, check the receipt first, then put the mug in the grey bin."),
    rule("oat", "If someone orders oat milk, write OAT on the lid in capitals."),
  ],
  questions: [],
  pendingUpdates: [{ ruleId: "mug", newAction: "Blue crate.", newKeywords: [], quote: "From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink, not the grey bin." }],
};
const first = convo("c1", 100, "Speaker 1: Welcome! When a customer brings back a cracked mug, check the receipt first, then put the mug in the grey bin.\nSpeaker 1: If someone orders oat milk, write OAT on the lid in capitals.\nSpeaker 2: Got it.");
const update = convo("c2", 200, "Speaker 1: Quick update. From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink, not the grey bin.");
const askOnly = convo("c3", 150, "Speaker 1: Maybe we'll start giving refunds on Sundays too.");
const lunch = convo("c4", 300, "Speaker 1: Want to get tacos later?");

const state = {
  packs: [cafe],
  conversations: [first, update, askOnly, lunch],
  questions: [{ id: "q1", text: "Sunday refunds?", fromId: "c3", packId: "p-cafe", createdAt: 1 }, { id: "q2", text: "x", fromId: "c1", createdAt: 1 }],
  todos: [{ id: "t1", text: "Restock cups", bucket: "now", suggested: false, steps: [], fromId: "c1", createdAt: 1 }, { id: "t2", text: "maybe", bucket: "later", suggested: true, steps: [], fromId: "c1", createdAt: 1 }],
} as unknown as AppState;

test("conversations: a step points back to the conversation that holds its exact words (punctuation and speaker labels ignored)", () => {
  assert.equal(stepsFrom(first, cafe), 2);
  assert.equal(stepsFrom(update, cafe), 1, "a waiting Change Drill counts");
  assert.equal(stepsFrom(lunch, cafe), 0);
});

test("conversations: grouped by training, newest first, with everything else under Other", () => {
  const groups = conversationsByTraining(state);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.convo.id)]), [
    ["Juniper Café", ["c2", "c3", "c1"]],
    ["Other conversations", ["c4"]],
  ]);
  assert.equal(trainingOf(state, askOnly)?.id, "p-cafe", "a conversation with only a question follows that question to its training");
  const c1 = groups[0]!.rows.find((r) => r.convo.id === "c1")!;
  assert.deepEqual([c1.steps, c1.questions, c1.todos], [2, 1, 1], "suggested to-dos you haven't kept don't count");
  assert.equal(foundLine(c1), "2 steps · 1 question · 1 to-do");
  assert.equal(foundLine({ steps: 0, questions: 0, todos: 0 }), "Nothing to practise");
});

test("conversations: a training lists where it came from, oldest first; nothing is lost when a training is deleted", () => {
  assert.deepEqual(conversationsForPack(state, "p-cafe").map((r) => r.convo.id), ["c1", "c3", "c2"]);
  const without = { ...state, packs: [] } as AppState;
  const groups = conversationsByTraining(without);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.rows.length, 4, "every conversation is still listed, under Other");
});
