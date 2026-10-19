#!/usr/bin/env node
// Exports Bee conversations for the eval: `npm run eval:export -- <id> [<id> …] --consent "<who agreed>"`.
// Uses the signed-in Bee CLI through the brain's Bee code. Writes eval/real/<id>.json, unlabeled.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getConversation } from "../brain/bee.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--consent");
const consent = at >= 0 ? (args[at + 1] ?? "").trim() : "";
const ids = args.filter((a, i) => !a.startsWith("--") && i !== at + 1);
if (!ids.length || !consent) {
  console.error('Usage: npm run eval:export -- <bee conversation id> [...] --consent "Rosa and I agreed to record this fictional script"');
  process.exit(1);
}
const dir = new URL("../eval/real/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const id of ids) {
  const file = new URL(`bee-${id}.json`, dir);
  if (existsSync(file)) {
    console.log(`eval/real/bee-${id}.json already exists; not overwriting your labels.`);
    continue;
  }
  const c = await getConversation(id);
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        id: `bee-${id}`,
        source: "bee",
        recordedAt: new Date(c.at).toISOString(),
        consent,
        labeled: false,
        note: "Label before you look at what FirstDay finds. rules: [{ action: [key words] }], questions: [key words of vague lines], notRules: [words that must not become rules].",
        transcript: c.text,
        rules: [],
        questions: [],
        notRules: [],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote eval/real/bee-${id}.json (${c.text.split("\n").length} lines). Label it, then set "labeled": true.`);
}
