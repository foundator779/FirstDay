// Scores the on-phone extractor (src/logic/extract.ts) against both labeled sets:
//   corpus.json  - the development set the rule-based extractor was tuned on
//   heldout.json - written after tuning, never tuned on
// Run: npm run eval        (no network, no device)
import { readFileSync } from "node:fs";
import { extract } from "../src/logic/extract";
// @ts-ignore - plain JS module shared with the AI runner
import { report, scoreCase } from "./score.mjs";

type Case = { id: string; transcript: string; rules: unknown[]; questions: string[]; notRules: string[] };
const load = (f: string) => (JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")) as { cases: Case[] }).cases;

let devLeaks = 0;
const all: Record<string, unknown> = {};
for (const [name, file] of [["Development set", "./corpus.json"], ["Held-out set", "./heldout.json"]] as const) {
  const results = load(file).map((c) => {
    const { candidates, questions } = extract(c.transcript);
    return scoreCase(c, { rules: candidates, questions });
  });
  const { summary, text } = report(`On-phone extractor (no AI), ${name}`, results);
  console.log(`${text}\n`);
  if (file === "./corpus.json") devLeaks += summary.vagueLinesTurnedIntoRules;
  all[name] = summary;
}
if (process.argv.includes("--json")) console.log(JSON.stringify(all));
// Regression gate for CI: on the development set, no vague or chatty line may become a rule.
// (The held-out set is reported, not gated, so it stays honest.)
if (devLeaks > 0) process.exit(1);
