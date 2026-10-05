#!/usr/bin/env node
// FirstDay coach CLI, used by the FirstDay coach Agent Skill (skills/firstday-coach/SKILL.md).
// Reads the work rules you confirmed in FirstDay Go (shared by the app through the brain) and
// prints them for an AI assistant to quiz you, with the trainer's exact words. Read-only.
//
//   node brain/firstday.mjs rules     [--pack <words>] [--json]
//   node brain/firstday.mjs quiz      [--pack <words>] [--count 3] [--json]
//   node brain/firstday.mjs changed   [--json]
//   node brain/firstday.mjs find <words> [--json]
//   node brain/firstday.mjs questions [--json]
import { STATE_FILE, loadState } from "./state.mjs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const json = args.includes("--json");
const words = (t) => String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

const { packs, packsUpdatedAt } = loadState();
const pick = flag("pack");
const chosen = pick ? packs.filter((p) => words(p.title).some((w) => words(pick).includes(w))) : packs;
const rows = chosen.flatMap((p) => p.rules.map((r) => ({ pack: p.title, trainer: p.trainer, sample: p.sample, ...r })));

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
    const count = Math.max(1, Math.min(10, Number(flag("count") ?? 3) || 3));
    // Shakiest first, then shuffle within the same level so repeat quizzes vary.
    const picked = rows
      .map((r) => ({ r, k: r.level + Math.random() * 0.9 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, count)
      .map((x) => x.r);
    print(
      { instructions: "Ask one situation at a time. Wait for the answer. Compare with `answer`; quote `trainerSaid` in feedback.", questions: picked.map((r) => ({ pack: r.pack, situation: r.situation, answer: r.action, trainerSaid: r.quote, trainer: r.trainer, ...(r.changedFrom ? { oldAnswerNowWrong: r.changedFrom } : {}) })) },
      picked.map((r, i) => `Q${i + 1}. [${r.pack}] ${r.situation} What do you do?`).join("\n") +
        "\n\n--- answers (don't show until they've tried) ---\n" +
        picked.map((r, i) => `A${i + 1}. ${r.action}\n${quoteLine(r)}${r.changedFrom ? `\n   (Old way, now wrong: ${r.changedFrom})` : ""}`).join("\n"),
    );
    break;
  }
  case "changed": {
    const changed = rows.filter((r) => r.changedFrom);
    print(
      { changed: changed.map((r) => ({ pack: r.pack, situation: r.situation, before: r.changedFrom, now: r.action, trainerSaid: r.quote })) },
      changed.length ? changed.map((r) => `[${r.pack}] ${r.situation}\n   Before: ${r.changedFrom}\n   Now:    ${r.action}\n${quoteLine(r)}`).join("\n\n") : "No rules have changed.",
    );
    break;
  }
  case "find": {
    const q = words(args.slice(1).filter((a) => !a.startsWith("--")).join(" "));
    const hits = rows
      .map((r) => ({ r, score: q.filter((w) => words(`${r.situation} ${r.action} ${r.quote}`).includes(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.r);
    print({ matches: hits }, hits.length ? hits.map((r) => `[${r.pack}] ${r.situation}\n   Do: ${r.action}\n${quoteLine(r)}`).join("\n\n") : "Nothing matches. Don't guess: ask the trainer.");
    break;
  }
  case "questions": {
    const qs = chosen.flatMap((p) => p.questions.map((q) => ({ pack: p.title, trainer: p.trainer, question: q })));
    print({ questions: qs }, qs.length ? qs.map((q) => `[${q.pack}] Ask ${q.trainer}: ${q.question}`).join("\n") : "No open questions for your trainer.");
    break;
  }
  default:
    print({ commands: ["rules", "quiz", "changed", "find", "questions"] }, "Usage: node brain/firstday.mjs rules|quiz|changed|find <words>|questions [--pack <words>] [--count N] [--json]");
}
