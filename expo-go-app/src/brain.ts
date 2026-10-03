import type { Analysis } from "./logic/analyze";
import type { Brain } from "./logic/types";

async function call<T>(brain: Pick<Brain, "url" | "code">, path: string, body?: unknown, timeoutMs = 50_000): Promise<T> {
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

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  if (!/:\d+/.test(u.replace(/^https?:\/\//i, ""))) u = `${u.replace(/\/+$/, "")}:8790`;
  return u.replace(/\/+$/, "");
}

export const brainApi = {
  health: (b: Pick<Brain, "url" | "code">) => call<{ ok: boolean; ai: boolean; bee: boolean }>(b, "/health", undefined, 8000),

  async analyze(b: Brain, text: string, now: number): Promise<Analysis> {
    type Raw = Omit<Analysis, "todos"> & { todos: { text: string; dueISO?: string; quote: string }[] };
    const raw = await call<Raw>(b, "/analyze", { text, now: new Date(now).toISOString() });
    return {
      title: raw.title || "Conversation",
      summary: (raw.summary ?? []).slice(0, 3),
      todos: (raw.todos ?? []).map((t) => {
        const due = t.dueISO ? Date.parse(t.dueISO) : NaN;
        return Number.isFinite(due) && due > now ? { text: t.text, quote: t.quote, due } : { text: t.text, quote: t.quote };
      }),
      memories: raw.memories ?? [],
      rules: raw.rules ?? [],
      questions: raw.questions ?? [],
    };
  },

  ask: (b: Brain, question: string, notes: { id: string; text: string }[]) =>
    call<{ answer: string; sourceIds: string[] }>(b, "/ask", { question, notes }),

  steps: (b: Brain, task: string) => call<{ steps: string[] }>(b, "/steps", { task }),

  grade: (b: Brain, input: { situation: string; instruction: string; quote: string; answer: string }) =>
    call<{ pass: boolean; feedback: string }>(b, "/grade", input),

  beeList: (b: Brain) => call<{ conversations: { id: string; title: string; at: number }[] }>(b, "/bee/conversations"),

  beeGet: (b: Brain, id: string) =>
    call<{ id: string; title: string; at: number; text: string }>(b, `/bee/conversations/${encodeURIComponent(id)}`),
};
