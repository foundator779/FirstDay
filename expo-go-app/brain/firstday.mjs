#!/usr/bin/env node
// FirstDay coach CLI, used by the FirstDay coach Agent Skill (skills/firstday-coach/SKILL.md).
// Reads the work rules you confirmed in FirstDay Go (shared by the app through the brain) and
// prints them for an AI assistant to quiz you, with the trainer's exact words. Read-only.
// The same coach logic (brain/coach.mjs) powers the coach MCP server in AWS (infra/coach-lambda).
//
//   node brain/firstday.mjs rules     [--pack <words>] [--json]
//   node brain/firstday.mjs quiz      [--pack <words>] [--count 3] [--json]
//   node brain/firstday.mjs check     --situation <words> --answer <what you'd do> [--json]
//   node brain/firstday.mjs changed   [--json]
//   node brain/firstday.mjs find <words> [--json]
//   node brain/firstday.mjs questions [--json]
import { changedRules, choosePacks, feedback, findRules, findStep, flatten, grade, pickQuiz } from "./coach.mjs";
import { STATE_FILE, loadState } from "./state.mjs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const json = args.includes("--json");

const { packs, packsUpdatedAt } = loadState();
const chosen = choosePacks(packs, flag("pack"));
const rows = flatten(chosen);

function print(data, text) {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

if (!packs.length && cmd !== "help") {
  print(
    { packs: 0, note: "No confirmed rules yet. In FirstDay Go: connect the brain (Settings > Brain) and confirm some work steps." },
    `No confirmed rules yet (looked in ${STATE_FILE}).\nIn FirstDay Go, connect the brain in Settings > Brain, then confirm some work steps.`,
  );
  process.exit(0);
}

const quoteLine = (r) => `   ${r.trainer} said: "${r.quote}"`;

switch (cmd) {
  case "rules": {
    print(
      { updatedAt: new Date(packsUpdatedAt).toISOString(), rules: rows },
      rows.map((r, i) => `${i + 1}. [${r.pack}] ${r.situation}\n   Do: ${r.action}\n${quoteLine(r)}`).join("\n\n"),
    );
    break;
  }
  case "quiz": {
    const picked = pickQuiz(rows, Number(flag("count") ?? 3));
    print(
      {
        instructions: "Ask one situation at a time. Wait for the answer. Check it with `check` (or compare with `answer`); quote `trainerSaid` in feedback.",
        questions: picked.map((r) => ({ id: r.id, pack: r.pack, situation: r.situation, answer: r.action, trainerSaid: r.quote, trainer: r.trainer, ...(r.changedFrom ? { oldAnswerNowWrong: r.changedFrom } : {}) })),
      },
      picked.map((r, i) => `Q${i + 1}. [${r.pack}] ${r.situation} What do you do?`).join("\n") +
        "\n\n--- answers (don't show until they've tried) ---\n" +
        picked.map((r, i) => `A${i + 1}. ${r.action}\n${quoteLine(r)}${r.changedFrom ? `\n   (Old way, now wrong: ${r.changedFrom})` : ""}`).join("\n"),
    );
    break;
  }
  case "check": {
    const step = findStep(rows, { id: flag("id"), situation: flag("situation") });
    const answer = flag("answer") ?? "";
    if (!step || !answer.trim()) {
      print({ error: "Give --situation (or --id) and --answer." }, "Usage: node brain/firstday.mjs check --situation <words> --answer <what you'd do>");
      break;
    }
    const result = grade(answer, step);
    print(
      { pass: result.pass, oldWay: result.oldWay, missing: result.misses, answer: step.action, trainerSaid: step.quote, trainer: step.trainer, feedback: feedback(result, step) },
      feedback(result, step),
    );
    break;
  }
  case "changed": {
    const changed = changedRules(rows);
    print(
      { changed: changed.map((r) => ({ pack: r.pack, situation: r.situation, before: r.changedFrom, now: r.action, trainerSaid: r.quote })) },
      changed.length ? changed.map((r) => `[${r.pack}] ${r.situation}\n   Before: ${r.changedFrom}\n   Now:    ${r.action}\n${quoteLine(r)}`).join("\n\n") : "No rules have changed.",
    );
    break;
  }
  case "find": {
    const hits = findRules(rows, args.slice(1).filter((a) => !a.startsWith("--")).join(" "));
    print({ matches: hits }, hits.length ? hits.map((r) => `[${r.pack}] ${r.situation}\n   Do: ${r.action}\n${quoteLine(r)}`).join("\n\n") : "Nothing matches. Don't guess: ask the trainer.");
    break;
  }
  case "questions": {
    const qs = chosen.flatMap((p) => p.questions.map((q) => ({ pack: p.title, trainer: p.trainer, question: q })));
    print({ questions: qs }, qs.length ? qs.map((q) => `[${q.pack}] Ask ${q.trainer}: ${q.question}`).join("\n") : "No open questions for your trainer.");
    break;
  }
  default:
    print(
      { commands: ["rules", "quiz", "check", "changed", "find", "questions"] },
      "Usage: node brain/firstday.mjs rules|quiz|check|changed|find <words>|questions [--pack <words>] [--count N] [--situation <words> --answer <text>] [--json]",
    );
}
