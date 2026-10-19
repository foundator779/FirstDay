// FirstDay Bee service: connects a FirstDay account to its own Bee account without a computer.
//
// How it works: the Bee CLI (Bee's official developer tool, docs.bee.computer/docs/cli) runs inside
// this Lambda. "Connect Bee" runs `bee login --no-wait`, which prints Bee's approval link; you approve
// it in Bee; a later check re-runs `bee login` to finish. The CLI's sign-in folder is then kept sealed
// (vault.mjs) and restored for each request, so every Bee read and write still goes through the CLI,
// exactly like the brain on a computer (same bee.mjs, same routes, same answers).
//
// Safety: Cognito sign-in required; only allow-listed accounts until opened to everyone; recorded
// consent before connecting; the key that opens your sealed Bee sign-in lives only on your phone;
// Disconnect signs out of Bee and deletes everything stored for you.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_HEADER, deriveKey, open, parsePhoneKey, readFolder, sameFolder, seal, writeFolder } from "./vault.mjs";

/** Bump when the consent text in the app changes: people connected under an older text are asked again. */
export const CONSENT_VERSION = "bee-cloud-2026-10-06";
const PENDING_SECONDS = 15 * 60;
const SKIP = [".cache", ".npm", ".config/configstore"];

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const need = (cond, status, message, extra) => {
  if (!cond) throw new HttpError(status, message, extra);
};

export function createApp({ store, verify, bee, beePath, allowed, now = Date.now, perHour = 600, log = () => {} }) {
  let cliCheck = null;
  const usage = new Map();
  const underLimit = (user) => {
    const hour = Math.floor(now() / 3600_000);
    const u = usage.get(user);
    const count = u && u.hour === hour ? u.count + 1 : 1;
    usage.set(user, { hour, count });
    return count <= perHour;
  };

  /** Runs the Bee CLI with HOME set to the given folder; never throws (code null = timed out). */
  const runRaw = (home, args, timeout) =>
    new Promise((resolve) => {
      execFile(beePath, args, { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache") } }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, out: `${stdout ?? ""}\n${stderr ?? ""}` }),
      );
    });

  /** Restores the sealed sign-in into a fresh private folder, runs fn with HOME pointing at it, then cleans up. */
  async function withHome(folder, fn) {
    const home = mkdtempSync(join(tmpdir(), "bee-"));
    const prev = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME };
    try {
      writeFolder(home, folder);
      // bee.mjs runs the CLI with process.env; Lambda handles one request at a time per instance.
      Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache") });
      const result = await fn(home);
      return { result, folder: readFolder(home, SKIP) };
    } finally {
      for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      rmSync(home, { recursive: true, force: true });
    }
  }

  const signedIn = async () => {
    try {
      await bee.runBee(["conversations", "list", "--limit", "1", "--json"]);
      return true;
    } catch {
      return false;
    }
  };

  function unseal(rec, key, user) {
    try {
      return open(rec.sealed, deriveKey(key, user), user).folder ?? {};
    } catch {
      throw new HttpError(409, "This phone's key doesn't match your saved Bee connection. Disconnect, then connect Bee again.", { code: "key-mismatch" });
    }
  }

  /** Saves the record; a clash means another request saved first, which is fine to ignore for refreshes. */
  async function save(user, rec, version, folder, key) {
    const next = { ...rec };
    if (folder) next.sealed = seal({ folder }, deriveKey(key, user), user);
    return store.put(user, next, version);
  }

  // ---------- Bee routes (same paths and answers as the brain on a computer) ----------
  const beeRoutes = {
    "GET /bee/conversations": async () => ({ conversations: await bee.listConversations(25) }),
    "GET /bee/sync": async () => ({ ...(await bee.syncSnapshot()), todosChangedAt: 0 }),
    "POST /bee/facts/confirm": (b) => bee.beeWrites.confirmFact(b.id).then(() => ({ ok: true })),
    "POST /bee/facts/delete": (b) => bee.beeWrites.deleteFact(b.id).then(() => ({ ok: true })),
    "POST /bee/facts/update": (b) => bee.beeWrites.updateFact(b.id, b.text).then(() => ({ ok: true })),
    "POST /bee/facts/create": (b) => bee.beeWrites.createFact(b.text),
    "POST /bee/todos/create": (b) => bee.beeWrites.createTodo(b.text, Number(b.alarmAt)),
    "POST /bee/todos/complete": (b) => bee.beeWrites.completeTodo(b.id).then(() => ({ ok: true })),
    "POST /bee/suggestions/accept": (b) => bee.beeWrites.acceptSuggestion(b.id),
    "POST /bee/suggestions/dismiss": (b) => bee.beeWrites.dismissSuggestion(b.id).then(() => ({ ok: true })),
    /** New processed conversations since you last looked. The first look only remembers what's there. */
    "GET /bee/inbox": async (_b, rec) => {
      const ready = (await bee.listConversations(15)).filter((c) => c.ready);
      if (!rec.inboxStarted) {
        rec.seen = ready.map((c) => c.id);
        rec.inboxStarted = true;
        return { items: [], todosChangedAt: 0, live: true };
      }
      const seen = new Set(rec.seen);
      return { items: ready.filter((c) => !seen.has(c.id)).map(({ id, title, at }) => ({ id, title, at })), todosChangedAt: 0, live: true };
    },
  };

  async function handle(event) {
    const method = event.requestContext?.http?.method ?? "GET";
    const path = event.rawPath ?? "/";
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (method === "GET" && path === "/health") {
      // Proves the Bee CLI starts here (no Bee account involved): `bee --version` in an empty folder, once per instance.
      if (!cliCheck) {
        cliCheck = (async () => {
          const home = mkdtempSync(join(tmpdir(), "bee-health-"));
          try {
            const r = await runRaw(home, ["--version"], 15_000);
            return { ok: r.code === 0, version: r.out.trim().split("\n")[0]?.slice(0, 60) || "" };
          } finally {
            rmSync(home, { recursive: true, force: true });
          }
        })();
      }
      return { ok: true, ai: false, bee: true, live: true, accounts: true, cloud: true, version: 3, consentVersion: CONSENT_VERSION, cli: await cliCheck };
    }

    const user = await verify(headers.authorization);
    need(user, 401, "Sign in required");
    need(await allowed(user, headers.authorization), 403, "Connecting Bee without a computer is in preview and isn't open to this account yet.", { accountId: user });
    need(underLimit(user), 429, "Too many requests. Try again later.");

    let body = {};
    if (method === "POST") {
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
      need(raw.length <= 400_000, 413, "Too big");
      try {
        body = JSON.parse(raw || "{}") ?? {};
      } catch {
        throw new HttpError(400, "Bad JSON");
      }
    }
    const key = parsePhoneKey(headers[KEY_HEADER]);
    const rec = await store.get(user);
    const version = rec?.version ?? 0;

    if (method === "GET" && path === "/bee/connection") {
      const status = rec?.status ?? "none";
      return { status, consentVersion: rec?.consentVersion || null, consentedAt: rec?.consentedAt || null, connectedAt: rec?.connectedAt || null, currentConsent: CONSENT_VERSION, needsConsent: status === "connected" && rec.consentVersion !== CONSENT_VERSION };
    }

    if (method === "POST" && path === "/bee/connect/start") {
      need(body.consent === CONSENT_VERSION, 400, "Please read and agree to how Connect Bee works first.", { code: "consent-required", currentConsent: CONSENT_VERSION });
      need(key, 400, "Missing this phone's key.", { code: "key-required" });
      const { result, folder } = await withHome({}, (home) => runRaw(home, ["login", "--no-wait"], 25_000));
      const link = /https:\/\/[^\s"'<>]+/.exec(result.out)?.[0];
      need(link, 502, "Bee didn't return a sign-in link. Is Developer Mode on in the Bee app?");
      const t = now();
      const next = { status: "pending", consentVersion: CONSENT_VERSION, consentedAt: t, expiresAt: Math.floor(t / 1000) + PENDING_SECONDS, seen: [], inboxStarted: false };
      let ok = await save(user, next, version, folder, key);
      if (!ok) {
        await store.remove(user);
        ok = await save(user, next, 0, folder, key);
      }
      need(ok, 409, "Another connect is in progress. Try again.");
      log("connect-start");
      return { status: "pending", link, expiresInSeconds: PENDING_SECONDS };
    }

    if (method === "POST" && path === "/bee/connect/check") {
      need(rec && (rec.status === "pending" || rec.status === "connected"), 404, "No Bee connection in progress.", { status: rec?.status ?? "none" });
      need(key, 400, "Missing this phone's key.", { code: "key-required" });
      const folder0 = unseal(rec, key, user);
      let existing = null;
      const { result: ok, folder } = await withHome(folder0, async (home) => {
        let done = await signedIn();
        if (!done && rec.status === "pending") {
          await runRaw(home, ["login"], 20_000); // resumes and waits for your approval
          done = await signedIn();
        }
        // The moment you connect, remember what Bee already has, so everything processed after this counts as new
        // ("Just recorded by Bee"), even if the app doesn't look for a while. If listing fails, the first look does it.
        if (done && !rec.inboxStarted) {
          try {
            existing = (await bee.listConversations(15)).filter((c) => c.ready).map((c) => c.id);
          } catch {}
        }
        return done;
      });
      const next = ok
        ? { ...rec, status: "connected", connectedAt: rec.connectedAt || now(), expiresAt: 0, ...(existing ? { seen: existing, inboxStarted: true } : {}) }
        : rec;
      await save(user, next, version, folder, key);
      if (ok && rec.status !== "connected") log("connect-done");
      return { status: next.status };
    }

    if (method === "POST" && path === "/bee/disconnect") {
      if (rec?.sealed && key) {
        try {
          const folder0 = unseal(rec, key, user);
          await withHome(folder0, (home) => runRaw(home, ["logout"], 15_000));
        } catch {
          // Can't open it without this phone's key; deleting it below still removes it for good.
        }
      }
      await store.remove(user);
      log("disconnect");
      return { ok: true };
    }

    if (method === "POST" && path === "/bee/inbox/ack") {
      need(rec?.status === "connected", 409, "Bee isn't connected.", { status: rec?.status ?? "none" });
      need(Array.isArray(body.ids), 400, "Bad request");
      const seen = [...new Set([...rec.seen, ...body.ids.map(String).slice(0, 100)])];
      await store.put(user, { ...rec, seen }, version);
      return { ok: true };
    }

    // The coach Agent Skill lives on a computer; nothing to keep here.
    if (method === "POST" && path === "/sync/packs") return { ok: true, packs: 0 };

    let route = beeRoutes[`${method} ${path}`];
    const one = /^\/bee\/conversations\/([^/]+)$/.exec(path);
    if (!route && method === "GET" && one) {
      const id = decodeURIComponent(one[1]);
      need(bee.validId(id), 400, "Invalid request");
      route = () => bee.getConversation(id);
    }
    need(route, 404, "Not found");
    need(rec?.status === "connected", 409, "Bee isn't connected. Open Settings → Connect Bee.", { status: rec?.status ?? "none" });
    need(rec.consentVersion === CONSENT_VERSION, 409, "Please review and agree to the updated Connect Bee terms.", { code: "consent-required", currentConsent: CONSENT_VERSION });
    need(key, 400, "Missing this phone's key.", { code: "key-required" });
    const folder0 = unseal(rec, key, user);
    const next = { ...rec, seen: [...rec.seen] };
    const { result, folder } = await withHome(folder0, () => route(body, next));
    const changed = !sameFolder(folder, folder0) || next.seen.length !== rec.seen.length || next.inboxStarted !== rec.inboxStarted;
    if (changed) await save(user, next, version, folder, key);
    return result;
  }

  return async function handler(event) {
    try {
      return reply(200, await handle(event));
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message, ...e.extra });
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "not-ready") return reply(409, { error: "Bee is still processing this conversation. Try again in a few minutes." });
      if (msg === "bee-bad-args") return reply(400, { error: "Invalid request" });
      // Never log Bee content; the error name is enough to debug.
      log(`failed: ${e?.name ?? "Error"} ${msg.slice(0, 40)}`);
      if (msg.startsWith("bee-")) return reply(502, { error: "Couldn't reach Bee right now. If this keeps happening, disconnect and connect Bee again." });
      return reply(500, { error: "Something went wrong" });
    }
  };
}

const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
