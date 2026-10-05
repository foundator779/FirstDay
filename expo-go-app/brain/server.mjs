#!/usr/bin/env node
// FirstDay Go "brain": a small helper that runs on your Windows, Mac or Linux computer.
// - Reads your real Bee data through the signed-in Bee CLI: conversations, facts, to-dos,
//   to-do suggestions, daily summaries and insights, and writes your fixes back to Bee.
// - Watches Bee live (`bee stream`) so a training conversation becomes practice right after it ends.
// - Optional Amazon Bedrock for smarter analysis (the phone can also use the AWS endpoint instead).
// - Shares your confirmed work rules with the FirstDay coach Agent Skill (skills/firstday-coach).
// Credentials stay on this computer; the phone only holds a pairing code. Zero dependencies: Node 22+.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, timingSafeEqual } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
// Load every .env that exists (brain/, expo-go-app/, repo root). A setting found earlier wins,
// because loadEnvFile never overwrites a variable that's already set.
for (const candidate of [resolve(here, ".env"), resolve(here, "../.env"), resolve(here, "../../.env")]) {
  if (!existsSync(candidate)) continue;
  try {
    process.loadEnvFile(candidate);
    console.log(`Loaded settings from ${candidate}`);
  } catch {}
}

const { aiHandlers, bearerInfer } = await import("./ai.mjs");
const { cognitoVerifier } = await import("./cognito.mjs");
const bee = await import("./bee.mjs");
const { cleanPacks, loadState, saveState } = await import("./state.mjs");

const PORT = Number(process.env.FIRSTDAY_GO_PORT || 8790);
const CODE = process.env.FIRSTDAY_GO_CODE || String(randomInt(100000, 999999));
const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL = process.env.BEDROCK_MODEL_ID || "us.amazon.nova-pro-v1:0";
const TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK || "";
const AI = /^ABSK[A-Za-z0-9+/=]+$/.test(TOKEN);
const POOL_ID = process.env.FIRSTDAY_GO_COGNITO_POOL_ID || "";
const REQUIRE_ACCOUNT = process.env.FIRSTDAY_GO_REQUIRE_ACCOUNT === "1";
const verifyUser = cognitoVerifier({ poolId: POOL_ID, clientId: process.env.FIRSTDAY_GO_COGNITO_CLIENT_ID || "" });
const ai = aiHandlers(AI ? bearerInfer({ region: REGION, model: MODEL, token: TOKEN }) : async () => {
  throw new Error("ai-off");
});

const state = loadState();
const seen = new Set(state.seen);
const persist = () => {
  state.seen = [...seen].slice(-500);
  try {
    saveState(state);
  } catch {}
};
let beeAvailable = false;
let watching = false;

const need = (cond) => {
  if (!cond) throw new bee.BeeError("bee-bad-args");
};

const routes = {
  "GET /health": async () => ({ ok: true, ai: AI, bee: beeAvailable, live: watching, accounts: REQUIRE_ACCOUNT, version: 3 }),
  "POST /analyze": (b) => ai.analyze(b),
  "POST /ask": (b) => ai.ask(b),
  "POST /steps": (b) => ai.steps(b),
  "POST /grade": (b) => ai.grade(b),

  // Conversations
  "GET /bee/conversations": async () => ({ conversations: await bee.listConversations(25) }),

  // Two-way sync
  "GET /bee/sync": async () => ({ ...(await bee.syncSnapshot()), todosChangedAt: state.todosChangedAt }),
  "POST /bee/facts/confirm": (b) => bee.beeWrites.confirmFact(b.id).then(() => ({ ok: true })),
  "POST /bee/facts/delete": (b) => bee.beeWrites.deleteFact(b.id).then(() => ({ ok: true })),
  "POST /bee/facts/update": (b) => bee.beeWrites.updateFact(b.id, b.text).then(() => ({ ok: true })),
  "POST /bee/facts/create": (b) => bee.beeWrites.createFact(b.text),
  "POST /bee/todos/create": (b) => bee.beeWrites.createTodo(b.text, Number(b.alarmAt)),
  "POST /bee/todos/complete": (b) => bee.beeWrites.completeTodo(b.id).then(() => ({ ok: true })),
  "POST /bee/suggestions/accept": (b) => bee.beeWrites.acceptSuggestion(b.id),
  "POST /bee/suggestions/dismiss": (b) => bee.beeWrites.dismissSuggestion(b.id).then(() => ({ ok: true })),

  // Live: new conversations since the phone last looked
  "GET /bee/inbox": async () => ({ items: state.inbox, todosChangedAt: state.todosChangedAt, live: watching }),
  "POST /bee/inbox/ack": async (b) => {
    need(Array.isArray(b.ids));
    const ids = new Set(b.ids.map(String));
    state.inbox = state.inbox.filter((i) => !ids.has(i.id));
    persist();
    return { ok: true };
  },

  // Confirmed rules for the FirstDay coach Agent Skill
  "POST /sync/packs": async (b) => {
    state.packs = cleanPacks(b.packs);
    state.packsUpdatedAt = Date.now();
    persist();
    return { ok: true, packs: state.packs.length };
  },
};

function codeOk(req) {
  const given = Buffer.from(String(req.headers["x-firstday-code"] || ""));
  const want = Buffer.from(CODE);
  return given.length === want.length && timingSafeEqual(given, want);
}

// Guessing the 6-digit code: 5 wrong tries lock that address out for 15 minutes, and after 30 wrong
// tries in an hour from anywhere, only addresses that already paired can try at all.
const strikes = new Map();
const paired = new Set();
let wrongThisHour = { hour: 0, count: 0 };
function lockedOut(ip) {
  const s = strikes.get(ip);
  if (s && s.until > Date.now()) return true;
  const hour = Math.floor(Date.now() / 3600_000);
  return wrongThisHour.hour === hour && wrongThisHour.count >= 30 && !paired.has(ip);
}
function strike(ip) {
  const s = strikes.get(ip) ?? { count: 0, until: 0 };
  s.count += 1;
  if (s.count >= 5) {
    s.count = 0;
    s.until = Date.now() + 15 * 60_000;
  }
  strikes.set(ip, s);
  const hour = Math.floor(Date.now() / 3600_000);
  wrongThisHour = wrongThisHour.hour === hour ? { hour, count: wrongThisHour.count + 1 } : { hour, count: 1 };
  if (strikes.size > 1000) strikes.clear();
}

const server = createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const ip = req.socket.remoteAddress || "?";
  if (lockedOut(ip)) return send(429, { error: "Too many wrong codes. Try again later." });
  if (!codeOk(req)) {
    strike(ip);
    return send(401, { error: "Wrong pairing code" });
  }
  paired.add(ip);
  if (REQUIRE_ACCOUNT && !(await verifyUser(req.headers.authorization))) return send(401, { error: "Sign in required" });
  const url = new URL(req.url || "/", "http://x");
  let handler = routes[`${req.method} ${url.pathname}`];
  const one = /^\/bee\/conversations\/([^/]+)$/.exec(url.pathname);
  if (!handler && req.method === "GET" && one) handler = () => bee.getConversation(decodeURIComponent(one[1]));
  if (!handler) return send(404, { error: "Not found" });
  let body = {};
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 400_000) return send(413, { error: "Too big" });
    }
    try {
      body = JSON.parse(raw || "{}") ?? {};
    } catch {
      return send(400, { error: "Bad JSON" });
    }
  }
  try {
    send(200, await handler(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "ai-off") return send(503, { error: "AI is not set up on the brain" });
    if (msg === "not-ready") return send(409, { error: "Bee is still processing this conversation. Try again in a few minutes." });
    if (msg === "bee-bad-args") return send(400, { error: "Invalid request" });
    if (msg.startsWith("bee-")) return send(502, { error: "Couldn't reach Bee. Is the Bee CLI installed and signed in (bee status)?" });
    send(502, { error: "Upstream failed" });
  }
});

bee
  .listConversations(1)
  .then(() => (beeAvailable = true))
  .catch(() => (beeAvailable = false))
  .finally(() => {
    if (beeAvailable && process.env.FIRSTDAY_BEE_LIVE !== "0") {
      watching = true;
      bee.startWatcher({
        seen,
        onNew(items, firstRun) {
          if (!firstRun) {
            const known = new Set(state.inbox.map((i) => i.id));
            state.inbox = [...state.inbox, ...items.filter((i) => !known.has(i.id))].slice(-20);
            console.log(`  New Bee conversation${items.length > 1 ? "s" : ""}: ${items.map((i) => i.title).join(", ")}`);
          }
          persist();
        },
        onTodosChanged() {
          state.todosChangedAt = Date.now();
          persist();
        },
        log: (m) => console.log(`  ${m}`),
      });
    }
    server.listen(PORT, "0.0.0.0", () => {
      const ips = Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => i.address);
      console.log("\n  FirstDay Go brain is running\n");
      for (const ip of ips) console.log(`  Address:  http://${ip}:${PORT}`);
      console.log(`  Code:     ${CODE}\n`);
      console.log(`  Bee CLI:      ${beeAvailable ? `found${watching ? ", watching live" : ""}` : "not found - install it, run `bee login`, or set BEE_CLI_PATH"}`);
      console.log(`  AI (Bedrock): ${AI ? `on (${MODEL})` : "off here (the app can use the AWS endpoint when signed in)"}`);
      console.log(`  Accounts:     ${POOL_ID ? `Cognito ${POOL_ID}${REQUIRE_ACCOUNT ? " (sign-in required)" : " (optional)"}` : "off"}\n`);
      console.log("  In the app: Settings > Brain, then type the address and code.\n");
    });
  });
