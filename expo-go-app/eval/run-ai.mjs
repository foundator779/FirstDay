#!/usr/bin/env node
// Scores the Amazon Bedrock extractor (POST /analyze on the AWS endpoint or the local brain)
// against eval/corpus.json. Plain Node 18+, no dependencies.
//
//   AWS endpoint:  node eval/run-ai.mjs --url https://<id>.lambda-url.us-east-1.on.aws --token <Cognito access token>
//   Local brain:   node eval/run-ai.mjs --url http://<computer-ip>:8790 --code <6-digit code>
import { readFileSync } from "node:fs";
import { report, scoreCase } from "./score.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = (arg("url") ?? "").replace(/\/+$/, "");
if (!url) {
  console.error("Usage: node eval/run-ai.mjs --url <endpoint> [--token <access token> | --code <pairing code>]");
  process.exit(2);
}
const headers = { "content-type": "application/json" };
if (arg("token")) headers.authorization = `Bearer ${arg("token")}`;
if (arg("code")) headers["x-firstday-code"] = arg("code");

const all = {};
for (const [name, file] of [["Development set", "./corpus.json"], ["Held-out set", "./heldout.json"]]) {
  const corpus = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const results = [];
  for (const c of corpus.cases) {
    const res = await fetch(`${url}/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: c.transcript, now: "2026-10-04T09:00:00-07:00", timeZone: "America/Phoenix" }),
    });
    if (!res.ok) {
      console.error(`${c.id}: HTTP ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const out = await res.json();
    results.push(scoreCase(c, { rules: out.rules ?? [], questions: out.questions ?? [] }));
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  const { summary, text } = report(`Amazon Bedrock extractor, ${name}`, results);
  console.log(`${text}\n`);
  all[name] = summary;
}
if (process.argv.includes("--json")) console.log(JSON.stringify(all));
