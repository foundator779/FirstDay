// Tests the FirstDay coach service (team trainings, coach keys, and the MCP server) against an in-memory store.
// Run: node --test "infra/coach-lambda/test/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoach, diffRules } from "../app.mjs";
import { memoryStore } from "../memstore.mjs";
import { LATEST, TOOLS } from "../mcp.mjs";
import { grade, keywordsFor } from "../coach.mjs";

const store = memoryStore();
const users = { "Bearer rosa": "user-rosa", "Bearer sam": "user-sam", "Bearer ali": "user-ali", "Bearer kim": "user-kim", "Bearer lee": "user-lee", "Bearer max": "user-max", "Bearer zoe": "user-zoe" };
const VOICE = "https://d1ypavau8ae868.cloudfront.net";
// Stand-in for Cognito ID tokens: "id-<user>" proves that user's verified email.
const emails = { "user-rosa": "rosa@example.com", "user-sam": "sam@example.com", "user-ali": "ali@example.com", "user-lee": "lee@example.com", "user-max": "max@example.com" };
const verifyId = async (t) => {
  const sub = /^id-(.+)$/.exec(String(t))?.[1];
  return sub && emails[sub] ? { sub, email: emails[sub] } : null;
};
const app = createCoach({ store, verify: async (h) => users[h] ?? null, verifyId, origins: [VOICE], joinsPerHour: 8 });

async function call(method, path, { auth = "Bearer rosa", body, headers = {}, query } = {}) {
  const r = await app({
    requestContext: { http: { method }, domainName: "coach.example" },
    rawPath: path,
    headers: { ...(auth ? { authorization: auth } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    ...(query ? { queryStringParameters: query } : {}),
  });
  return { status: r.statusCode, headers: r.headers, body: r.body ? JSON.parse(r.body) : null };
}

const cafe = (crackedMug = "Check the receipt, then put the mug in the grey bin.") => ({
  title: "Juniper Café",
  trainer: "Rosa",
  place: "Café",
  questions: ["“Maybe we'll start giving refunds on Sundays too” — what is the exact rule here?"],
  rules: [
    { id: "r-mug", situation: "A customer brings back a cracked mug.", action: crackedMug, quote: `When a customer brings back a cracked mug, ${crackedMug.toLowerCase()}`, keywords: ["receipt", "mug", crackedMug.includes("grey") ? "grey" : "blue", crackedMug.includes("grey") ? "bin" : "crate"] },
    { id: "r-oat", situation: "Someone orders oat milk.", action: "Write OAT on the lid in capitals.", quote: "If someone orders oat milk, write OAT on the lid in capitals.", keywords: ["oat", "lid", "capitals"] },
  ],
});

let code = "";

test("health answers without sign-in; everything else needs it", async () => {
  const h = await call("GET", "/health", { auth: "" });
  assert.equal(h.status, 200);
  assert.equal(h.body.mcp, "2025-11-25");
  assert.equal((await call("GET", "/me/teams", { auth: "Bearer nope" })).status, 401);
});

test("a trainer shares a training and gets a join code", async () => {
  const empty = await call("POST", "/teams", { body: { pack: { title: "x", rules: [] } } });
  assert.equal(empty.status, 400, "nothing to share");
  const r = await call("POST", "/teams", { body: { pack: cafe() } });
  assert.equal(r.status, 200);
  code = r.body.code;
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(r.body.version, 1);
  assert.equal(r.body.rules.length, 2);
  const mine = await call("GET", "/me/teams");
  assert.deepEqual(mine.body.teams.map((t) => [t.code, t.role, t.requests]), [[code, "trainer", 0]]);
});

const ask = (who, name) => call("POST", `/teams/${code}/join`, { auth: `Bearer ${who}`, body: { idToken: `id-user-${who}`, ...(name ? { name } : {}) } });
const decide = (id, action, auth = "Bearer rosa") => call("POST", `/teams/${code}/people/${id}/${action}`, { auth });

test("asking to join sends nothing until the trainer lets you in", async () => {
  assert.equal((await call("POST", `/teams/${code}/join`, { body: { idToken: "id-user-rosa" } })).status, 409, "the trainer can't join their own");
  assert.equal((await call("POST", "/teams/ZZZZZZ/join", { auth: "Bearer sam", body: { idToken: "id-user-sam" } })).status, 404);
  const noId = await call("POST", `/teams/${code}/join`, { auth: "Bearer sam", body: {} });
  assert.equal(noId.status, 401, "a join request needs a verified email");
  const someoneElse = await call("POST", `/teams/${code}/join`, { auth: "Bearer sam", body: { idToken: "id-user-ali" } });
  assert.equal(someoneElse.status, 401, "you can't ask with someone else's email");

  const sam = await ask("sam", "Sam");
  assert.equal(sam.status, 200);
  assert.deepEqual(sam.body, { status: "pending", code, title: "Juniper Café", trainer: "Rosa" }, "only the name of the training, no steps");
  const early = await call("GET", `/teams/${code}`, { auth: "Bearer sam" });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, "pending");
  assert.deepEqual((await call("GET", "/me/teams", { auth: "Bearer sam" })).body.teams, [{ code, role: "pending", title: "Juniper Café", trainer: "Rosa" }]);
  const trainer = (await call("GET", "/me/teams")).body.teams[0];
  assert.deepEqual([trainer.members, trainer.requests], [0, 1], "nobody is in yet; one person is waiting");
});

test("the trainer sees who asked, with the verified email, and decides", async () => {
  await ask("ali");
  assert.equal((await call("GET", `/teams/${code}/people`, { auth: "Bearer sam" })).status, 403, "only the trainer sees the list");
  const list = await call("GET", `/teams/${code}/people`);
  assert.deepEqual(list.body.requests.map((r) => [r.id, r.email, r.name ?? ""]), [["user-sam", "sam@example.com", "Sam"], ["user-ali", "ali@example.com", ""]]);
  assert.deepEqual(list.body.members, []);
  assert.equal((await decide("user-sam", "approve", "Bearer sam")).status, 403, "a trainee can't let themselves in");

  const after = await decide("user-sam", "approve");
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.members.map((m) => m.email), ["sam@example.com"]);
  const sam = await call("GET", `/teams/${code}`, { auth: "Bearer sam" });
  assert.equal(sam.status, 200);
  assert.equal(sam.body.rules[0].quote.startsWith("When a customer brings back a cracked mug"), true, "the trainer's exact words travel with each step");
  assert.equal((await ask("sam")).body.status, "member", "asking again once you're in just returns the training");
  assert.equal((await decide("user-sam", "approve")).status, 404, "nothing left to approve");

  await decide("user-ali", "decline");
  const ali = await call("GET", `/teams/${code}`, { auth: "Bearer ali" });
  assert.deepEqual([ali.status, ali.body.code], [403, "declined"]);
  assert.equal((await call("GET", "/me/teams")).body.teams[0].members, 1);
});

test("only members can read a training; only the trainer can change it", async () => {
  assert.equal((await call("GET", `/teams/${code}`, { auth: "Bearer sam" })).status, 200);
  const stranger = { "Bearer eve": "user-eve" };
  const other = createCoach({ store, verify: async (h) => stranger[h] ?? null });
  const r = await other({ requestContext: { http: { method: "GET" } }, rawPath: `/teams/${code}`, headers: { authorization: "Bearer eve" } });
  assert.equal(r.statusCode, 403);
  assert.equal((await call("PUT", `/teams/${code}`, { auth: "Bearer sam", body: { pack: cafe("Throw it away.") } })).status, 403);
});

test("the trainer sends a change: new version, and what changed", async () => {
  const same = await call("PUT", `/teams/${code}`, { body: { pack: cafe() } });
  assert.equal(same.body.version, 1, "nothing changed, no new version");
  const r = await call("PUT", `/teams/${code}`, { body: { pack: cafe("Check the receipt, then put it in the blue crate by the sink.") } });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 2);
  assert.deepEqual([r.body.changed, r.body.added, r.body.removed], [1, 0, 0]);
  const sam = await call("GET", `/teams/${code}`, { auth: "Bearer sam", query: { since: "1" } });
  assert.match(sam.body.rules[0].action, /blue crate/);
  assert.deepEqual(sam.body.changes.map((c) => c.changed), [["r-mug"]]);
  const versions = await call("GET", "/me/teams", { auth: "Bearer sam" });
  assert.equal(versions.body.teams[0].version, 2, "a cheap check tells the app there's something new");
});

test("diffRules: changed action, new step, removed step", () => {
  const a = [{ id: "1", action: "Do A." }, { id: "2", action: "Do B." }];
  const b = [{ id: "1", action: "do a" }, { id: "3", action: "Do C." }];
  assert.deepEqual(diffRules(a, b), { changed: [], added: ["3"], removed: ["2"] });
});

test("join attempts are limited, so codes can't be guessed", async () => {
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await call("POST", "/teams/QQQQQQ/join", { auth: "Bearer kim", body: {} })).status;
  assert.equal(last, 429);
});

test("open team: with the code you're in right away; the trainer still sees you and can remove you", async () => {
  const t = await call("POST", "/teams", { body: { pack: cafe() } });
  const c = t.body.code;
  assert.equal(t.body.open, false, "teams start closed: the trainer lets each person in");
  const join = (who, body) => call("POST", `/teams/${c}/join`, { auth: `Bearer ${who}`, body });
  assert.equal((await join("max", { idToken: "id-user-max", name: "Max" })).body.status, "pending");

  assert.equal((await call("POST", `/teams/${c}/settings`, { auth: "Bearer sam", body: { open: true } })).status, 403, "only the trainer");
  const opened = await call("POST", `/teams/${c}/settings`, { body: { open: true } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.open, true);
  assert.deepEqual(opened.body.requests, [], "turning it on lets in whoever was waiting");
  assert.deepEqual(opened.body.members.map((m) => m.email), ["max@example.com"]);

  assert.equal((await join("zoe", { idToken: "id-user-zoe" })).status, 401, "an open team still needs a verified email");
  const lee = await join("lee", { idToken: "id-user-lee", name: "Lee" });
  assert.equal(lee.status, 200);
  assert.equal(lee.body.status, "member");
  assert.equal(lee.body.rules.length, 2, "the steps arrive right away");
  assert.equal(lee.body.members, 2);
  assert.equal(lee.body.open, true);
  const people = await call("GET", `/teams/${c}/people`);
  assert.deepEqual(people.body.members.map((m) => [m.email, m.name]), [["max@example.com", "Max"], ["lee@example.com", "Lee"]]);
  const mine = await call("GET", "/me/teams");
  assert.equal(mine.body.teams.find((x) => x.code === c).open, true);

  await call("POST", `/teams/${c}/people/user-lee/remove`);
  assert.equal((await join("lee", { idToken: "id-user-lee" })).body.status, "pending", "someone the trainer removed has to ask again");

  const closed = await call("POST", `/teams/${c}/settings`, { body: { open: false } });
  assert.equal(closed.body.open, false);
  await call("POST", `/teams/${c}/leave`, { auth: "Bearer max" });
  assert.equal((await join("max", { idToken: "id-user-max" })).body.status, "pending", "closed again: the trainer decides");
  await call("DELETE", `/teams/${c}`);
});

test("the trainer removes someone; a member leaves; stopping sharing ends it for everyone", async () => {
  await ask("ali", "Ali");
  await decide("user-ali", "approve");
  assert.equal((await call("GET", "/me/teams")).body.teams[0].members, 2);
  const removed = await decide("user-ali", "remove");
  assert.deepEqual(removed.body.members.map((m) => m.id), ["user-sam"]);
  const ali = await call("GET", `/teams/${code}`, { auth: "Bearer ali" });
  assert.deepEqual([ali.status, ali.body.code], [403, "removed"]);
  assert.equal((await call("GET", "/me/teams", { auth: "Bearer ali" })).body.teams[0].role, "removed");

  assert.equal((await call("POST", `/teams/${code}/leave`, { auth: "Bearer sam" })).body.ok, true);
  assert.equal((await call("GET", "/me/teams")).body.teams[0].members, 0);
  assert.deepEqual((await call("GET", `/teams/${code}/people`)).body, { requests: [], members: [], open: false });

  await ask("sam");
  assert.equal((await call("POST", `/teams/${code}/leave`, { auth: "Bearer sam" })).body.ok, true, "taking back a request");
  assert.deepEqual((await call("GET", `/teams/${code}/people`)).body.requests, []);
  await ask("sam");
  await decide("user-sam", "approve");

  assert.equal((await call("DELETE", `/teams/${code}`, { auth: "Bearer sam" })).status, 403);
  assert.equal((await call("DELETE", `/teams/${code}`)).body.ok, true);
  assert.ok(![...store._raw.values()].some((r) => r.pk === `TEAM#${code}`), "requests and member list are deleted with it");
  const sam = await call("GET", "/me/teams", { auth: "Bearer sam" });
  assert.deepEqual(sam.body.teams, [{ code, role: "trainee", gone: true }]);
  assert.deepEqual((await call("GET", "/me/teams", { auth: "Bearer sam" })).body.teams, [], "the dangling link is cleaned up");
});

// ---------- coach keys and the MCP server ----------

let key = "";
const rpc = (msg, { token = key, headers = {} } = {}) =>
  call("POST", "/mcp", { auth: token ? `Bearer ${token}` : "", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers }, body: msg });

test("coach data and keys: stored only when turned on, keys shown once and kept as a hash", async () => {
  const packs = [{ ...cafe("Check the receipt, then put it in the blue crate by the sink."), id: "team-x", sample: false }];
  packs[0].rules[0].changedFrom = "Check the receipt, then put the mug in the grey bin.";
  packs[0].rules[0].level = 1;
  packs[0].rules[1].level = 3;
  assert.equal((await call("PUT", "/coach/packs", { auth: "Bearer sam", body: { packs, questions: ["Do refunds happen on Sundays?"] } })).body.packs, 1);
  const k = await call("POST", "/coach/tokens", { auth: "Bearer sam", body: { label: "Voice screen" } });
  assert.match(k.body.token, /^fdc_[A-Za-z0-9_-]{32}$/);
  assert.equal(k.body.mcpUrl, "https://coach.example/mcp");
  key = k.body.token;
  assert.ok(!JSON.stringify([...store._raw.values()]).includes(key), "the key itself is never stored");
  const list = await call("GET", "/coach/tokens", { auth: "Bearer sam" });
  assert.deepEqual(list.body.tokens.map((t) => t.label), ["Voice screen"]);
});

test("MCP: initialize negotiates 2025-11-25 and lists read-only tools with schemas", async () => {
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, LATEST);
  assert.equal(init.body.result.serverInfo.name, "firstday-coach");
  assert.ok(init.body.result.capabilities.tools);
  const old = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(old.body.result.protocolVersion, LATEST, "unknown version: the server offers its latest");
  const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202, "notifications get 202 Accepted");
  const tools = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { headers: { "mcp-protocol-version": "2025-11-25" } });
  assert.deepEqual(tools.body.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of tools.body.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.outputSchema.type, "object");
    assert.equal(t.annotations.readOnlyHint, true);
  }
});

test("MCP: quiz, then check answers with the trainer's words; the old way never passes", async () => {
  const quiz = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "quiz_me", arguments: { count: 1 } } });
  const q = quiz.body.result.structuredContent.questions[0];
  assert.equal(q.id, "r-mug", "shakiest step first");
  assert.ok(!quiz.body.result.content[0].text.includes("blue crate"), "the text never gives the answer away");
  const right = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "check_answer", arguments: { id: q.id, answer: "I check their receipt and put the mug in the blue crate" } } });
  assert.equal(right.body.result.structuredContent.pass, true);
  assert.match(right.body.result.structuredContent.feedback, /Rosa said: "When a customer brings back a cracked mug/);
  const old = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "check_answer", arguments: { situation: "a customer brings back a cracked mug", answer: "receipt, then the grey bin" } } });
  assert.equal(old.body.result.structuredContent.pass, false);
  assert.equal(old.body.result.structuredContent.oldWay, true);
  assert.match(old.body.result.content[0].text, /old way/);
});

test("MCP: what changed, find a step, questions, and a warm-up prompt", async () => {
  const changed = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "what_changed", arguments: {} } });
  assert.match(changed.body.result.structuredContent.changed[0].before, /grey bin/);
  const find = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "find_step", arguments: { query: "oat milk order" } } });
  assert.match(find.body.result.structuredContent.matches[0].action, /OAT on the lid/);
  const none = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "find_step", arguments: { query: "fire alarm" } } });
  assert.deepEqual(none.body.result.structuredContent.matches, []);
  assert.match(none.body.result.content[0].text, /ask the trainer/);
  const qs = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "trainer_questions", arguments: {} } });
  assert.deepEqual(qs.body.result.structuredContent.questions, ["Do refunds happen on Sundays?"]);
  const prompt = await rpc({ jsonrpc: "2.0", id: 11, method: "prompts/get", params: { name: "shift_warmup", arguments: { training: "café" } } });
  assert.match(prompt.body.result.messages[0].content.text, /quiz_me/);
});

test("MCP: errors follow the spec", async () => {
  const badArgs = await rpc({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "check_answer", arguments: { id: "r-mug" } } });
  assert.equal(badArgs.body.result.isError, true, "bad arguments are a tool error the model can fix");
  const unknownTool = await rpc({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "delete_everything", arguments: {} } });
  assert.equal(unknownTool.body.error.code, -32602);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 14, method: "resources/list" })).body.error.code, -32601);
  assert.equal((await rpc("{nope")).body.error.code, -32700);
  assert.equal((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status, 400, "one message per POST");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 15, method: "ping" }, { headers: { "mcp-protocol-version": "2023-01-01" } })).status, 400);
  const noKey = await rpc({ jsonrpc: "2.0", id: 16, method: "ping" }, { token: "" });
  assert.equal(noKey.status, 401);
  assert.match(noKey.headers["www-authenticate"], /^Bearer /);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 17, method: "ping" }, { token: "fdc_wrong" })).status, 401);
  const evil = await rpc({ jsonrpc: "2.0", id: 18, method: "ping" }, { headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403, "browser calls only from FirstDay's own pages");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 19, method: "ping" }, { headers: { origin: VOICE } })).status, 200);
  assert.equal((await call("GET", "/mcp", { auth: `Bearer ${key}` })).status, 405, "no SSE stream on GET");
});

test("a revoked key stops working; turning it off deletes the steps and every key", async () => {
  const id = (await call("GET", "/coach/tokens", { auth: "Bearer sam" })).body.tokens[0].id;
  assert.equal((await call("DELETE", `/coach/tokens/${id}`, { auth: "Bearer sam" })).body.ok, true);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 20, method: "ping" })).status, 401);
  const k2 = await call("POST", "/coach/tokens", { auth: "Bearer sam", body: { label: "Claude" } });
  assert.equal((await call("DELETE", "/coach", { auth: "Bearer sam" })).body.ok, true);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 21, method: "ping" }, { token: k2.body.token })).status, 401);
  assert.equal(await store.get("USER#user-sam", "COACH"), null);
});

test("grading matches the app: a rule that names the old way ('…, not the grey bin') still rejects it", () => {
  const action = "Check the receipt, then put it in the blue crate by the sink, not the grey bin.";
  const step = { action, keywords: keywordsFor(action), changedFrom: "Check the receipt first, then put the mug in the grey bin.", trainer: "Rosa", quote: action };
  assert.deepEqual(step.keywords, ["check", "receipt", "put", "blue", "crate"]);
  const old = grade("check the receipt and put it in the grey bin", step);
  assert.deepEqual([old.pass, old.oldWay], [false, true]);
  assert.equal(grade("receipt, then the blue crate by the sink", step).pass, true);
  assert.equal(grade(action, step).pass, true, "the trainer's own words pass");
  assert.equal(grade("check the receipt then put it in the blue crate by the sink not the grey bin", step).pass, true, "spoken, no commas");
});
