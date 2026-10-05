// Merges what the brain read from Bee into the app, without ever overwriting the user's own choices.
// Pure functions so they can be tested without a phone or a Bee.
import { uid } from "./text";
import type { AppState, BeeSnapshot, BeeState, Memory, Todo } from "./types";

export const EMPTY_BEE: BeeState = { daily: null, insights: [], syncedAt: 0, inbox: [], notified: [], todosChangedAt: 0, hidden: [] };

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type MergeResult = { state: AppState; added: { memories: number; todos: number; suggestions: number }; failed: string[] };

/**
 * Safety rules:
 * - A deletion in Bee is mirrored only when the brain saw Bee's whole list (`snap.complete`), and never for
 *   an item linked after this sync started (`startedAt`).
 * - Something the user wrote here and then sent to Bee is unlinked, not deleted, if it disappears from Bee.
 * - A Bee item whose text matches an unlinked item here is linked to it instead of imported twice.
 * - A to-do is ticked only when Bee's completed flag changes, so unticking here sticks.
 */
export function mergeBee(state: AppState, snap: BeeSnapshot, now: number, startedAt = now): MergeResult {
  const added = { memories: 0, todos: 0, suggestions: 0 };
  const hidden = new Set(state.bee.hidden);
  const settled = (linkedAt?: number) => (linkedAt ?? 0) < startedAt;

  // ---- Facts <-> memories ----
  let memories: Memory[] = state.memories;
  if (snap.facts) {
    const byId = new Map(snap.facts.map((f) => [f.id, f]));
    memories = memories.flatMap((m): Memory[] => {
      if (!m.beeFactId) return [m];
      const f = byId.get(m.beeFactId);
      if (!f) {
        if (!snap.complete.facts || !settled(m.linkedAt)) return [m];
        if (m.fromBee) return [];
        const { beeFactId: _f, linkedAt: _l, ...mine } = m;
        return [mine];
      }
      // Confirmed in Bee confirms it here. A text the user edited here (previousText) wins.
      return [{ ...m, text: m.previousText !== undefined ? m.text : f.text, suggested: m.suggested && !f.confirmed }];
    });
    const linked = new Set(memories.map((m) => m.beeFactId).filter(Boolean));
    const fresh: Memory[] = [];
    for (const f of snap.facts) {
      if (linked.has(f.id) || hidden.has(`fact:${f.id}`)) continue;
      const twin = memories.findIndex((m) => !m.beeFactId && norm(m.text) === norm(f.text));
      if (twin >= 0) {
        memories = memories.map((m, i) => (i === twin ? { ...m, beeFactId: f.id, linkedAt: now } : m));
        continue;
      }
      fresh.push({ id: uid("mem"), text: f.text, kind: "me", suggested: !f.confirmed, at: now, beeFactId: f.id, fromBee: true, linkedAt: now, quote: f.text });
    }
    added.memories = fresh.length;
    memories = [...fresh, ...memories];
  }

  // ---- To-dos <-> to-dos ----
  let todos: Todo[] = state.todos;
  if (snap.todos) {
    const byId = new Map(snap.todos.map((t) => [t.id, t]));
    todos = todos.map((t) => {
      const b = t.beeTodoId ? byId.get(t.beeTodoId) : undefined;
      if (!b) return t;
      if (b.completed && !t.beeDone) return t.bucket === "done" ? { ...t, beeDone: true } : { ...t, bucket: "done", doneAt: now, beeDone: true };
      if (!b.completed && t.beeDone) return { ...t, beeDone: false };
      return t;
    });
    const linked = new Set(todos.map((t) => t.beeTodoId).filter(Boolean));
    const fresh: Todo[] = [];
    for (const b of snap.todos) {
      if (b.completed || linked.has(b.id) || hidden.has(`todo:${b.id}`)) continue;
      const twin = todos.findIndex((t) => !t.beeTodoId && !t.beeSuggestionId && t.bucket !== "done" && norm(t.text) === norm(b.text));
      if (twin >= 0) {
        todos = todos.map((t, i) => (i === twin ? { ...t, beeTodoId: b.id, linkedAt: now, beeDone: false } : t));
        continue;
      }
      const due = b.alarmAt && b.alarmAt > now ? b.alarmAt : undefined;
      fresh.push({
        id: uid("todo"), text: b.text, bucket: due && due - now < 36 * 3600_000 ? "now" : "later", suggested: false,
        steps: [], createdAt: now, beeTodoId: b.id, fromBee: true, linkedAt: now, beeDone: false, quote: b.text,
        ...(due ? { due, beeAlarm: true } : {}),
      });
    }
    added.todos = fresh.length;
    todos = [...fresh, ...todos];
  }

  // ---- Bee's to-do suggestions -> suggested to-dos ----
  if (snap.suggestions) {
    const live = new Set(snap.suggestions.map((x) => x.id));
    // Accepted or skipped in the Bee app: gone there, so gone here (only when we saw the whole list).
    if (snap.complete.suggestions) {
      todos = todos.filter((t) => !(t.suggested && t.beeSuggestionId && !live.has(t.beeSuggestionId) && settled(t.linkedAt)));
    }
    const linked = new Set(todos.map((t) => t.beeSuggestionId).filter(Boolean));
    const fresh: Todo[] = snap.suggestions
      .filter((x) => !linked.has(x.id) && !hidden.has(`sugg:${x.id}`))
      .map((x) => ({
        id: uid("todo"), text: x.text, bucket: "later", suggested: true, steps: [], createdAt: now,
        beeSuggestionId: x.id, fromBee: true, linkedAt: now, quote: x.text,
      }));
    added.suggestions = fresh.length;
    todos = [...fresh, ...todos];
  }

  const bee: BeeState = {
    ...state.bee,
    daily: snap.daily ? { date: snap.daily.date, lines: snap.daily.lines.slice(0, 3) } : state.bee.daily,
    insights: snap.insights ? snap.insights.map((i) => i.text).slice(0, 3) : state.bee.insights,
    syncedAt: now,
    lastError: snap.failed.length ? `Couldn't read ${snap.failed.join(", ")} from Bee.` : undefined,
  };
  return { state: { ...state, memories, todos, bee }, added, failed: snap.failed };
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown): Record<string, unknown>[] | null =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : null;

/** Validates the brain's /bee/sync reply; anything malformed is dropped, never trusted. */
export function cleanSnapshot(raw: unknown): BeeSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const facts = list(r.facts);
  const todos = list(r.todos);
  const suggestions = list(r.suggestions);
  const insights = list(r.insights);
  const daily = r.daily && typeof r.daily === "object" ? (r.daily as Record<string, unknown>) : null;
  return {
    facts: facts && facts.map((f) => ({ id: s(f.id, 100), text: s(f.text, 500), confirmed: f.confirmed === true })).filter((f) => f.id && f.text),
    todos: todos && todos
      .map((t) => ({ id: s(t.id, 100), text: s(t.text, 300), completed: t.completed === true, ...(Number.isFinite(t.alarmAt) ? { alarmAt: Number(t.alarmAt) } : {}) }))
      .filter((t) => t.id && t.text),
    suggestions: suggestions && suggestions.map((x) => ({ id: s(x.id, 100), text: s(x.text, 300) })).filter((x) => x.id && x.text),
    daily: daily && Array.isArray(daily.lines)
      ? { date: s(daily.date, 40), lines: (daily.lines as unknown[]).map((l) => s(l, 300)).filter(Boolean).slice(0, 3) }
      : null,
    insights: insights && insights.map((i) => ({ id: s(i.id, 100), text: s(i.text, 300) })).filter((i) => i.text),
    complete: {
      facts: (r.complete as Record<string, unknown> | undefined)?.facts === true,
      todos: (r.complete as Record<string, unknown> | undefined)?.todos === true,
      suggestions: (r.complete as Record<string, unknown> | undefined)?.suggestions === true,
    },
    failed: Array.isArray(r.failed) ? (r.failed as unknown[]).map((f) => s(f, 30)).filter(Boolean) : [],
  };
}

/** Packs in the shape the brain keeps for the FirstDay coach Agent Skill. */
export function packsForCoach(state: Pick<AppState, "packs" | "progress">) {
  return state.packs.map((p) => ({
    id: p.id, title: p.title, trainer: p.trainer, sample: p.sample, questions: p.questions,
    rules: p.rules.map((r) => ({
      id: r.id, situation: r.situation, action: r.action, quote: r.quote,
      ...(r.changedFrom ? { changedFrom: r.changedFrom } : {}), level: state.progress[r.id]?.level ?? 0,
    })),
  }));
}
