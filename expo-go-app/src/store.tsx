import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import { brainApi } from "./brain";
import { cancelReminder, remind, setHaptics } from "./device";
import { analyzeLocally, sentencesOf, type Analysis } from "./logic/analyze";
import { askLocally } from "./logic/ask";
import { matchUpdates, ruleFromCandidate } from "./logic/extract";
import { SAMPLE_CONVERSATION, samplePacks } from "./logic/samples";
import { tinySteps } from "./logic/steps";
import { dayKey, keywordsFor, uid } from "./logic/text";
import { nextProgress } from "./logic/training";
import type {
  AppState, Brain, ChatMessage, Conversation, Memory, Pack, Resume, Settings, SuggestedRule, Todo,
} from "./logic/types";
import { loadRaw, saveNow, saveSoon, wipe } from "./storage";

const DEFAULT_SETTINGS: Settings = {
  cardsPerSession: 3,
  answerStyle: "choices",
  focusMinutes: 0,
  readAloud: false,
  bigText: false,
  haptics: true,
  nudges: true,
};

function applyAnalysis(state: AppState, convo: Conversation, a: Analysis, now: number): AppState {
  const todos: Todo[] = a.todos.map((t) => ({
    id: uid("todo"), text: t.text, bucket: t.due && t.due - now < 36 * 3600_000 ? "now" : "later", suggested: true,
    steps: [], fromId: convo.id, quote: t.quote, createdAt: now, ...(t.due ? { due: t.due } : {}),
  }));
  for (const q of a.questions) {
    todos.push({ id: uid("todo"), text: `Ask your trainer: ${q}`, bucket: "later", suggested: true, steps: [], fromId: convo.id, quote: q, createdAt: now });
  }
  const memories: Memory[] = a.memories.map((m) => ({
    id: uid("mem"), text: m.text, kind: m.kind, suggested: true, fromId: convo.id, quote: m.quote, at: now,
  }));
  const rules: SuggestedRule[] = a.rules.map((r) => ({ id: uid("sr"), fromId: convo.id, situation: r.situation, action: r.action, quote: r.quote }));
  return {
    ...state,
    conversations: [convo, ...state.conversations],
    todos: [...todos, ...state.todos],
    memories: [...memories, ...state.memories],
    suggestedRules: [...rules, ...state.suggestedRules],
  };
}

function initialState(now: number): AppState {
  const base: AppState = {
    version: 2,
    packs: samplePacks(now),
    progress: {},
    settings: DEFAULT_SETTINGS,
    resume: null,
    today: { date: dayKey(now), count: 0 },
    conversations: [],
    todos: [],
    memories: [],
    chat: [],
    suggestedRules: [],
    brain: null,
    onboarded: false,
  };
  const a = analyzeLocally(SAMPLE_CONVERSATION.text, now);
  const convo: Conversation = {
    id: "sample-convo", title: SAMPLE_CONVERSATION.title, at: now - 2 * 3600_000, source: "sample",
    text: SAMPLE_CONVERSATION.text, summary: a.summary, analyzedBy: "phone",
  };
  return applyAnalysis(base, convo, a, now);
}

function migrate(raw: unknown, now: number): AppState {
  const s = raw as Partial<AppState> | null;
  if (!s || s.version !== 2 || !Array.isArray(s.packs)) return initialState(now);
  return { ...initialState(now), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } } as AppState;
}

export type CaptureInput = { text: string; source: Conversation["source"]; title?: string; at?: number; beeId?: string };

function makeActions(get: () => AppState, set: (fn: (s: AppState) => AppState) => void) {
  const now = () => Date.now();

  async function analyze(text: string): Promise<{ a: Analysis; by: Conversation["analyzedBy"] }> {
    const brain = get().brain;
    if (brain?.ai) {
      try {
        return { a: await brainApi.analyze(brain, text, now()), by: "brain" };
      } catch {}
    }
    return { a: analyzeLocally(text, now()), by: "phone" };
  }

  async function scheduleFor(todo: Todo) {
    if (!todo.due || !get().settings.nudges || todo.suggested || todo.bucket === "done") return;
    const id = await remind("Gentle nudge", todo.text, todo.due);
    if (id) set((s) => ({ ...s, todos: s.todos.map((t) => (t.id === todo.id ? { ...t, notificationId: id } : t)) }));
  }

  const patchTodo = (id: string, fn: (t: Todo) => Todo) =>
    set((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? fn(t) : t)) }));

  return {
    // ---------- settings / brain ----------
    setSettings(patch: Partial<Settings>) {
      if (patch.haptics !== undefined) setHaptics(patch.haptics);
      set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    },
    setBrain(brain: Brain | null) {
      set((s) => ({ ...s, brain }));
    },
    finishOnboarding() {
      set((s) => ({ ...s, onboarded: true }));
    },
    resetAll() {
      wipe();
      set(() => ({ ...initialState(now()), onboarded: true }));
    },

    // ---------- capture ----------
    async capture(input: CaptureInput): Promise<string> {
      const text = input.text.trim();
      const { a, by } = await analyze(text);
      const convo: Conversation = {
        id: uid("convo"),
        title: input.title?.trim() || a.title,
        at: input.at ?? now(),
        source: input.source,
        text,
        summary: a.summary.length ? a.summary : sentencesOf(text).slice(0, 1),
        analyzedBy: by,
        ...(input.beeId ? { beeId: input.beeId } : {}),
      };
      set((s) => applyAnalysis(s, convo, a, now()));
      return convo.id;
    },
    editConversation(id: string, patch: { title?: string; summary?: string[] }) {
      set((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, ...patch, previousSummary: patch.summary ? c.summary : c.previousSummary, reviewed: true } : c),
      }));
    },
    deleteConversation(id: string) {
      set((s) => ({
        ...s,
        conversations: s.conversations.filter((c) => c.id !== id),
        todos: s.todos.filter((t) => !(t.fromId === id && t.suggested)),
        memories: s.memories.filter((m) => !(m.fromId === id && m.suggested)),
        suggestedRules: s.suggestedRules.filter((r) => r.fromId !== id),
      }));
    },

    // ---------- to-dos ----------
    addTodo(text: string, bucket: Todo["bucket"] = "now", due?: number) {
      const todo: Todo = { id: uid("todo"), text: text.trim(), bucket, suggested: false, steps: [], createdAt: now(), ...(due ? { due } : {}) };
      set((s) => ({ ...s, todos: [todo, ...s.todos] }));
      void scheduleFor(todo);
      return todo.id;
    },
    acceptTodo(id: string, bucket: "now" | "later") {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      const next = { ...t, suggested: false, bucket };
      patchTodo(id, () => next);
      void scheduleFor(next);
    },
    editTodo(id: string, text: string) {
      patchTodo(id, (t) => ({ ...t, previousText: t.text, text, reviewed: true }));
    },
    setDue(id: string, due: number | undefined) {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      void cancelReminder(t.notificationId);
      const { notificationId: _n, due: _d, ...rest } = t;
      const next: Todo = due ? { ...rest, due } : rest;
      patchTodo(id, () => next);
      void scheduleFor(next);
    },
    moveTodo(id: string, bucket: Todo["bucket"]) {
      const t = get().todos.find((x) => x.id === id);
      if (bucket === "done") void cancelReminder(t?.notificationId);
      patchTodo(id, (x) => ({ ...x, bucket, ...(bucket === "done" ? { doneAt: now() } : {}) }));
    },
    deleteTodo(id: string) {
      void cancelReminder(get().todos.find((x) => x.id === id)?.notificationId);
      set((s) => ({ ...s, todos: s.todos.filter((t) => t.id !== id) }));
    },
    async makeTiny(id: string) {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      let steps = tinySteps(t.text);
      const brain = get().brain;
      if (brain?.ai) {
        try {
          const r = await brainApi.steps(brain, t.text);
          if (r.steps.length) steps = r.steps.slice(0, 6);
        } catch {}
      }
      patchTodo(id, (x) => ({ ...x, steps: steps.map((text) => ({ id: uid("step"), text, done: false })) }));
    },
    toggleStep(todoId: string, stepId: string) {
      patchTodo(todoId, (t) => ({ ...t, steps: t.steps.map((st) => (st.id === stepId ? { ...st, done: !st.done } : st)) }));
    },

    // ---------- memories ----------
    acceptMemory(id: string) {
      set((s) => ({ ...s, memories: s.memories.map((m) => (m.id === id ? { ...m, suggested: false } : m)) }));
    },
    addMemory(text: string, kind: Memory["kind"] = "me") {
      set((s) => ({ ...s, memories: [{ id: uid("mem"), text: text.trim(), kind, suggested: false, at: now() }, ...s.memories] }));
    },
    editMemory(id: string, text: string) {
      set((s) => ({ ...s, memories: s.memories.map((m) => (m.id === id ? { ...m, previousText: m.text, text, reviewed: true } : m)) }));
    },
    deleteMemory(id: string) {
      set((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id) }));
    },

    // ---------- evening review ----------
    markReviewed(kind: "todo" | "memory" | "convo", id: string, reviewed = true) {
      set((s) => ({
        ...s,
        todos: kind === "todo" ? s.todos.map((t) => (t.id === id ? { ...t, reviewed } : t)) : s.todos,
        memories: kind === "memory" ? s.memories.map((m) => (m.id === id ? { ...m, reviewed } : m)) : s.memories,
        conversations: kind === "convo" ? s.conversations.map((c) => (c.id === id ? { ...c, reviewed } : c)) : s.conversations,
      }));
    },
    /** Restore an item exactly as it was before a review action. */
    restore(kind: "todo" | "memory" | "convo", item: Todo | Memory | Conversation) {
      set((s) => {
        if (kind === "todo") {
          const t = item as Todo;
          return { ...s, todos: s.todos.some((x) => x.id === t.id) ? s.todos.map((x) => (x.id === t.id ? t : x)) : [t, ...s.todos] };
        }
        if (kind === "memory") {
          const m = item as Memory;
          return { ...s, memories: s.memories.some((x) => x.id === m.id) ? s.memories.map((x) => (x.id === m.id ? m : x)) : [m, ...s.memories] };
        }
        const c = item as Conversation;
        return { ...s, conversations: s.conversations.map((x) => (x.id === c.id ? c : x)) };
      });
    },

    // ---------- ask ----------
    async ask(question: string) {
      const q: ChatMessage = { id: uid("msg"), role: "me", text: question.trim(), at: now() };
      set((s) => ({ ...s, chat: [...s.chat, q] }));
      const state = get();
      let reply: ChatMessage | undefined;
      if (state.brain?.ai) {
        try {
          const notes = [
            ...state.memories.filter((m) => !m.suggested).map((m) => ({ id: m.id, text: `Memory: ${m.text}` })),
            ...state.todos.filter((t) => !t.suggested && t.bucket !== "done").map((t) => ({ id: t.id, text: `To-do: ${t.text}` })),
            ...state.conversations.slice(0, 30).map((c) => ({ id: c.id, text: `${c.title} (${new Date(c.at).toLocaleString()}): ${c.text.slice(0, 3000)}` })),
            ...state.packs.flatMap((p) => p.rules.map((r) => ({ id: p.id, text: `Work rule (${p.title}): ${r.situation} ${r.action}` }))),
          ];
          const r = await brainApi.ask(state.brain, q.text, notes);
          reply = { id: uid("msg"), role: "app", text: r.answer, at: now(), sources: r.sourceIds };
        } catch {}
      }
      if (!reply) {
        const a = askLocally(q.text, state, now());
        reply = { id: uid("msg"), role: "app", text: a.text, at: now(), sources: a.sources };
      }
      const r = reply;
      set((s) => ({ ...s, chat: [...s.chat, r] }));
    },
    clearChat() {
      set((s) => ({ ...s, chat: [] }));
    },

    // ---------- training ----------
    dismissRule(id: string) {
      set((s) => ({ ...s, suggestedRules: s.suggestedRules.filter((r) => r.id !== id) }));
    },
    /**
     * Save confirmed rules. With `packId` they are matched against that pack:
     * changed rules become a Change Drill, new ones are appended.
     */
    saveConfirmedRules(
      confirmed: { id: string; situation: string; action: string; quote: string }[],
      target: { packId: string } | { title: string; trainer: string; source: string },
    ): { packId: string; updates: number; added: number } {
      const ids = new Set(confirmed.map((c) => c.id));
      if ("packId" in target) {
        const pack = get().packs.find((p) => p.id === target.packId);
        if (!pack) return { packId: target.packId, updates: 0, added: 0 };
        const { updates, added } = matchUpdates(
          pack,
          confirmed.map((c) => ({ situation: c.situation, action: c.action, quote: c.quote, isUpdate: false })),
          () => uid("rule"),
        );
        set((s) => ({
          ...s,
          suggestedRules: s.suggestedRules.filter((r) => !ids.has(r.id)),
          packs: s.packs.map((p) =>
            p.id === pack.id
              ? { ...p, rules: [...p.rules, ...added], pendingUpdates: [...p.pendingUpdates.filter((u) => !updates.some((n) => n.ruleId === u.ruleId)), ...updates] }
              : p),
        }));
        return { packId: pack.id, updates: updates.length, added: added.length };
      }
      const pack: Pack = {
        id: uid("pack"), title: target.title.trim() || "My training", place: "", trainer: target.trainer.trim() || "Your trainer",
        sample: false, createdAt: now(), source: target.source,
        rules: confirmed.map((c) => ruleFromCandidate({ ...c, isUpdate: false }, uid("rule"))),
        questions: [], pendingUpdates: [],
      };
      set((s) => ({ ...s, packs: [pack, ...s.packs], suggestedRules: s.suggestedRules.filter((r) => !ids.has(r.id)) }));
      return { packId: pack.id, updates: 0, added: pack.rules.length };
    },
    /** Apply a pack's pending updates; old actions become `changedFrom` (and a trap answer). */
    applyUpdates(packId: string): string[] {
      const pack = get().packs.find((p) => p.id === packId);
      if (!pack || !pack.pendingUpdates.length) return [];
      const changed = pack.pendingUpdates.map((u) => u.ruleId);
      set((s) => {
        const progress = { ...s.progress };
        for (const id of changed) delete progress[id];
        return {
          ...s,
          progress,
          packs: s.packs.map((p) =>
            p.id !== packId
              ? p
              : {
                  ...p,
                  pendingUpdates: [],
                  rules: p.rules.map((r) => {
                    const u = p.pendingUpdates.find((x) => x.ruleId === r.id);
                    if (!u) return r;
                    const { distractors: _d, ...rest } = r;
                    return { ...rest, changedFrom: r.action, action: u.newAction, keywords: u.newKeywords.length ? u.newKeywords : keywordsFor(u.newAction), quote: u.quote };
                  }),
                }),
        };
      });
      return changed;
    },
    recordAnswer(ruleId: string, firstTry: boolean) {
      set((s) => {
        const t = dayKey(now());
        return {
          ...s,
          progress: { ...s.progress, [ruleId]: nextProgress(s.progress[ruleId], firstTry, now()) },
          today: { date: t, count: (s.today.date === t ? s.today.count : 0) + 1 },
        };
      });
    },
    setResume(resume: Resume | null) {
      set((s) => ({ ...s, resume }));
    },
    deletePack(id: string) {
      set((s) => ({ ...s, packs: s.packs.filter((p) => p.id !== id), resume: s.resume?.packId === id ? null : s.resume }));
    },
    resetPack(id: string) {
      set((s) => {
        const pack = s.packs.find((p) => p.id === id);
        const progress = { ...s.progress };
        pack?.rules.forEach((r) => delete progress[r.id]);
        return { ...s, progress };
      });
    },
  };
}

export type Actions = ReturnType<typeof makeActions>;
type Store = { state: AppState; actions: Actions };

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const ref = useRef<AppState | null>(null);
  ref.current = state;

  useEffect(() => {
    let alive = true;
    void loadRaw().then((raw) => {
      if (!alive) return;
      const s = migrate(raw, Date.now());
      setHaptics(s.settings.haptics);
      setState(s);
    });
    const sub = RNAppState.addEventListener("change", (st) => {
      if (st !== "active") saveNow();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (state) saveSoon(state);
  }, [state]);

  const get = useCallback(() => ref.current as AppState, []);
  const set = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      ref.current = next;
      return next;
    });
  }, []);
  const actions = useMemo(() => makeActions(get, set), [get, set]);

  if (!state) return <>{fallback}</>;
  return <Ctx.Provider value={{ state, actions }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
