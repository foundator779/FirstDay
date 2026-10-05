import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import { brainApi, type BeeWritePath, type Target } from "./brain";
import { cloudReady, cloudTarget } from "./cloud";
import { cancelAllReminders, cancelReminder, notifyNow, remind, setHaptics } from "./device";
import { analyzeLocally, sentencesOf, type Analysis } from "./logic/analyze";
import { askLocally } from "./logic/ask";
import { EMPTY_BEE, mergeBee, packsForCoach } from "./logic/beeSync";
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
  cloudAi: true,
  syncToBee: true,
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
    bee: EMPTY_BEE,
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
  return { ...initialState(now), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings }, bee: { ...EMPTY_BEE, ...s.bee } } as AppState;
}

export type CaptureInput = { text: string; source: Conversation["source"]; title?: string; at?: number; beeId?: string };

function makeActions(get: () => AppState, set: (fn: (s: AppState) => AppState) => void) {
  const now = () => Date.now();

  // Whether the brain answered lately, so an unreachable brain (you're at work, it's at home) doesn't
  // make every capture wait for its timeout before trying the AWS endpoint.
  const brainSeen = { okAt: 0, failAt: 0 };
  const brainLooksDown = () => brainSeen.failAt > brainSeen.okAt && now() - brainSeen.failAt < 2 * 60_000;

  /** Smarter reading, in order: the brain on your computer (if it has Bedrock), then the AWS endpoint (if signed in). */
  async function withAi<T>(fn: (t: Target) => Promise<T>): Promise<{ v: T; by: "brain" | "cloud" } | null> {
    const brain = get().brain;
    if (brain?.ai && !brainLooksDown()) {
      try {
        const v = await fn(brain);
        brainSeen.okAt = now();
        return { v, by: "brain" };
      } catch {
        brainSeen.failAt = now();
      }
    }
    if (get().settings.cloudAi && (await cloudReady())) {
      try {
        return { v: await fn(cloudTarget), by: "cloud" };
      } catch {}
    }
    return null;
  }

  async function analyze(text: string): Promise<{ a: Analysis; by: Conversation["analyzedBy"] }> {
    const r = await withAi((t) => brainApi.analyze(t, text, now()));
    return r ? { a: r.v, by: r.by } : { a: analyzeLocally(text, now()), by: "phone" };
  }

  // ---------- Bee write-back (only when the brain has Bee and "Send changes to Bee" is on) ----------
  const setBee = (patch: Partial<AppState["bee"]>) => set((s) => ({ ...s, bee: { ...s.bee, ...patch } }));
  const hide = (key: string) => set((s) => ({ ...s, bee: { ...s.bee, hidden: [...s.bee.hidden.filter((k) => k !== key), key].slice(-1000) } }));
  const unhide = (key: string) => set((s) => ({ ...s, bee: { ...s.bee, hidden: s.bee.hidden.filter((k) => k !== key) } }));
  /** Local ids with a Bee write in flight, so a double tap can't create two copies in Bee. */
  const pushing = new Set<string>();

  async function beeWrite(path: BeeWritePath, body: Record<string, unknown>): Promise<{ id?: string } | null> {
    const brain = get().brain;
    if (!brain?.bee || !get().settings.syncToBee) return null;
    try {
      const r = await brainApi.beeWrite(brain, path, body);
      if (get().bee.lastError) setBee({ lastError: undefined });
      return r;
    } catch (e) {
      setBee({ lastError: `Couldn't update Bee: ${e instanceof Error ? e.message : "error"}` });
      return null;
    }
  }

  /** Runs one Bee write for a local item. If the item was deleted meanwhile, the Bee copy is hidden here. */
  async function linkWrite(localId: string, kind: "todo" | "fact", path: BeeWritePath, body: Record<string, unknown>, link: (beeId: string) => void) {
    if (pushing.has(localId)) return;
    pushing.add(localId);
    try {
      const r = await beeWrite(path, body);
      if (!r?.id) return;
      const exists = kind === "todo" ? get().todos.some((t) => t.id === localId) : get().memories.some((m) => m.id === localId);
      if (exists) link(r.id);
      else hide(`${kind}:${r.id}`);
    } finally {
      pushing.delete(localId);
    }
  }

  async function pushTodo(todo: Todo) {
    if (todo.beeTodoId || todo.beeSuggestionId) return;
    // Reminders stay with FirstDay's gentle nudges, so Bee gets the text only (no double alarms).
    await linkWrite(todo.id, "todo", "/bee/todos/create", { text: todo.text }, (beeId) =>
      patchTodo(todo.id, (t) => ({ ...t, beeTodoId: beeId, linkedAt: now(), beeDone: false })),
    );
  }

  async function pushMemory(m: Memory) {
    if (m.beeFactId) return;
    await linkWrite(m.id, "fact", "/bee/facts/create", { text: m.text }, (beeId) =>
      set((s) => ({ ...s, memories: s.memories.map((x) => (x.id === m.id ? { ...x, beeFactId: beeId, linkedAt: now() } : x)) })),
    );
  }

  /** One sync at a time; a second caller shares the running one. */
  let syncing: Promise<{ ok: boolean; message: string }> | null = null;

  /** Pulls facts, to-dos, suggestions, the daily summary and insights from Bee. */
  function syncBeeNow(target?: Brain): Promise<{ ok: boolean; message: string }> {
    if (syncing) return syncing;
    const brain = target ?? get().brain;
    if (!brain?.bee) return Promise.resolve({ ok: false, message: "Connect the brain on your computer (with the Bee CLI signed in) first." });
    syncing = (async () => {
      const startedAt = now();
      try {
        const snap = await brainApi.beeSync(brain);
        brainSeen.okAt = now();
        const t = now();
        const preview = mergeBee(get(), snap, t, startedAt);
        set((s) => mergeBee(s, snap, t, startedAt).state);
        const { memories, todos, suggestions } = preview.added;
        const parts = [
          memories && `${memories} ${memories === 1 ? "memory" : "memories"}`,
          todos && `${todos} to-do${todos === 1 ? "" : "s"}`,
          suggestions && `${suggestions} suggestion${suggestions === 1 ? "" : "s"}`,
        ].filter(Boolean);
        const base = parts.length ? `New from Bee: ${parts.join(", ")}.` : "Up to date with Bee.";
        return { ok: true, message: preview.failed.length ? `${base} Couldn't read ${preview.failed.join(", ")}.` : base };
      } catch (e) {
        brainSeen.failAt = now();
        const message = e instanceof Error ? e.message : "Couldn't reach the brain.";
        setBee({ lastError: message });
        return { ok: false, message };
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  /** Status line for Settings. */
  async function syncBee(target?: Brain): Promise<string> {
    return (await syncBeeNow(target)).message;
  }

  // ---------- Confirmed rules -> brain, for the FirstDay coach Agent Skill ----------
  let packsTimer: ReturnType<typeof setTimeout> | undefined;
  function pushPacksSoon() {
    clearTimeout(packsTimer);
    packsTimer = setTimeout(() => {
      const brain = get().brain;
      if (brain) void brainApi.syncPacks(brain, packsForCoach(get())).catch(() => {});
    }, 4000);
  }

  async function scheduleFor(todo: Todo) {
    // Bee rings its own alarm for times that came from Bee; FirstDay doesn't nudge on top of it.
    if (!todo.due || todo.beeAlarm || todo.notificationId || !get().settings.nudges || todo.suggested || todo.bucket === "done") return;
    const id = await remind("Gentle nudge", todo.text, todo.due);
    if (!id) return;
    const still = get().todos.find((t) => t.id === todo.id);
    if (!still || still.suggested || still.bucket === "done" || still.due !== todo.due) {
      void cancelReminder(id);
      return;
    }
    set((s) => ({ ...s, todos: s.todos.map((t) => (t.id === todo.id ? { ...t, notificationId: id } : t)) }));
  }

  const patchTodo = (id: string, fn: (t: Todo) => Todo) =>
    set((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? fn(t) : t)) }));

  return {
    // ---------- settings / brain ----------
    setSettings(patch: Partial<Settings>) {
      if (patch.haptics !== undefined) setHaptics(patch.haptics);
      if (patch.nudges === false) {
        void cancelAllReminders();
        set((s) => ({ ...s, todos: s.todos.map(({ notificationId: _n, ...t }) => t) }));
      }
      if (patch.nudges === true) setTimeout(() => get().todos.forEach((t) => void scheduleFor(t)), 300);
      set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    },
    setBrain(brain: Brain | null) {
      set((s) => ({ ...s, brain }));
      if (brain) pushPacksSoon();
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
      void pushTodo(todo);
      return todo.id;
    },
    acceptTodo(id: string, bucket: "now" | "later") {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      const next = { ...t, suggested: false, bucket };
      patchTodo(id, () => next);
      void scheduleFor(next);
      if (t.beeSuggestionId) {
        void linkWrite(id, "todo", "/bee/suggestions/accept", { id: t.beeSuggestionId }, (beeId) =>
          patchTodo(id, (x) => ({ ...x, beeTodoId: beeId, linkedAt: now(), beeDone: false })),
        );
      } else void pushTodo(next);
    },
    editTodo(id: string, text: string) {
      patchTodo(id, (t) => ({ ...t, previousText: t.text, text, reviewed: true }));
    },
    setDue(id: string, due: number | undefined) {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      void cancelReminder(t.notificationId);
      const { notificationId: _n, due: _d, beeAlarm: _b, ...rest } = t;
      const next: Todo = due ? { ...rest, due } : rest;
      patchTodo(id, () => next);
      void scheduleFor(next);
    },
    moveTodo(id: string, bucket: Todo["bucket"]) {
      const t = get().todos.find((x) => x.id === id);
      if (bucket === "done") void cancelReminder(t?.notificationId);
      patchTodo(id, (x) => ({ ...x, bucket, ...(bucket === "done" ? { doneAt: now() } : {}) }));
      if (bucket === "done" && t?.beeTodoId && t.bucket !== "done" && !t.beeDone) {
        void beeWrite("/bee/todos/complete", { id: t.beeTodoId }).then((r) => {
          if (r) patchTodo(id, (x) => ({ ...x, beeDone: true }));
        });
      }
    },
    deleteTodo(id: string) {
      const t = get().todos.find((x) => x.id === id);
      void cancelReminder(t?.notificationId);
      set((s) => ({ ...s, todos: s.todos.filter((x) => x.id !== id) }));
      if (t?.beeSuggestionId && t.suggested) {
        // Hidden while the dismiss is in flight; once Bee has dropped it there's nothing left to hide.
        const key = `sugg:${t.beeSuggestionId}`;
        hide(key);
        void beeWrite("/bee/suggestions/dismiss", { id: t.beeSuggestionId }).then((r) => {
          if (r) unhide(key);
        });
      }
      if (t?.beeTodoId) hide(`todo:${t.beeTodoId}`);
    },
    async makeTiny(id: string) {
      const t = get().todos.find((x) => x.id === id);
      if (!t) return;
      let steps = tinySteps(t.text);
      const r = await withAi((target) => brainApi.steps(target, t.text));
      if (r?.v.steps.length) steps = r.v.steps.slice(0, 6);
      patchTodo(id, (x) => ({ ...x, steps: steps.map((text) => ({ id: uid("step"), text, done: false })) }));
    },
    toggleStep(todoId: string, stepId: string) {
      patchTodo(todoId, (t) => ({ ...t, steps: t.steps.map((st) => (st.id === stepId ? { ...st, done: !st.done } : st)) }));
    },

    // ---------- memories ----------
    acceptMemory(id: string) {
      const m = get().memories.find((x) => x.id === id);
      set((s) => ({ ...s, memories: s.memories.map((x) => (x.id === id ? { ...x, suggested: false } : x)) }));
      if (m?.beeFactId) void beeWrite("/bee/facts/confirm", { id: m.beeFactId });
      else if (m) void pushMemory(m);
    },
    addMemory(text: string, kind: Memory["kind"] = "me") {
      const m: Memory = { id: uid("mem"), text: text.trim(), kind, suggested: false, at: now() };
      set((s) => ({ ...s, memories: [m, ...s.memories] }));
      void pushMemory(m);
    },
    editMemory(id: string, text: string) {
      const m = get().memories.find((x) => x.id === id);
      set((s) => ({ ...s, memories: s.memories.map((x) => (x.id === id ? { ...x, previousText: x.text, text, reviewed: true } : x)) }));
      if (m?.beeFactId) void beeWrite("/bee/facts/update", { id: m.beeFactId, text });
    },
    /** `alsoInBee` deletes the linked Bee fact too; otherwise it's only hidden here. */
    deleteMemory(id: string, alsoInBee = false) {
      const m = get().memories.find((x) => x.id === id);
      set((s) => ({ ...s, memories: s.memories.filter((x) => x.id !== id) }));
      if (!m?.beeFactId) return;
      hide(`fact:${m.beeFactId}`);
      if (alsoInBee) void beeWrite("/bee/facts/delete", { id: m.beeFactId });
    },

    // ---------- Bee: two-way sync and live inbox ----------
    syncBee,
    /** Asks the brain what Bee recorded since we last looked. Announces new conversations once. */
    async checkBee() {
      const brain = get().brain;
      if (!brain?.bee) return;
      try {
        const r = await brainApi.beeInbox(brain);
        const bee = get().bee;
        const fresh = r.items.filter((i) => !bee.notified.includes(i.id));
        set((s) => ({
          ...s,
          brain: s.brain && s.brain.live !== r.live ? { ...s.brain, live: r.live } : s.brain,
          bee: { ...s.bee, inbox: r.items, notified: [...s.bee.notified, ...fresh.map((i) => i.id)].slice(-200) },
        }));
        if (get().settings.nudges) {
          for (const i of fresh.slice(0, 2)) void notifyNow("New from Bee", `"${i.title}" is ready. Turn it into practice?`, { beeId: i.id });
        }
        brainSeen.okAt = now();
        if (r.todosChangedAt > bee.todosChangedAt && (await syncBeeNow()).ok) setBee({ todosChangedAt: r.todosChangedAt });
      } catch {
        brainSeen.failAt = now();
      }
    },
    dismissBeeInbox(ids: string[]) {
      set((s) => ({ ...s, bee: { ...s.bee, inbox: s.bee.inbox.filter((i) => !ids.includes(i.id)) } }));
      const brain = get().brain;
      if (brain?.bee) void brainApi.beeAck(brain, ids).catch(() => {});
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
      if (kind === "todo") {
        // Reminders follow the restored state, never the snapshot's old notification id.
        void cancelReminder(get().todos.find((t) => t.id === item.id)?.notificationId);
        const restored = item as Todo;
        setTimeout(() => {
          const { notificationId: _n, ...rest } = restored;
          void scheduleFor(rest);
        }, 300);
      }
      set((s) => {
        // An undo restores the item's content, but keeps any Bee link made since the snapshot.
        if (kind === "todo") {
          const { notificationId: _old, ...snap } = item as Todo;
          const cur = s.todos.find((x) => x.id === snap.id);
          const t: Todo = cur ? { ...snap, beeTodoId: cur.beeTodoId, beeSuggestionId: cur.beeSuggestionId, linkedAt: cur.linkedAt, beeDone: cur.beeDone } : snap;
          return { ...s, todos: cur ? s.todos.map((x) => (x.id === t.id ? t : x)) : [t, ...s.todos] };
        }
        if (kind === "memory") {
          const snap = item as Memory;
          const cur = s.memories.find((x) => x.id === snap.id);
          const m: Memory = cur ? { ...snap, beeFactId: cur.beeFactId, linkedAt: cur.linkedAt } : snap;
          return { ...s, memories: cur ? s.memories.map((x) => (x.id === m.id ? m : x)) : [m, ...s.memories] };
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
      {
        const notes = [
            ...state.memories.filter((m) => !m.suggested).map((m) => ({ id: m.id, text: `Memory: ${m.text}` })),
            ...state.todos.filter((t) => !t.suggested && t.bucket !== "done").map((t) => ({ id: t.id, text: `To-do: ${t.text}` })),
            ...state.conversations.slice(0, 30).map((c) => ({ id: c.id, text: `${c.title} (${new Date(c.at).toLocaleString()}): ${c.text.slice(0, 3000)}` })),
            ...state.packs.flatMap((p) => p.rules.map((r) => ({ id: p.id, text: `Work rule (${p.title}): ${r.situation} ${r.action}` }))),
        ];
        const r = await withAi((t) => brainApi.ask(t, q.text, notes));
        if (r) reply = { id: uid("msg"), role: "app", text: r.v.answer, at: now(), sources: r.v.sourceIds };
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
    /** AI second opinion on a typed answer the keyword check didn't pass. Null when no AI is available. */
    async grade(input: { situation: string; instruction: string; quote: string; answer: string }) {
      const r = await withAi((t) => brainApi.grade(t, input));
      return r ? r.v : null;
    },
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
        pushPacksSoon();
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
      pushPacksSoon();
      return { packId: pack.id, updates: 0, added: pack.rules.length };
    },
    /** Apply a pack's pending updates; old actions become `changedFrom` (and a trap answer). */
    applyUpdates(packId: string): string[] {
      const pack = get().packs.find((p) => p.id === packId);
      if (!pack || !pack.pendingUpdates.length) return [];
      const changed = pack.pendingUpdates.map((u) => u.ruleId);
      pushPacksSoon();
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
      pushPacksSoon();
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
      pushPacksSoon();
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

  // Live Bee: while the app is open, ask the brain every 45 s what Bee recorded since we last looked.
  const ready = !!state;
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      if (RNAppState.currentState === "active") void actions.checkBee();
    };
    const first = setTimeout(() => {
      const s = ref.current;
      if (s?.brain?.bee && Date.now() - s.bee.syncedAt > 10 * 60_000) void actions.syncBee();
      tick();
    }, 1500);
    const timer = setInterval(tick, 45_000);
    const sub = RNAppState.addEventListener("change", (st) => {
      if (st === "active") tick();
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, actions]);

  if (!state) return <>{fallback}</>;
  return <Ctx.Provider value={{ state, actions }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
