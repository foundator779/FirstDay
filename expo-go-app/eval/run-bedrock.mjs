#!/usr/bin/env node
// Scores Amazon Bedrock directly with your AWS CLI credentials, using exactly the prompt, schema and
// Converse settings the app's AWS endpoint uses (brain/ai.mjs). No npm install: it calls the AWS CLI.
// Also reports token use, so you can see what one capture costs.
//
//   AWS CloudShell:  node expo-go-app/eval/run-bedrock.mjs [--model us.amazon.nova-pro-v1:0] [--region us-east-1] [--json]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiHandlers, converseRequest, toolResult } from "../brain/ai.mjs";
import { report, scoreCase } from "./score.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = arg("model") ?? "us.amazon.nova-pro-v1:0";
const region = arg("region") ?? "us-east-1";
const dir = mkdtempSync(join(tmpdir(), "firstday-eval-"));
const usage = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 };

const ai = aiHandlers(async (task, data, schema) => {
  const file = join(dir, "request.json");
  writeFileSync(file, JSON.stringify({ modelId: model, ...converseRequest(task, data, schema) }));
  const started = Date.now();
  const out = JSON.parse(
    execFileSync("aws", ["bedrock-runtime", "converse", "--region", region, "--cli-input-json", `file://${file}`, "--output", "json"], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
    }),
  );
  usage.calls += 1;
  usage.ms += Date.now() - started;
  usage.inputTokens += out.usage?.inputTokens ?? 0;
  usage.outputTokens += out.usage?.outputTokens ?? 0;
  return toolResult(out.output);
});

const all = { model, region };
for (const [name, file] of [["Development set", "./corpus.json"], ["Held-out set", "./heldout.json"]]) {
  const corpus = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const results = [];
  for (const c of corpus.cases) {
    const out = await ai.analyze({ text: c.transcript, now: "2026-10-04T09:00:00-07:00", timeZone: "America/Phoenix" });
    results.push(scoreCase(c, { rules: out.rules ?? [], questions: out.questions ?? [] }));
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  const { summary, text } = report(`Amazon Bedrock (${model}), ${name}`, results);
  console.log(`${text}\n`);
  all[name] = summary;
}

const per = (n) => (usage.calls ? Math.round(n / usage.calls) : 0);
console.log(
  `Usage: ${usage.calls} captures, about ${per(usage.inputTokens)} input + ${per(usage.outputTokens)} output tokens ` +
    `and ${(per(usage.ms) / 1000).toFixed(1)} s per capture.`,
);
all.usage = { ...usage, perCapture: { inputTokens: per(usage.inputTokens), outputTokens: per(usage.outputTokens), ms: per(usage.ms) } };
if (process.argv.includes("--json")) console.log(JSON.stringify(all));
