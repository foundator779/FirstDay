// Everything the brain does with Bee, through the signed-in Bee CLI (docs.bee.computer/docs/cli).
// Reads: conversations, facts, to-dos, to-do suggestions, daily summaries, insights.
// Writes back: confirm / fix / forget facts, create / complete to-dos, accept / dismiss suggestions.
// Live: `bee stream --json` wakes the watcher; `bee conversations list` is the source of truth.
import { execFile, spawn } from "node:child_process";

const BEE = process.env.BEE_CLI_PATH || "bee";
const WINDOWS = process.platform === "win32";
const PROXY_PORT = Number(process.env.FIRSTDAY_BEE_PROXY_PORT || 8791);
const SAFE_ARG = /^[A-Za-z0-9._:=-]+$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class BeeError extends Error {}

const command = () => (WINDOWS && /\s/.test(BEE) && !BEE.startsWith('"') ? `"${BEE}"` : BEE);

/**
 * Runs the Bee CLI and parses its JSON output.
 * On Windows the CLI can be a .cmd shim that Node only starts through a shell, so there every
 * argument must match a strict pattern (no spaces or shell characters). Free text never goes
 * through the shell: on Windows it is sent to Bee's local HTTP proxy instead (see beeText).
 */
export function runBee(args, { allowText = false } = {}) {
  const ok = args.every((a) => typeof a === "string" && !a.includes("\0") && (SAFE_ARG.test(a) || (allowText && !WINDOWS)));
  if (!ok) return Promise.reject(new BeeError("bee-bad-args"));
  return new Promise((resolve, reject) => {
    execFile(command(), args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, shell: WINDOWS, windowsHide: true }, (err, stdout) => {
      if (err) return reject(new BeeError("bee-cli"));
      const out = String(stdout).trim();
      if (!out) return resolve({});
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new BeeError("bee-json"));
      }
    });
  });
}

export const validId = (id) => typeof id === "string" && SAFE_ID.test(id);
const cleanText = (t) => String(t ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);

// ---------- parsing helpers (field names from the Bee docs; wrapper keys vary, so accept a few) ----------

export function listOf(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const k of keys) if (Array.isArray(payload[k])) return payload[k];
  for (const v of Object.values(payload)) if (Array.isArray(v) && v.every((x) => x && typeof x === "object")) return v;
  return [];
}

export function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return toMs(n);
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : undefined;
  }
  return undefined;
}

export function firstLine(v) {
  return typeof v === "string" ? v.split("\n").map((x) => x.replace(/^[#*\-\s]+/, "").trim()).find(Boolean) || "" : "";
}

const textOf = (o, keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((x, part) => (x && typeof x === "object" ? x[part] : undefined), o);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

const idOf = (o) => (o && (typeof o.id === "string" || typeof o.id === "number") ? String(o.id) : "");

export function isProcessed(state) {
  if (state === undefined || state === null) return true;
  return ["ready", "processed", "complete", "completed"].includes(String(state).toLowerCase());
}

export function speakerName(s) {
  if (!s) return "Speaker";
  if (typeof s === "string") return /^(user|me|self|0)$/i.test(s.trim()) ? "Me" : s.trim() || "Speaker";
  if (s.is_user || s.isUser) return "Me";
  const label = typeof s.label === "string" ? s.label.trim() : "";
  if (/^(user|me|self)$/i.test(label)) return "Me";
  return (typeof s.name === "string" && s.name.trim()) || label || "Speaker";
}

/** Bullet-ish lines from a markdown summary, without headings or markers. */
export function summaryLines(text, max = 3) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^[#>*\-•\d.)\s]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.split(/\s+/).length >= 3)
    .slice(0, max);
}

// ---------- conversations ----------

export function parseConversationList(out) {
  return listOf(out, ["conversations", "items", "data"])
    .filter((c) => idOf(c))
    .map((c) => ({
      id: idOf(c),
      title: firstLine(c.short_summary) || firstLine(c.summary) || "Bee conversation",
      at: toMs(c.start_time ?? c.created_at) ?? Date.now(),
      ready: isProcessed(c.state ?? c.status),
    }));
}

export async function listConversations(limit = 25) {
  return parseConversationList(await runBee(["conversations", "list", "--limit", String(limit), "--json"]));
}

/**
 * Mirrors the rules proven on real recordings in services/bee-bridge: use the final (non-realtime)
 * transcript, keep exact text, order by the reported `spoken_at` time when present (else `start`),
 * keep original order for ties, never invent timing.
 */
export function parseConversation(c, id) {
  if (!c || String(c.id) !== id) throw new BeeError("bee-mismatch");
  if (!isProcessed(c.state ?? c.status)) throw new BeeError("not-ready");
  const transcriptions = Array.isArray(c.transcriptions) ? c.transcriptions : [];
  const t = transcriptions.filter((x) => x && x.realtime !== true)[0];
  const utterances = Array.isArray(t?.utterances) ? t.utterances : [];
  const lines = utterances
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => typeof u?.text === "string" && u.text.trim())
    .map(({ u, i }) => ({
      i,
      when: Number.isFinite(u.spoken_at) ? u.spoken_at : (toMs(u.start) ?? 0),
      line: `${speakerName(u.speaker)}: ${u.text.trim()}`,
    }))
    .sort((a, b) => a.when - b.when || a.i - b.i)
    .map((x) => x.line);
  if (!lines.length) throw new BeeError("not-ready");
  return {
    id,
    title: firstLine(c.short_summary) || firstLine(c.summary) || "Bee conversation",
    at: toMs(c.start_time ?? c.created_at) ?? Date.now(),
    text: lines.join("\n"),
  };
}

export async function getConversation(id) {
  if (!validId(id)) throw new BeeError("bee-bad-args");
  return parseConversation(await runBee(["conversations", "get", id, "--json"]), id);
}

// ---------- facts, to-dos, suggestions, daily, insights ----------

export function parseFacts(out) {
  return listOf(out, ["facts", "items", "data"])
    .map((f) => ({ id: idOf(f), text: textOf(f, ["text", "fact", "content"]), confirmed: f.confirmed === true }))
    .filter((f) => f.id && f.text);
}

export function parseTodos(out) {
  return listOf(out, ["todos", "items", "data"])
    .map((t) => ({
      id: idOf(t),
      text: textOf(t, ["text", "title", "content"]),
      completed: t.completed === true,
      ...(toMs(t.alarm_at ?? t.alarmAt) ? { alarmAt: toMs(t.alarm_at ?? t.alarmAt) } : {}),
    }))
    .filter((t) => t.id && t.text);
}

export function parseSuggestions(out) {
  return listOf(out, ["suggestions", "todo_suggestions", "todoSuggestions", "items", "data"])
    .map((s) => ({ id: idOf(s), text: textOf(s, ["text", "title", "content", "suggestion", "todo.text"]) }))
    .filter((s) => s.id && s.text);
}

export function parseDaily(out) {
  const d = listOf(out, ["daily", "daily_summaries", "dailySummaries", "summaries", "items", "data"])[0];
  if (!d) return null;
  const body = textOf(d, ["summary", "short_summary", "text", "content", "markdown"]);
  const lines = summaryLines(body);
  if (!lines.length) return null;
  return { id: idOf(d), date: textOf(d, ["date", "day"]) || "", at: toMs(d.date ?? d.created_at ?? d.start_time) ?? Date.now(), lines };
}

export function parseInsights(out) {
  return listOf(out, ["insights", "items", "data"])
    .map((i) => ({ id: idOf(i), text: firstLine(textOf(i, ["text", "title", "summary", "content", "insight"])) }))
    .filter((i) => i.id && i.text)
    .slice(0, 3);
}

/**
 * A list the app may mirror deletions from. Unlike listOf, an empty or unrecognised reply is an error,
 * never "the user has nothing", and `complete` is true only when Bee says there's no next page.
 */
export function strictPage(payload, keys, limit) {
  let list = null;
  if (Array.isArray(payload)) list = payload;
  else if (payload && typeof payload === "object") for (const k of keys) if (Array.isArray(payload[k])) list = list ?? payload[k];
  if (!list) throw new BeeError("bee-shape");
  const more = !Array.isArray(payload) && !!(payload.next_cursor || payload.nextCursor || payload.has_more || payload.hasMore);
  return { list, complete: !more && list.length < limit };
}

const page = (args, keys, limit, parse) =>
  runBee([...args, "--limit", String(limit), "--json"]).then((out) => {
    const { list, complete } = strictPage(out, keys, limit);
    return { items: parse(list), complete };
  });

/** One round trip for the app's sync: every section is optional so one failure doesn't block the rest. */
export async function syncSnapshot() {
  const [facts, todos, suggestions, daily, insights] = await Promise.allSettled([
    page(["facts", "list"], ["facts", "items", "data"], 100, parseFacts),
    page(["todos", "list"], ["todos", "items", "data"], 100, parseTodos),
    page(["todos", "suggestions"], ["suggestions", "todo_suggestions", "todoSuggestions", "items", "data"], 50, parseSuggestions),
    runBee(["daily", "list", "--limit", "1", "--json"]).then(parseDaily),
    runBee(["insights", "list", "--limit", "5", "--json"]).then(parseInsights),
  ]);
  const value = (r) => (r.status === "fulfilled" ? r.value : null);
  return {
    facts: value(facts)?.items ?? null,
    todos: value(todos)?.items ?? null,
    suggestions: value(suggestions)?.items ?? null,
    daily: value(daily),
    insights: value(insights),
    // The app only mirrors a deletion from Bee when it saw Bee's whole list.
    complete: { facts: value(facts)?.complete === true, todos: value(todos)?.complete === true, suggestions: value(suggestions)?.complete === true },
    failed: ["facts", "todos", "suggestions", "daily", "insights"].filter((_, i) => [facts, todos, suggestions, daily, insights][i].status === "rejected"),
  };
}

// ---------- write-backs ----------

const createdId = (out) => idOf(out) || idOf(out?.fact) || idOf(out?.todo) || idOf(listOf(out, ["facts", "todos", "items"])[0]) || "";

let proxy = null;
async function proxyFetch(method, path, body) {
  const base = `http://127.0.0.1:${PROXY_PORT}`;
  const tryFetch = () =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  if (!proxy || proxy.exitCode !== null) {
    proxy = spawn(command(), ["proxy", "--port", String(PROXY_PORT)], { shell: WINDOWS, windowsHide: true, stdio: "ignore" });
    proxy.on("error", () => (proxy = null));
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        await fetch(base, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {}
    }
  }
  const res = await tryFetch();
  if (!res.ok) throw new BeeError("bee-cli");
  return res.json().catch(() => ({}));
}

/** A Bee write that carries free text: CLI arguments on macOS/Linux, the local proxy on Windows. */
async function beeText(cliArgs, method, path, body) {
  return WINDOWS ? proxyFetch(method, path, body) : runBee(cliArgs, { allowText: true });
}

export const beeWrites = {
  confirmFact: (id) => (validId(id) ? runBee(["facts", "confirm", id, "--json"]) : Promise.reject(new BeeError("bee-bad-args"))),
  deleteFact: (id) => (validId(id) ? runBee(["facts", "delete", id, "--json"]) : Promise.reject(new BeeError("bee-bad-args"))),
  async updateFact(id, text) {
    const t = cleanText(text);
    if (!validId(id) || !t) throw new BeeError("bee-bad-args");
    await beeText(["facts", "update", id, "--text", t, "--json"], "PUT", `/v1/facts/${id}`, { text: t });
    return {};
  },
  async createFact(text) {
    const t = cleanText(text);
    if (!t) throw new BeeError("bee-bad-args");
    return { id: createdId(await beeText(["facts", "create", "--text", t, "--json"], "POST", "/v1/facts", { text: t })) };
  },
  async createTodo(text, alarmAt) {
    const t = cleanText(text);
    if (!t) throw new BeeError("bee-bad-args");
    const iso = Number.isFinite(alarmAt) ? new Date(alarmAt).toISOString() : undefined;
    const args = ["todos", "create", "--text", t, ...(iso ? ["--alarm-at", iso] : []), "--json"];
    return { id: createdId(await beeText(args, "POST", "/v1/todos", { text: t, ...(iso ? { alarm_at: iso } : {}) })) };
  },
  completeTodo: (id) => (validId(id) ? runBee(["todos", "complete", id, "--json"]) : Promise.reject(new BeeError("bee-bad-args"))),
  async acceptSuggestion(id) {
    if (!validId(id)) throw new BeeError("bee-bad-args");
    return { id: createdId(await runBee(["todos", "accept-suggestion", id, "--json"])) };
  },
  dismissSuggestion: (id) => (validId(id) ? runBee(["todos", "dismiss-suggestion", id, "--json"]) : Promise.reject(new BeeError("bee-bad-args"))),
};

// ---------- live watcher ----------

/**
 * Notices new processed Bee conversations soon after they finish.
 * `bee stream --json` is only a wake-up signal (its event payloads aren't documented in detail);
 * the processed conversation list is the source of truth, checked on each wake-up and every 90 s.
 */
export function startWatcher({ seen, onNew, onTodosChanged, log = () => {} }) {
  let timer = null;
  let checking = false;
  let backoff = 30_000;
  let stopped = false;
  let child = null;

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const list = await listConversations(15);
      const fresh = list.filter((c) => c.ready && !seen.has(c.id));
      if (seen.size === 0) {
        // First run: remember what already exists so only new conversations count as new.
        list.filter((c) => c.ready).forEach((c) => seen.add(c.id));
        onNew([], true);
      } else if (fresh.length) {
        fresh.forEach((c) => seen.add(c.id));
        onNew(fresh, false);
      }
    } catch {
      // Bee unreachable; try again on the next tick.
    }
    checking = false;
  }

  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 8000);
  };

  function listen() {
    if (stopped) return;
    try {
      child = spawn(command(), ["stream", "--json"], { shell: WINDOWS, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return;
    }
    let buf = "";
    child.stdout.on("data", (chunk) => {
      backoff = 30_000;
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let type = "";
        try {
          const ev = JSON.parse(line);
          type = String(ev.type ?? ev.event ?? ev.name ?? "");
        } catch {
          type = line;
        }
        if (/conversation/i.test(type)) soon();
        if (/todo/i.test(type)) onTodosChanged();
      }
    });
    child.on("error", () => {});
    child.on("exit", () => {
      if (stopped) return;
      log("Bee stream ended; reconnecting");
      setTimeout(listen, backoff);
      backoff = Math.min(backoff * 2, 300_000);
    });
  }

  void check();
  listen();
  const poll = setInterval(check, 90_000);
  return () => {
    stopped = true;
    clearInterval(poll);
    clearTimeout(timer);
    child?.kill();
    proxy?.kill();
  };
}
