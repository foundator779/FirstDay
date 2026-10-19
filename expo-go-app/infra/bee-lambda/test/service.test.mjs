import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
// The stand-in Bee CLI is a script with a shebang, which Windows can't run directly.
const test = process.platform === "win32" ? nodeTest.skip : nodeTest;
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Tests the FirstDay Bee service against a stand-in Bee CLI (test/fake-bee). Run: node --test infra/bee-lambda/test/
const here = dirname(fileURLToPath(import.meta.url));
const T = mkdtempSync(join(tmpdir(), "bee-service-test-"));
mkdirSync(`${T}/approvals`);
copyFileSync(join(here, "fake-bee"), `${T}/bee`);
chmodSync(`${T}/bee`, 0o755);
process.env.BEE_CLI_PATH = `${T}/bee`;
process.env.FAKE_BEE_LOG = `${T}/calls.log`;
process.env.FAKE_BEE_APPROVALS = `${T}/approvals`;
process.env.FAKE_BEE_NEW = `${T}/new-convo`;
writeFileSync(process.env.FAKE_BEE_LOG, "");
const bee = await import("../../../brain/bee.mjs");
const { createApp, CONSENT_VERSION } = await import("../app.mjs");
const { memoryStore } = await import("../memstore.mjs");
const { open, deriveKey } = await import("../vault.mjs");

const store = memoryStore();
const ME = "user-me", OTHER = "user-other";
const app = createApp({ store, bee, beePath: process.env.BEE_CLI_PATH, verify: async (h) => ({ "Bearer me": ME, "Bearer other": OTHER })[h] ?? null, allowed: async (u) => u === ME });
const key = randomBytes(32).toString("base64url");
const call = async (method, path, { auth = "Bearer me", body, k = key } = {}) => {
  const r = await app({ requestContext: { http: { method } }, rawPath: path, headers: { authorization: auth, ...(k ? { "x-firstday-bee-key": k } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

test("health says the Bee CLI starts, without any sign-in", async () => {
  const h = await call("GET", "/health", { auth: "" });
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.cli, { ok: true, version: "bee 0.0.0-fake" });
});

test("gatekeeping: sign-in, allow-list, consent, phone key", async () => {
  assert.equal((await call("GET", "/bee/connection", { auth: "Bearer nope" })).status, 401);
  const other = await call("GET", "/bee/connection", { auth: "Bearer other" });
  assert.equal(other.status, 403);
  assert.equal(other.body.accountId, OTHER, "tells you your account id so the owner can allow it");
  assert.equal((await call("POST", "/bee/connect/start", { body: {} })).body.code, "consent-required");
  assert.equal((await call("POST", "/bee/connect/start", { body: { consent: CONSENT_VERSION }, k: null })).body.code, "key-required");
  assert.equal((await call("GET", "/bee/sync")).status, 409, "no Bee data before connecting");
});

test("connect: link, wait for approval, then connected", async () => {
  const start = await call("POST", "/bee/connect/start", { body: { consent: CONSENT_VERSION } });
  assert.equal(start.status, 200);
  assert.match(start.body.link, /^https:\/\/bee\.example\/approve\?code=/);
  const rec = store._raw.get(ME);
  assert.equal(rec.status, "pending");
  assert.equal(rec.consentVersion, CONSENT_VERSION);
  assert.ok(!JSON.stringify(rec).includes("pending.json"), "sign-in folder is only stored sealed");
  assert.equal((await call("POST", "/bee/connect/check")).body.status, "pending", "not approved yet");
  writeFileSync(`${T}/approvals/${new URL(start.body.link).searchParams.get("code")}`, "ok");
  assert.equal((await call("POST", "/bee/connect/check")).body.status, "connected");
  assert.equal((await call("GET", "/bee/connection")).body.status, "connected");
});

test("Bee data through the CLI, and refreshed sign-ins are saved sealed", async () => {
  const sync = await call("GET", "/bee/sync");
  assert.equal(sync.status, 200);
  assert.equal(sync.body.facts[0].text, "Your manager is Dana.");
  const sealed = store._raw.get(ME).sealed;
  const folder = open(sealed, deriveKey(Buffer.from(key, "base64url"), ME), ME).folder;
  const token = Buffer.from(folder[".bee/token-prod"], "base64").toString();
  assert.ok(Number(token.split("-")[1]) > 2, `refreshed token saved (${token})`);
  const convo = await call("GET", "/bee/conversations/101");
  assert.equal(convo.status, 200);
  assert.match(convo.body.text, /blue ledger/);
  assert.equal((await call("POST", "/bee/facts/confirm", { body: { id: "f1" } })).body.ok, true);
});

test("inbox: what Bee had at connect time is remembered; only later ones are new, until acknowledged", async () => {
  const rec = store._raw.get(ME);
  assert.equal(rec.inboxStarted, true, "remembered at connect, not at the app's first look");
  assert.deepEqual(rec.seen, ["101"], "only finished ones; one still processing (102) will count as new when it finishes");
  // A conversation processed after connecting, before the app ever looks, still counts as new.
  writeFileSync(process.env.FAKE_BEE_NEW, "1");
  const items = (await call("GET", "/bee/inbox")).body.items;
  assert.deepEqual(items.map((i) => [i.id, i.title]), [["103", "Front desk training"]]);
  await call("POST", "/bee/inbox/ack", { body: { ids: ["103"] } });
  assert.deepEqual((await call("GET", "/bee/inbox")).body.items, []);
});

test("a different phone key can't open your Bee sign-in", async () => {
  const wrong = await call("GET", "/bee/sync", { k: randomBytes(32).toString("base64url") });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.code, "key-mismatch");
});

test("disconnect signs out of Bee and deletes everything", async () => {
  assert.equal((await call("POST", "/bee/disconnect")).body.ok, true);
  assert.ok(readFileSync(process.env.FAKE_BEE_LOG, "utf8").includes("LOGGED-OUT"));
  assert.equal(store._raw.has(ME), false);
  assert.equal((await call("GET", "/bee/connection")).body.status, "none");
});
