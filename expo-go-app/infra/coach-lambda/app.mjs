// FirstDay coach service: one Lambda behind a Function URL, one on-demand DynamoDB table (store.mjs).
//
// 1. Team trainings. A trainer (or job coach) shares a training with a 6-character join code. Someone with the
//    code asks to join with their FirstDay account; the trainer sees who asked (their verified email and the name
//    they gave) and lets them in or declines. Only people the trainer let in get the steps, with the trainer's
//    exact words. When the trainer sends a new version, each member's app pulls it and turns changed steps into a
//    Change Drill. The trainer can remove anyone later. A trainer can also turn on "Let anyone with the code in"
//    (an open team, e.g. a public practice team): then a join with a verified email gets in right away, and the
//    trainer still sees who joined and can remove anyone. Someone the trainer removed has to ask again.
// 2. "Use my trainings in other apps". The user's confirmed steps (only when they turn it on) and a key per
//    app power a remote MCP server at /mcp (mcp.mjs): any MCP client, or FirstDay's voice screen, can quiz them.
//
// Safety: every route but /health and /mcp needs a FirstDay (Amazon Cognito) access token; /mcp needs a key
// made in the app (only its hash is stored) or a Cognito token. A join request also carries the Cognito ID token,
// so the email a trainer sees is the one Cognito verified, not something typed in. Trainers see who is on their
// team, never anyone's answers or progress. A user's steps (with how solid each is) are stored only after they turn on
// "Quiz me from other apps", and turning it off deletes them and every key. Logs keep error names only.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { cleanPacks } from "./coach.mjs";
import { handleRequest, RpcError, SUPPORTED_VERSIONS } from "./mcp.mjs";

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_TOKENS = 5;
const RULE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PERSON_ID = /^[A-Za-z0-9-]{1,64}$/;
/** An open team stops letting people in on its own past this size; the trainer can still let people in. */
export const OPEN_MAX = 500;

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

const str = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sha256 = (t) => createHash("sha256").update(t).digest("hex");

/** A shared training as the trainer sends it: validated, trimmed, no practice data. */
export function cleanTeamPack(input) {
  const p = input && typeof input === "object" ? input : {};
  const seen = new Set();
  const rules = (Array.isArray(p.rules) ? p.rules : [])
    .slice(0, 100)
    .map((r) => ({
      id: typeof r?.id === "string" && RULE_ID.test(r.id) ? r.id : "",
      situation: str(r?.situation, 300),
      action: str(r?.action, 400),
      quote: str(r?.quote, 600),
      ...(Array.isArray(r?.keywords) ? { keywords: r.keywords.slice(0, 8).map((k) => str(k, 40)).filter(Boolean) } : {}),
      ...(str(r?.customerLine, 300) ? { customerLine: str(r.customerLine, 300) } : {}),
      ...(Array.isArray(r?.distractors) ? { distractors: r.distractors.slice(0, 4).map((d) => str(d, 300)).filter(Boolean) } : {}),
    }))
    .filter((r) => r.id && r.situation && r.action && !seen.has(r.id) && seen.add(r.id));
  return {
    title: str(p.title, 120) || "Team training",
    trainer: str(p.trainer, 80) || "Your trainer",
    place: str(p.place, 120),
    rules,
    questions: (Array.isArray(p.questions) ? p.questions : []).slice(0, 20).map((q) => str(q, 300)).filter(Boolean),
  };
}

/** What changed between two versions, by step id: a changed action, a new step, a removed step. */
export function diffRules(before, after) {
  const old = new Map(before.map((r) => [r.id, r]));
  const now = new Set(after.map((r) => r.id));
  const changed = after.filter((r) => old.has(r.id) && norm(old.get(r.id).action) !== norm(r.action)).map((r) => r.id);
  const added = after.filter((r) => !old.has(r.id)).map((r) => r.id);
  const removed = before.filter((r) => !now.has(r.id)).map((r) => r.id);
  return { changed, added, removed };
}

/** DynamoDB items are limited to 400 KB (bytes, not characters); keep well under it. */
const fits = (data) => Buffer.byteLength(JSON.stringify(data), "utf8") < 350_000;

const teamView = (t) => ({ code: t.code, version: t.version, title: t.title, trainer: t.trainer, place: t.place, rules: t.rules, questions: t.questions, members: t.members ?? 0, open: t.open === true });

export function createCoach({ store, verify, verifyId = async () => null, now = Date.now, log = () => {}, origins = [], mcpUrl = "", perHour = 600, joinsPerHour = 20 }) {
  const allowedOrigins = new Set(origins.map((o) => String(o).replace(/\/+$/, "").toLowerCase()));
  const originOk = (origin) => !origin || allowedOrigins.has(String(origin).replace(/\/+$/, "").toLowerCase());
  const counters = new Map();
  /** Soft per-user limits per warm instance, so a stuck client or a code-guesser gets nowhere. */
  const under = (kind, user, limit) => {
    const hour = Math.floor(now() / 3600_000);
    const k = `${kind}:${user}`;
    const c = counters.get(k);
    const count = c && c.hour === hour ? c.count + 1 : 1;
    counters.set(k, { hour, count });
    if (counters.size > 5000) counters.clear();
    return count <= limit;
  };

  /** Read-modify-write on one item, retried if someone else wrote in between. */
  async function update(pk, sk, fn, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const cur = await store.get(pk, sk);
      const next = fn(cur);
      if (next === null) return cur;
      if (await store.put(pk, sk, next, cur?._v ?? 0)) return { ...next, _v: (cur?._v ?? 0) + 1 };
    }
    throw new HttpError(409, "Someone else changed this at the same moment. Try again.");
  }

  const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

  // ---------- team trainings ----------
  async function createTeam(user, body) {
    const pack = cleanTeamPack(body.pack);
    need(pack.rules.length > 0, 400, "This training has no steps to share yet.");
    const at = now();
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const team = { code, owner: user, ...pack, version: 1, members: 0, createdAt: at, updatedAt: at, changes: [] };
      need(fits(team), 413, "This training is too big to share. Split it into smaller trainings.");
      if (await store.put(`TEAM#${code}`, "META", team, 0)) {
        await store.put(`USER#${user}`, `TEAM#${code}`, { code, role: "trainer", joinedAt: at });
        log("team-created");
        return teamView(team);
      }
    }
    throw new HttpError(503, "Couldn't make a join code. Try again.");
  }

  async function publish(user, code, body) {
    const pack = cleanTeamPack(body.pack);
    need(pack.rules.length > 0, 400, "A shared training needs at least one step.");
    let counts = { changed: [], added: [], removed: [] };
    const team = await update(`TEAM#${code}`, "META", (cur) => {
      need(cur, 404, "This training isn't shared anymore.", { code: "gone" });
      need(cur.owner === user, 403, "Only the trainer who shared this can change it.");
      counts = diffRules(cur.rules, pack.rules);
      const same = JSON.stringify({ ...pack }) === JSON.stringify({ title: cur.title, trainer: cur.trainer, place: cur.place, rules: cur.rules, questions: cur.questions });
      if (same) return null;
      const version = cur.version + 1;
      const change = { version, at: now(), ...counts };
      const { _v, ...rest } = cur;
      const next = { ...rest, ...pack, version, updatedAt: now(), changes: [...(cur.changes ?? []), change].slice(-20) };
      need(fits(next), 413, "This training is too big to share. Split it into smaller trainings.");
      return next;
    });
    log("team-published");
    return { ...teamView(team), changed: counts.changed.length, added: counts.added.length, removed: counts.removed.length };
  }

  const bump = (code, by) =>
    update(`TEAM#${code}`, "META", (cur) => {
      if (!cur) return null;
      const { _v, ...rest } = cur;
      return { ...rest, members: Math.max(0, (cur.members ?? 0) + by) };
    });
  /** What someone waiting to join may see: the training's name and trainer, never its steps. */
  const lobbyView = (t, status) => ({ status, code: t.code, title: t.title, trainer: t.trainer });

  /**
   * Ask to join. The trainer decides: nothing about the steps is sent until they let you in.
   * The ID token proves the email the trainer will see; `name` is how you'd like to be shown.
   */
  async function join(user, code, body) {
    need(under("join", user, joinsPerHour), 429, "Too many tries. Wait a while, then check the code with your trainer.");
    const team = await store.get(`TEAM#${code}`, "META");
    need(team, 404, "No training with that code. Check it with your trainer.", { code: "no-team" });
    need(team.owner !== user, 409, "That's a training you shared yourself.", { code: "own-team" });
    const link = await store.get(`USER#${user}`, `TEAM#${code}`);
    if (link?.role === "trainee") return { status: "member", ...teamView(team) };
    const who = await verifyId(body.idToken);
    need(who && who.sub === user, 401, "Sign in again, then try joining.", { code: "sign-in" });
    const name = str(body.name, 40);
    const at = now();
    // Open team: in right away (unless the trainer removed you, or it's full); the trainer still sees you on the team.
    if (team.open === true && link?.role !== "removed" && (team.members ?? 0) < OPEN_MAX) {
      await store.put(`TEAM#${code}`, `MEMBER#${user}`, { user, email: who.email, ...(name ? { name } : {}), at });
      await store.put(`USER#${user}`, `TEAM#${code}`, { code, role: "trainee", joinedAt: at });
      await store.del(`TEAM#${code}`, `REQ#${user}`);
      const fresh = await bump(code, 1);
      log("team-joined-open");
      return { status: "member", ...teamView(fresh ?? team) };
    }
    await store.put(`TEAM#${code}`, `REQ#${user}`, { user, email: who.email, ...(name ? { name } : {}), at });
    await store.put(`USER#${user}`, `TEAM#${code}`, { code, role: "pending", askedAt: at });
    log("team-join-requested");
    return lobbyView(team, "pending");
  }

  /** Trainer only: who is waiting, and who is in. */
  async function people(user, code) {
    const team = await store.get(`TEAM#${code}`, "META");
    need(team, 404, "This training isn't shared anymore.", { code: "gone" });
    need(team.owner === user, 403, "Only the trainer who shared this can see who's on the team.");
    const person = (r) => ({ id: r.user, email: r.email, ...(r.name ? { name: r.name } : {}), at: r.at });
    const requests = (await store.query(`TEAM#${code}`, "REQ#")).map(person).sort((a, b) => a.at - b.at);
    const members = (await store.query(`TEAM#${code}`, "MEMBER#")).map(person).sort((a, b) => a.at - b.at);
    return { requests, members, open: team.open === true };
  }

  /** Trainer only: "Let anyone with the code in". Turning it on also lets in everyone who is waiting. */
  async function setOpen(user, code, body) {
    const open = body.open === true;
    await update(`TEAM#${code}`, "META", (cur) => {
      need(cur, 404, "This training isn't shared anymore.", { code: "gone" });
      need(cur.owner === user, 403, "Only the trainer who shared this can change who gets in.");
      if ((cur.open === true) === open) return null;
      const { _v, ...rest } = cur;
      return { ...rest, open, updatedAt: now() };
    });
    if (open) {
      for (const r of await store.query(`TEAM#${code}`, "REQ#")) await approve(code, r);
    }
    log(open ? "team-opened" : "team-closed");
    return people(user, code);
  }

  async function approve(code, req) {
    const at = now();
    await store.put(`USER#${req.user}`, `TEAM#${code}`, { code, role: "trainee", joinedAt: at });
    await store.put(`TEAM#${code}`, `MEMBER#${req.user}`, { user: req.user, email: req.email, ...(req.name ? { name: req.name } : {}), at });
    await store.del(`TEAM#${code}`, `REQ#${req.user}`);
    await bump(code, 1);
  }

  /** Trainer only: let someone in, decline their request, or remove a member. */
  async function decide(user, code, id, action) {
    need(PERSON_ID.test(id), 404, "That person isn't on this training.");
    const team = await store.get(`TEAM#${code}`, "META");
    need(team, 404, "This training isn't shared anymore.", { code: "gone" });
    need(team.owner === user, 403, "Only the trainer who shared this can decide who joins.");
    const at = now();
    if (action === "approve") {
      const req = await store.get(`TEAM#${code}`, `REQ#${id}`);
      need(req, 404, "That request isn't waiting anymore.", { code: "no-request" });
      await approve(code, { ...req, user: id });
      log("team-approved");
    } else if (action === "decline") {
      const req = await store.get(`TEAM#${code}`, `REQ#${id}`);
      need(req, 404, "That request isn't waiting anymore.", { code: "no-request" });
      await store.del(`TEAM#${code}`, `REQ#${id}`);
      await store.put(`USER#${id}`, `TEAM#${code}`, { code, role: "declined", at });
      log("team-declined");
    } else {
      const m = await store.get(`TEAM#${code}`, `MEMBER#${id}`);
      need(m, 404, "That person isn't on this training.");
      await store.del(`TEAM#${code}`, `MEMBER#${id}`);
      await store.put(`USER#${id}`, `TEAM#${code}`, { code, role: "removed", at });
      await bump(code, -1);
      log("team-removed");
    }
    return people(user, code);
  }

  async function getTeam(user, code, since) {
    const team = await store.get(`TEAM#${code}`, "META");
    need(team, 404, "This training isn't shared anymore.", { code: "gone" });
    if (team.owner !== user) {
      const link = await store.get(`USER#${user}`, `TEAM#${code}`);
      if (link?.role === "pending") throw new HttpError(403, `Waiting for ${team.trainer} to let you in.`, { code: "pending" });
      if (link?.role === "declined") throw new HttpError(403, `${team.trainer} didn't let you in. Check with them.`, { code: "declined" });
      if (link?.role === "removed") throw new HttpError(403, `${team.trainer} removed you from this training.`, { code: "removed" });
      need(link?.role === "trainee", 403, "Join this training first.");
    }
    const v = Number(since);
    return { ...teamView(team), changes: Number.isFinite(v) ? (team.changes ?? []).filter((c) => c.version > v) : [] };
  }

  /** Leave a training, or take back a request that's still waiting. */
  async function leave(user, code) {
    const m = await store.get(`USER#${user}`, `TEAM#${code}`);
    if (!m || m.role === "trainer") return { ok: true };
    await store.del(`USER#${user}`, `TEAM#${code}`);
    if (m.role === "pending") await store.del(`TEAM#${code}`, `REQ#${user}`);
    if (m.role === "trainee") {
      await store.del(`TEAM#${code}`, `MEMBER#${user}`);
      await bump(code, -1);
    }
    return { ok: true };
  }

  async function stop(user, code) {
    const team = await store.get(`TEAM#${code}`, "META");
    need(team, 404, "This training isn't shared anymore.", { code: "gone" });
    need(team.owner === user, 403, "Only the trainer who shared this can stop sharing it.");
    for (const r of [...(await store.query(`TEAM#${code}`, "REQ#")), ...(await store.query(`TEAM#${code}`, "MEMBER#"))]) {
      await store.del(`TEAM#${code}`, r.sk);
    }
    await store.del(`TEAM#${code}`, "META");
    await store.del(`USER#${user}`, `TEAM#${code}`);
    log("team-stopped");
    return { ok: true };
  }

  async function myTeams(user) {
    const links = await store.query(`USER#${user}`, "TEAM#");
    const teams = [];
    for (const l of links) {
      const t = await store.get(`TEAM#${l.code}`, "META");
      if (!t) {
        teams.push({ code: l.code, role: l.role, gone: true });
        await store.del(`USER#${user}`, l.sk).catch(() => {});
        continue;
      }
      if (l.role === "trainer") {
        const requests = (await store.query(`TEAM#${t.code}`, "REQ#")).length;
        teams.push({ code: t.code, role: l.role, version: t.version, members: t.members ?? 0, requests, title: t.title, open: t.open === true });
      } else if (l.role === "trainee") teams.push({ code: t.code, role: l.role, version: t.version, members: t.members ?? 0, title: t.title });
      else teams.push({ code: t.code, role: l.role, title: t.title, trainer: t.trainer });
    }
    return { teams };
  }

  // ---------- coach data and keys for other apps ----------
  async function putCoach(user, body) {
    const packs = cleanPacks(body.packs);
    const questions = (Array.isArray(body.questions) ? body.questions : []).slice(0, 40).map((q) => str(q, 300)).filter(Boolean);
    const data = { packs, questions, updatedAt: now() };
    need(fits(data), 413, "Too many steps to share at once.");
    await store.put(`USER#${user}`, "COACH", data);
    return { ok: true, packs: packs.length };
  }

  async function createToken(user, body, here) {
    const existing = await store.query(`USER#${user}`, "TOKEN#");
    need(existing.length < MAX_TOKENS, 409, `You have ${MAX_TOKENS} keys already. Remove one first.`);
    const token = `fdc_${randomBytes(24).toString("base64url")}`;
    const hash = sha256(token);
    const id = hash.slice(0, 12);
    const label = str(body.label, 40) || "Another app";
    const at = now();
    await store.put(`TOKEN#${hash}`, "META", { user, id, label, createdAt: at }, 0);
    await store.put(`USER#${user}`, `TOKEN#${id}`, { id, hash, label, createdAt: at });
    log("token-created");
    return { id, token, mcpUrl: mcpUrl || (here ? `https://${here}/mcp` : "") };
  }

  async function listTokens(user) {
    const items = await store.query(`USER#${user}`, "TOKEN#");
    return { tokens: items.map((t) => ({ id: t.id, label: t.label, createdAt: t.createdAt })) };
  }

  async function revokeToken(user, id) {
    const t = await store.get(`USER#${user}`, `TOKEN#${id}`);
    need(t, 404, "That key is already gone.");
    await store.del(`TOKEN#${t.hash}`, "META");
    await store.del(`USER#${user}`, `TOKEN#${id}`);
    return { ok: true };
  }

  async function coachOff(user) {
    for (const t of await store.query(`USER#${user}`, "TOKEN#")) {
      await store.del(`TOKEN#${t.hash}`, "META");
      await store.del(`USER#${user}`, t.sk);
    }
    await store.del(`USER#${user}`, "COACH");
    return { ok: true };
  }

  // ---------- MCP (Streamable HTTP) ----------
  async function mcpUser(authorization) {
    const token = /^Bearer\s+(\S+)$/i.exec(String(authorization || ""))?.[1];
    if (!token) return null;
    if (token.startsWith("fdc_")) {
      const rec = await store.get(`TOKEN#${sha256(token)}`, "META");
      return rec?.user ?? null;
    }
    return verify(`Bearer ${token}`);
  }

  async function mcp(method, headers, rawBody) {
    if (!originOk(headers.origin)) {
      return rpcReply(403, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } });
    }
    if (method !== "POST") return { statusCode: 405, headers: { allow: "POST", "content-type": "application/json" }, body: JSON.stringify({ error: "This MCP server answers POST only (no SSE stream)." }) };
    const user = await mcpUser(headers.authorization);
    if (!user) {
      // RFC 6750: no error code when no credentials were sent; invalid_token when a key was sent but isn't valid.
      const sent = /^Bearer\s+\S+/i.test(String(headers.authorization || ""));
      return {
        statusCode: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": `Bearer realm="firstday-coach"${sent ? ', error="invalid_token"' : ""}, error_description="Make a key in FirstDay Go: More, Quiz me from other apps"`,
        },
        body: JSON.stringify({ error: sent ? "This FirstDay coach key isn't valid (it may have been removed)." : "A FirstDay coach key is required." }),
      };
    }
    const version = headers["mcp-protocol-version"];
    if (version && !SUPPORTED_VERSIONS.includes(version)) {
      return rpcReply(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${String(version).slice(0, 20)}` } });
    }
    need(under("mcp", user, perHour), 429, "Too many requests. Try again later.");
    let msg;
    try {
      msg = JSON.parse(rawBody || "");
    } catch {
      return rpcReply(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (Array.isArray(msg) || !msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      return rpcReply(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request: send one JSON-RPC 2.0 message per POST" } });
    }
    // Notifications and responses get 202 Accepted with no body.
    if (typeof msg.method !== "string" || msg.id === undefined || msg.id === null) return { statusCode: 202, headers: {}, body: "" };
    let data;
    const loadData = async () => (data ??= (await store.get(`USER#${user}`, "COACH")) ?? { packs: [], questions: [] });
    try {
      const result = await handleRequest(msg, { loadData });
      return rpcReply(200, { jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      if (e instanceof RpcError) return rpcReply(200, { jsonrpc: "2.0", id: msg.id, error: { code: e.code, message: e.message } });
      throw e;
    }
  }

  async function handle(event) {
    const method = event.requestContext?.http?.method ?? "GET";
    const path = (event.rawPath ?? "/").replace(/\/+$/, "") || "/";
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    need(raw.length <= 400_000, 413, "Too big");

    if (method === "GET" && path === "/health") return reply(200, { ok: true, coach: true, mcp: SUPPORTED_VERSIONS[0] });
    if (path === "/mcp") return mcp(method, headers, raw);

    const user = await verify(headers.authorization);
    need(user, 401, "Sign in required");
    need(under("api", user, perHour), 429, "Too many requests. Try again later.");
    let body = {};
    if (method === "POST" || method === "PUT") {
      try {
        body = JSON.parse(raw || "{}") ?? {};
      } catch {
        throw new HttpError(400, "Bad JSON");
      }
    }
    const team = /^\/teams\/([A-Z0-9]{6})(\/join|\/leave|\/people|\/settings)?$/.exec(path);
    const person = /^\/teams\/([A-Z0-9]{6})\/people\/([^/]{1,64})\/(approve|decline|remove)$/.exec(path);
    const tokenPath = /^\/coach\/tokens\/([a-f0-9]{12})$/.exec(path);
    const r = (v) => reply(200, v);

    if (method === "POST" && path === "/teams") return r(await createTeam(user, body));
    if (method === "GET" && path === "/me/teams") return r(await myTeams(user));
    if (team) {
      const [, code, sub] = team;
      need([...code].every((c) => CODE_ALPHABET.includes(c)), 404, "No training with that code. Check it with your trainer.", { code: "no-team" });
      if (method === "PUT" && !sub) return r(await publish(user, code, body));
      if (method === "GET" && !sub) return r(await getTeam(user, code, event.queryStringParameters?.since));
      if (method === "DELETE" && !sub) return r(await stop(user, code));
      if (method === "POST" && sub === "/join") return r(await join(user, code, body));
      if (method === "POST" && sub === "/leave") return r(await leave(user, code));
      if (method === "GET" && sub === "/people") return r(await people(user, code));
      if (method === "POST" && sub === "/settings") return r(await setOpen(user, code, body));
    }
    if (person && method === "POST") {
      const [, code, id, action] = person;
      need([...code].every((c) => CODE_ALPHABET.includes(c)), 404, "No training with that code.", { code: "no-team" });
      return r(await decide(user, code, decodeURIComponent(id), action));
    }
    if (method === "PUT" && path === "/coach/packs") return r(await putCoach(user, body));
    if (method === "POST" && path === "/coach/tokens") return r(await createToken(user, body, event.requestContext?.domainName));
    if (method === "GET" && path === "/coach/tokens") return r(await listTokens(user));
    if (method === "DELETE" && tokenPath) return r(await revokeToken(user, tokenPath[1]));
    if (method === "DELETE" && path === "/coach") return r(await coachOff(user));
    throw new HttpError(404, "Not found");
  }

  return async function handler(event) {
    try {
      return await handle(event);
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message, ...e.extra });
      // Never log training content; the error name is enough to debug.
      log(`failed: ${e?.name ?? "Error"}`);
      return reply(500, { error: "Something went wrong" });
    }
  };
}

const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rpcReply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
