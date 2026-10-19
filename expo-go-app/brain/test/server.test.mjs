// The brain end to end: the real server (brain/server.mjs) against a stand-in Bee CLI that logs every call.
// Checks pairing, CORS, every Bee read the app uses, every write-back (exact CLI arguments), and the coach
// skill's CLI reading what the phone shared. Linux/macOS (the stand-in is a script with a shebang).
// Run: node --test "brain/test/*.test.mjs"
import assert from "node:assert/strict";
import { after, before, test as nodeTest } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const T = mkdtempSync(join(tmpdir(), "brain-test-"));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const CODE = "482913";
const BASE = `http://127.0.0.1:${PORT}`;
const S3_SITE = "http://firstday-go-web-237320501162.s3-website-us-east-1.amazonaws.com";
const env = {
  ...process.env,
  HOME: T,
  BEE_CLI_PATH: `${T}/bee`,
  FAKE_BEE_LOG: `${T}/calls.log`,
  FAKE_BEE_APPROVALS: `${T}/approvals`,
  FIRSTDAY_GO_PORT: String(PORT),
  FIRSTDAY_GO_CODE: CODE,
  FIRSTDAY_BEE_LIVE: "0",
  FIRSTDAY_BRAIN_STATE: `${T}/state.json`,
  AWS_BEARER_TOKEN_BEDROCK: "",
  FIRSTDAY_GO_REQUIRE_ACCOUNT: "0",
};
let brain;
// The stand-in Bee CLI is a script with a shebang, which Windows can't run directly.
const test = process.platform === "win32" ? nodeTest.skip : nodeTest;

before(async () => {
  if (process.platform === "win32") return;
  mkdirSync(`${T}/.bee`, { recursive: true });
  mkdirSync(`${T}/approvals`);
  writeFileSync(`${T}/.bee/token-prod`, "token-1");
  writeFileSync(env.FAKE_BEE_LOG, "");
  copyFileSync(join(here, "../../infra/bee-lambda/test/fake-bee"), `${T}/bee`);
  chmodSync(`${T}/bee`, 0o755);
  brain = spawn(process.execPath, [join(here, "../server.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("brain didn't start")), 15_000);
    brain.stdout.on("data", (d) => String(d).includes("brain is running") && (clearTimeout(timer), resolve()));
    brain.on("exit", (c) => reject(new Error(`brain exited ${c}`)));
  });
});
after(() => brain?.kill());

const req = async (method, path, { body, code = CODE, origin } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(code ? { "x-firstday-code": code } : {}), ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const calls = () => readFileSync(env.FAKE_BEE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => (l.startsWith("[") ? JSON.parse(l) : l));
const lastCall = () => calls().at(-1);

test("health: Bee found, AI off without a key", async () => {
  const h = await req("GET", "/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.bee, true);
  assert.equal(h.body.ai, false);
});

test("only the app's own web page may call it from a browser", async () => {
  assert.equal((await req("GET", "/health", { origin: "https://evil.example" })).status, 403);
  const ok = await req("GET", "/health", { origin: S3_SITE });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), S3_SITE);
});

test("conversations: the list, and one real-shaped conversation in Bee's spoken order", async () => {
  const list = await req("GET", "/bee/conversations");
  assert.deepEqual(list.body.conversations.map((c) => [c.id, c.ready]), [["101", true], ["102", false]]);
  const c = await req("GET", "/bee/conversations/101");
  assert.equal(c.status, 200, "the wrapped { conversation } reply from the real CLI is read, not rejected");
  assert.equal(c.body.text, "Maya: Record the kit number in the blue ledger.\nMaya: Then tell Sam.");
  assert.deepEqual(lastCall(), ["conversations", "get", "101", "--json"]);
});

test("sync: facts, to-dos, suggestions, daily summary and insights in one reply", async () => {
  const s = await req("GET", "/bee/sync");
  assert.equal(s.status, 200);
  assert.equal(s.body.facts[0].text, "Your manager is Dana.");
  assert.equal(s.body.todos[0].alarmAt, Date.parse("2026-10-08T16:00:00Z"));
  assert.equal(s.body.suggestions[0].id, "s1");
  assert.deepEqual(s.body.daily.lines, ["Trained on the café register with Rosa", "Learned where cracked mugs go"]);
  assert.deepEqual(s.body.complete, { facts: true, todos: true, suggestions: true });
  assert.deepEqual(s.body.failed, []);
});

test("write-back: each fix in the app becomes exactly one Bee CLI call", async () => {
  assert.equal((await req("POST", "/bee/facts/confirm", { body: { id: "f1" } })).body.ok, true);
  assert.deepEqual(lastCall(), ["facts", "confirm", "f1", "--json"]);
  const tricky = "Dana's shift ends at 4; don't run $(whoami) `id` & stuff";
  assert.equal((await req("POST", "/bee/facts/update", { body: { id: "f1", text: tricky } })).body.ok, true);
  assert.deepEqual(lastCall(), ["facts", "update", "f1", "--text", tricky, "--json"], "user text is one argument, never parsed by a shell");
  assert.equal((await req("POST", "/bee/facts/create", { body: { text: "Rosa is my trainer." } })).body.id, "f-new");
  assert.equal((await req("POST", "/bee/todos/create", { body: { text: "Restock cups" } })).body.id, "t-new");
  assert.equal((await req("POST", "/bee/todos/complete", { body: { id: "t1" } })).body.ok, true);
  assert.equal((await req("POST", "/bee/suggestions/accept", { body: { id: "s1" } })).body.id, "t-from-s1");
  assert.equal((await req("POST", "/bee/suggestions/dismiss", { body: { id: "s2" } })).body.ok, true);
  assert.deepEqual(lastCall(), ["todos", "dismiss-suggestion", "s2", "--json"]);
  await req("POST", "/bee/facts/delete", { body: { id: "f1" } });
  assert.deepEqual(lastCall(), ["facts", "delete", "f1", "--json"]);
});

test("a bad id never reaches Bee", async () => {
  const before = calls().length;
  assert.equal((await req("POST", "/bee/facts/confirm", { body: { id: "f1; rm -rf ~" } })).status, 400);
  assert.equal((await req("POST", "/bee/facts/update", { body: { id: "f1", text: "   " } })).status, 400);
  assert.equal(calls().length, before);
});

test("the coach skill's CLI quizzes and checks answers from what the phone shared", async () => {
  const packs = [{
    id: "p1", title: "Juniper Café", trainer: "Rosa", sample: false, questions: ["Refunds on Sundays?"],
    rules: [{ id: "r1", situation: "A customer brings back a cracked mug.", action: "Check the receipt, then put it in the blue crate.", quote: "Check the receipt, then put it in the blue crate by the sink.", keywords: ["receipt", "blue", "crate"], changedFrom: "Check the receipt, then put the mug in the grey bin.", level: 1 }],
  }];
  assert.equal((await req("POST", "/sync/packs", { body: { packs } })).body.packs, 1);
  const run = (...a) => JSON.parse(execFileSync(process.execPath, [join(here, "../firstday.mjs"), ...a, "--json"], { env, encoding: "utf8" }));
  assert.equal(run("quiz", "--count", "1").questions[0].trainerSaid, "Check the receipt, then put it in the blue crate by the sink.");
  assert.equal(run("check", "--situation", "cracked mug", "--answer", "receipt then the blue crate").pass, true);
  const old = run("check", "--situation", "cracked mug", "--answer", "receipt then the grey bin");
  assert.equal(old.pass, false);
  assert.equal(old.oldWay, true);
  assert.equal(run("questions").questions[0].question, "Refunds on Sundays?");
});

test("guessing the pairing code locks that address out (runs last)", async () => {
  assert.equal((await req("GET", "/health", { code: "000000" })).status, 401);
  for (let i = 0; i < 4; i++) await req("GET", "/health", { code: "000000" });
  assert.equal((await req("GET", "/health")).status, 429, "even the right code waits after five wrong ones");
});
