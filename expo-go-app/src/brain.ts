import type { Analysis } from "./logic/analyze";
import type { Brain } from "./logic/types";

async function call<T>(brain: Pick<Brain, "url" | "code">, path: string, body?: unknown, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${brain.url.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-firstday-code": brain.code },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Wrong pairing code." : `Brain error ${res.status}`);
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
  health: (b: Pick<Brain, "url" | "code">) => call<{ ok: boolean; ai: boolean; bee: boolean }>(b, "/health", undefined, 8000),

  async analyze(b: Brain, text: string, now: number): Promise<Analysis> {
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

  async ask(b: Brain, question: string, notes: { id: string; text: string }[]) {
    const r = await call<Record<string, unknown>>(b, "/ask", { question, notes }, 20_000);
    const answer = str(r.answer);
    if (!answer) throw new Error("empty");
    return { answer, sourceIds: arr(r.sourceIds).map(str).filter(Boolean) };
  },

  async steps(b: Brain, task: string) {
    const r = await call<Record<string, unknown>>(b, "/steps", { task });
    return { steps: arr(r.steps).map(str).filter(Boolean) };
  },

  async grade(b: Brain, input: { situation: string; instruction: string; quote: string; answer: string }) {
    const r = await call<Record<string, unknown>>(b, "/grade", input);
    if (typeof r.pass !== "boolean") throw new Error("bad grade");
    return { pass: r.pass, feedback: str(r.feedback) };
  },

  beeList: (b: Brain) => call<{ conversations: { id: string; title: string; at: number }[] }>(b, "/bee/conversations"),

  beeGet: (b: Brain, id: string) =>
    call<{ id: string; title: string; at: number; text: string }>(b, `/bee/conversations/${encodeURIComponent(id)}`),
};
