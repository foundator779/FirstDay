import type { Analysis } from "./logic/analyze";
import { getAccessToken } from "./auth";
import { cleanSnapshot } from "./logic/beeSync";
import type { BeeInboxItem, BeeSnapshot, Brain } from "./logic/types";

/**
 * Where an AI or Bee request goes: the brain on your computer (url + pairing code) or the AWS endpoint.
 * The Cognito access token is sent only when `withToken` is set: always for the AWS endpoint, and for a
 * brain only if it was set up to require accounts. It never goes to a brain that doesn't need it.
 */
export type Target = { url: string; code?: string; withToken?: boolean };

async function call<T>(brain: Target, path: string, body?: unknown, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = brain.withToken ? await getAccessToken().catch(() => undefined) : undefined;
    const res = await fetch(`${brain.url.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(brain.code ? { "x-firstday-code": brain.code } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.json().then((j: { error?: unknown }) => (typeof j?.error === "string" ? j.error : "")).catch(() => "");
      if (res.status === 401 && brain.code && !detail.includes("Sign in")) throw new Error("Wrong pairing code.");
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Local time with its UTC offset, e.g. 2026-10-03T12:26:00-07:00, so the AI sets due times in the user's zone. */
export function localIso(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  if (!/:\d+/.test(u.replace(/^https?:\/\//i, ""))) u = `${u.replace(/\/+$/, "")}:8790`;
  return u.replace(/\/+$/, "");
}

export const brainApi = {
  health: (b: Target) => call<{ ok: boolean; ai: boolean; bee?: boolean; live?: boolean; accounts?: boolean }>(b, "/health", undefined, 8000),

  async analyze(b: Target, text: string, now: number): Promise<Analysis> {
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {}
    const raw = await call<Record<string, unknown>>(b, "/analyze", { text, now: localIso(now), timeZone: zone }, 45_000);
    const kinds = ["me", "people", "work", "other"] as const;
    return {
      title: str(raw.title) || "Conversation",
      summary: arr(raw.summary).map(str).filter(Boolean).slice(0, 3),
      todos: arr(raw.todos).flatMap((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        const textOut = str(o.text);
        if (!textOut) return [];
        const due = str(o.dueISO) ? Date.parse(str(o.dueISO)) : NaN;
        const quote = str(o.quote) || textOut;
        return [Number.isFinite(due) && due > now ? { text: textOut, quote, due } : { text: textOut, quote }];
      }),
      memories: arr(raw.memories).flatMap((m) => {
        const o = (m ?? {}) as Record<string, unknown>;
        const t = str(o.text);
        const kind = kinds.find((k) => k === o.kind) ?? "other";
        return t ? [{ text: t, kind, quote: str(o.quote) || t }] : [];
      }),
      rules: arr(raw.rules).flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const situation = str(o.situation);
        const action = str(o.action);
        return situation && action ? [{ situation, action, quote: str(o.quote) || action, isUpdate: o.isUpdate === true }] : [];
      }),
      questions: arr(raw.questions).map(str).filter(Boolean),
    };
  },

  async ask(b: Target, question: string, notes: { id: string; text: string }[]) {
    const r = await call<Record<string, unknown>>(b, "/ask", { question, notes }, 20_000);
    const answer = str(r.answer);
    if (!answer) throw new Error("empty");
    return { answer, sourceIds: arr(r.sourceIds).map(str).filter(Boolean) };
  },

  async steps(b: Target, task: string) {
    const r = await call<Record<string, unknown>>(b, "/steps", { task });
    return { steps: arr(r.steps).map(str).filter(Boolean) };
  },

  async grade(b: Target, input: { situation: string; instruction: string; quote: string; answer: string }) {
    const r = await call<Record<string, unknown>>(b, "/grade", input);
    if (typeof r.pass !== "boolean") throw new Error("bad grade");
    return { pass: r.pass, feedback: str(r.feedback) };
  },

  beeList: (b: Brain) => call<{ conversations: { id: string; title: string; at: number; ready?: boolean }[] }>(b, "/bee/conversations"),

  beeGet: (b: Brain, id: string) =>
    call<{ id: string; title: string; at: number; text: string }>(b, `/bee/conversations/${encodeURIComponent(id)}`),

  // ---- Two-way Bee sync (through the brain's Bee CLI) ----
  async beeSync(b: Brain): Promise<BeeSnapshot> {
    return cleanSnapshot(await call<unknown>(b, "/bee/sync", undefined, 45_000));
  },
  async beeWrite(b: Brain, path: BeeWritePath, body: Record<string, unknown>): Promise<{ id?: string }> {
    // Long timeout: on Windows the first write also starts `bee proxy` on the computer.
    const r = await call<Record<string, unknown>>(b, path, body, 35_000);
    return typeof r?.id === "string" && r.id ? { id: r.id } : {};
  },
  async beeInbox(b: Brain): Promise<{ items: BeeInboxItem[]; todosChangedAt: number; live: boolean }> {
    const r = await call<Record<string, unknown>>(b, "/bee/inbox", undefined, 8000);
    const items = arr(r.items).flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const id = str(o.id);
      return id ? [{ id: id.slice(0, 100), title: str(o.title).slice(0, 120) || "Bee conversation", at: Number(o.at) || Date.now() }] : [];
    });
    return { items, todosChangedAt: Number(r.todosChangedAt) || 0, live: r.live === true };
  },
  beeAck: (b: Brain, ids: string[]) => call<{ ok: boolean }>(b, "/bee/inbox/ack", { ids }),
  syncPacks: (b: Brain, packs: unknown[]) => call<{ ok: boolean }>(b, "/sync/packs", { packs }),
};

export type BeeWritePath =
  | "/bee/facts/confirm"
  | "/bee/facts/delete"
  | "/bee/facts/update"
  | "/bee/facts/create"
  | "/bee/todos/create"
  | "/bee/todos/complete"
  | "/bee/suggestions/accept"
  | "/bee/suggestions/dismiss";
