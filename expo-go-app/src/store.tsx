import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import { brainApi, type BeeWritePath, type Target } from "./brain";
import { cloudReady, cloudTarget } from "./cloud";
import { coachApi, coachAvailable, CoachError, teamApi } from "./coachCloud";
import { cancelAllReminders, cancelReminder, notifyNow, remind, setHaptics } from "./device";
import { analyzeLocally, sentencesOf, type Analysis } from "./logic/analyze";
import { askLocally } from "./logic/ask";
import { EMPTY_BEE, mergeBee, packsForCoach } from "./logic/beeSync";
import { matchUpdates, ruleFromCandidate } from "./logic/extract";
import { migrateQuestions, openQuestions, questionsFrom, withPackQuestions } from "./logic/questions";
import { samplePacks } from "./logic/samples";
import { tinySteps } from "./logic/steps";
import { applyDirect, applyTeamUpdate, normalizeCode, packFromTeam, toWire, updateMessage, validCode, type RemoteTeam } from "./logic/team";
import { dayKey, keywordsFor, uid } from "./logic/text";
import { nextProgress } from "./logic/training";
import type {
  AppState, Brain, ChatMessage, Conversation, Memory, MoodEntry, Pack, PracticeReminder, Reflection, Resume, Settings, SuggestedRule, Todo, Win,
} from "./logic/types";
import { practiceWins, praiseWins } from "./logic/wins";
import { REFLECTION_QUESTION, reflectionNotes } from "./logic/patterns";
import { friendlyDue } from "./logic/dates";
import { reminderDone, reminderText } from "./logic/wrist";
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
  // Vague lines become questions for the trainer (their own tab), never rules and never to-dos.
  const questions = questionsFrom(a.questions, convo.id, now);
  const memories: Memory[] = a.memories.map((m) => ({
    id: uid("mem"), text: m.text, kind: m.kind, suggested: true, fromId: convo.id, quote: m.quote, at: now,
  }));
  const rules: SuggestedRule[] = a.rules.map((r) => ({ id: uid("sr"), fromId: convo.id, situation: r.situation, action: r.action, quote: r.quote }));
  // Praise and thanks for you go to My record as suggestions. Bee doesn't name speakers: guess your latest trainer.
  const wins = praiseWins(convo.text, convo, state.packs[0]?.trainer && state.packs[0].trainer !== "Your trainer" ? state.packs[0].trainer : "", now);
  return {
    ...state,
    wins: [...wins, ...state.wins],
    conversations: [convo, ...state.conversations],
    todos: [...todos, ...state.todos],
    memories: [...memories, ...state.memories],
    suggestedRules: [...rules, ...state.suggestedRules],
    questions: [...questions, ...state.questions],
  };
}

/** A brand-new account starts empty: no sample conversation, no sample trainings. */
function initialState(now: number): AppState {
  return {
    version: 2,
    packs: [],
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
    moods: [],
    reflection: null,
    questions: [],
    coach: null,
    teamRequests: [],
    wins: [],
  };
}

function migrate(raw: unknown, now: number): AppState {
  const s = raw as Partial<AppState> | null;
  if (!s || s.version !== 2 || !Array.isArray(s.packs)) return initialState(now);
  const state = {
    ...initialState(now), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings }, bee: { ...EMPTY_BEE, ...s.bee },
    questions: Array.isArray(s.questions) ? s.questions : [], coach: s.coach ?? null,
    teamRequests: Array.isArray(s.teamRequests) ? s.teamRequests : [],
    wins: Array.isArray(s.wins) ? s.wins : [],
  } as AppState;
  return migrateQuestions(state, now);
}

export type CaptureInput = { text: string; source: Conversation["source"]; title?: string; at?: number; beeId?: string; replayId?: string };

function makeActions(
  get: () => AppState,
  set: (fn: (s: AppState) => AppState) => void,
  owner: () => string | null,
) {
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

  // ---------- Confirmed rules -> brain (coach Agent Skill) and the coach service (MCP server, voice screen) ----------
  let packsTimer: ReturnType<typeof setTimeout> | undefined;
  function pushPacksSoon() {
    clearTimeout(packsTimer);
    packsTimer = setTimeout(() => {
      const s = get();
      const brain = s.brain;
      if (brain) void brainApi.syncPacks(brain, packsForCoach(s)).catch(() => {});
      if (s.coach?.on && coachAvailable) void pushCoach().catch(() => {});
    }, 4000);
  }

  async function pushCoach() {
    const s = get();
    await coachApi.putPacks(packsForCoach(s), openQuestions(s).map((q) => q.text));
    set((x) => ({ ...x, coach: x.coach ? { ...x.coach, pushedAt: now() } : x.coach }));
  }

  /** Deletes your coach data and keys, stops sharing your trainings and leaves your teams. Never throws. */
  async function forgetCloud(): Promise<void> {
    if (!coachAvailable) return;
    const linked = get().packs.filter((p) => p.team && !p.team.stopped).map((p) => p.team!);
    await coachApi.off().catch(() => {});
    for (const t of linked) await (t.role === "trainer" ? teamApi.stop(t.code) : teamApi.leave(t.code)).catch(() => {});
    for (const r of get().teamRequests) await teamApi.leave(r.code).catch(() => {});
  }

  // ---------- Team trainings ----------
  const patchPack = (id: string, fn: (p: Pack) => Pack) => set((s) => ({ ...s, packs: s.packs.map((p) => (p.id === id ? fn(p) : p)) }));
  const coachMessage = (e: unknown) => (e instanceof CoachError ? e.message : "Something went wrong. Try again.");

  /** Adds (or brings up to date) your copy of a team training you're now in. */
  function takeTeam(remote: RemoteTeam): { pack: Pack; isNew: boolean } {
    const have = get().packs.find((p) => p.team?.code === remote.code) ?? get().packs.find((p) => p.id === `team-${remote.code}`);
    if (have) {
      const r = applyTeamUpdate(have, get().progress, remote, now());
      set((st) => ({ ...st, packs: st.packs.map((x) => (x.id === have.id ? r.pack : x)), questions: withPackQuestions(st.questions, r.pack, now()) }));
      return { pack: r.pack, isNew: false };
    }
    const pack = packFromTeam(remote, now());
    set((s) => ({ ...s, packs: [pack, ...s.packs], questions: withPackQuestions(s.questions, pack, now()) }));
    return { pack, isNew: true };
  }
  const dropRequest = (code: string) => set((s) => ({ ...s, teamRequests: s.teamRequests.filter((r) => r.code !== code) }));

  /**
   * Pulls the trainer's latest version of each training you joined, picks up trainings a trainer just let you
   * into, and (as a trainer) how many people are in or waiting. One check at a time. Returns how many trainings
   * changed, or -1 if it couldn't check.
   */
  let checkingTeams: Promise<number> | null = null;
  function checkTeamsNow(): Promise<number> {
    if (checkingTeams) return checkingTeams;
    const linked = get().packs.filter((p) => p.team && !p.team.stopped);
    const waiting = get().teamRequests.filter((r) => r.status === "pending");
    if ((!linked.length && !waiting.length) || !coachAvailable) return Promise.resolve(0);
    checkingTeams = (async () => {
      let changedPacks = 0;
      try {
        const mine = await teamApi.mine();
        for (const req of get().teamRequests.filter((r) => r.status === "pending")) {
          const m = mine.find((x) => x.code === req.code);
          if (!m || m.gone) {
            set((s) => ({ ...s, teamRequests: s.teamRequests.map((r) => (r.code === req.code ? { ...r, status: "declined" as const } : r)) }));
          } else if (m.role === "declined" || m.role === "removed") {
            set((s) => ({ ...s, teamRequests: s.teamRequests.map((r) => (r.code === req.code ? { ...r, status: "declined" as const } : r)) }));
            if (get().settings.nudges) void notifyNow("Team training", `${req.trainer} didn't let you in to ${req.title}.`, {});
          } else if (m.role === "trainee") {
            const { pack } = takeTeam(await teamApi.get(req.code));
            dropRequest(req.code);
            changedPacks++;
            if (get().settings.nudges) void notifyNow(`${pack.trainer} let you in`, `${pack.title} is ready to practise.`, { packId: pack.id });
          }
        }
        for (const p of get().packs.filter((x) => x.team && !x.team.stopped)) {
          const link = p.team!;
          const remote = mine.find((m) => m.code === link.code);
          if (link.role === "trainer") {
            if (!remote || remote.gone) continue;
            if (remote.members !== link.members || (remote.requests ?? 0) !== (link.requests ?? 0) || !!remote.open !== !!link.open) {
              const fresh = (remote.requests ?? 0) > (link.requests ?? 0);
              patchPack(p.id, (x) => (x.team ? { ...x, team: { ...x.team, members: remote.members, requests: remote.requests ?? 0, open: !!remote.open } } : x));
              if (fresh && get().settings.nudges) void notifyNow("Someone wants to join", `${p.title}: open it to let them in.`, { packId: p.id });
            }
            continue;
          }
          if (!remote || remote.gone || remote.role !== "trainee") {
            patchPack(p.id, (x) => ({ ...x, team: { ...link, stopped: true, ...(remote?.role === "removed" ? { removed: true } : {}) } }));
            continue;
          }
          if (remote.version <= link.version) continue;
          const full = await teamApi.get(link.code);
          const cur = get().packs.find((x) => x.id === p.id);
          if (!cur) continue;
          const r = applyTeamUpdate(cur, get().progress, full, now());
          set((s) => ({ ...s, packs: s.packs.map((x) => (x.id === p.id ? r.pack : x)), questions: withPackQuestions(s.questions, r.pack, now()) }));
          changedPacks++;
          const message = updateMessage(r.pack.trainer, r.pack.title, r);
          if (message && get().settings.nudges) void notifyNow(r.drills ? "Your trainer changed a step" : "Training updated", message, { packId: p.id });
        }
        if (changedPacks) pushPacksSoon();
      } catch {
        // Offline or signed out: try again on the next check.
        return -1;
      } finally {
        checkingTeams = null;
      }
      return changedPacks;
    })();
    return checkingTeams;
  }

  // ---------- Practice reminders (logic/wrist.ts) ----------
  /** Removes a training's reminder: cancels the phone notification (or checks off one an older version put in Bee). */
  async function clearReminder(packId: string) {
    const r = get().packs.find((p) => p.id === packId)?.reminder;
    if (!r) return;
    patchPack(packId, ({ reminder: _r, ...rest }) => rest);
    if (r.via === "phone") await cancelReminder(r.id);
    else await beeWrite("/bee/todos/complete", { id: r.id });
  }

  /** A practice reminder: a FirstDay notification on this phone at `at`, cleared once the steps are practised. */
  async function setReminder(packId: string, kind: PracticeReminder["kind"], at: number, ruleIds: string[]): Promise<{ ok: boolean; message: string; via?: "bee" | "phone" }> {
    const pack = get().packs.find((p) => p.id === packId);
    if (!pack || !ruleIds.length) return { ok: false, message: "This training has no steps to practise yet." };
    const text = reminderText(pack, kind, ruleIds.length);
    const createdAt = now();
    const id = await remind(`Practise ${pack.title}`, text, at);
    if (!id) return { ok: false, message: "Allow notifications for FirstDay Go to get practice reminders." };
    await clearReminder(packId);
    patchPack(packId, (p) => ({ ...p, reminder: { kind, via: "phone", id, at, createdAt, ruleIds } }));
    return { ok: true, via: "phone", message: `FirstDay will remind you ${friendlyDue(at, now())}.` };
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
      // Erasing this phone also removes what the coach service holds for you (your steps, keys, shared teams),
      // since nothing here could reach it afterwards. Best effort: offline, it stays until you turn it off later.
      void forgetCloud();
      wipe(owner());
      set(() => ({ ...initialState(now()), onboarded: true }));
    },
    forgetCloud,
    /** Optional demo content: the fictional sample trainings, for trying practice before you have your own. */
    addSampleTrainings() {
      set((s) => {
        const have = new Set(s.packs.map((p) => p.id));
        const fresh = samplePacks(now()).filter((p) => !have.has(p.id));
        return { ...s, packs: [...s.packs, ...fresh], questions: fresh.reduce((qs, p) => withPackQuestions(qs, p, now()), s.questions) };
      });
    },

    // ---------- questions for your trainer ----------
    markAsked(id: string, asked = true) {
      set((s) => ({
        ...s,
        questions: s.questions.map((q) => {
          if (q.id !== id) return q;
          if (asked) return { ...q, askedAt: now() };
          const { askedAt: _a, ...rest } = q;
          return rest;
        }),
      }));
      pushPacksSoon();
    },

    // ---------- team trainings ----------
    /** Share one of your trainings with a join code. You become its trainer. */
    async shareTeam(packId: string): Promise<{ ok: boolean; message: string; code?: string }> {
      const pack = get().packs.find((p) => p.id === packId);
      if (!pack) return { ok: false, message: "That training is gone." };
      if (pack.team?.role === "trainer") return { ok: true, message: "Already shared.", code: pack.team.code };
      try {
        const r = await teamApi.create(toWire(pack));
        patchPack(packId, (p) => ({ ...p, team: { code: r.code, role: "trainer", version: r.version, syncedAt: now(), members: 0 } }));
        return { ok: true, message: `Shared. Your team joins with code ${r.code}.`, code: r.code };
      } catch (e) {
        return { ok: false, message: coachMessage(e) };
      }
    },
    /** Sends your latest steps. Trainees who practised a changed step get a Change Drill. */
    async sendTeamUpdate(packId: string): Promise<{ ok: boolean; message: string }> {
      const pack = get().packs.find((p) => p.id === packId);
      if (!pack?.team || pack.team.role !== "trainer") return { ok: false, message: "Only the trainer can send changes." };
      try {
        const r = await teamApi.publish(pack.team.code, toWire(pack));
        patchPack(packId, (p) => (p.team ? { ...p, team: { ...p.team, version: r.version, syncedAt: now(), dirty: false, members: r.members ?? p.team.members } } : p));
        const what = [r.changed && `${r.changed} changed`, r.added && `${r.added} new`, r.removed && `${r.removed} removed`].filter(Boolean).join(", ");
        return { ok: true, message: what ? `Sent (${what}). Your team will see it next time they open FirstDay.` : "Sent. Nothing had changed." };
      } catch (e) {
        return { ok: false, message: coachMessage(e) };
      }
    },
    /**
     * Ask to join a training your trainer shared. The trainer sees your verified email and `name`, and lets you in;
     * until then it waits under Train. If you're already in, your copy is brought up to date.
     */
    async joinTeam(input: string, name = ""): Promise<{ ok: boolean; message: string; packId?: string; pending?: boolean }> {
      const code = normalizeCode(input);
      if (!validCode(code)) return { ok: false, message: "A join code has 6 letters and numbers, like K7P2QX." };
      const own = get().packs.find((p) => p.team?.code === code);
      if (own?.team?.role === "trainer") return { ok: false, message: "That's a training you shared yourself." };
      try {
        const r = await teamApi.join(code, name);
        if (r.status === "pending") {
          const req = { code, title: r.title, trainer: r.trainer, askedAt: now(), status: "pending" as const };
          set((s) => ({ ...s, teamRequests: [req, ...s.teamRequests.filter((x) => x.code !== code)] }));
          return { ok: true, pending: true, message: `Asked ${r.trainer} to let you in to ${r.title}. It shows up here as soon as they do.` };
        }
        const had = !!own;
        const { pack } = takeTeam(r.team);
        dropRequest(code);
        pushPacksSoon();
        return { ok: true, message: had ? "You're already in. It's up to date." : `Joined ${pack.title} from ${pack.trainer}.`, packId: pack.id };
      } catch (e) {
        return { ok: false, message: coachMessage(e) };
      }
    },
    /** Take back a request that's still waiting, or clear one the trainer declined. */
    async cancelTeamRequest(code: string): Promise<{ ok: boolean; message: string }> {
      const req = get().teamRequests.find((r) => r.code === code);
      if (req?.status === "pending") {
        try {
          await teamApi.leave(code);
        } catch (e) {
          if (!(e instanceof CoachError && e.status === 404)) return { ok: false, message: coachMessage(e) };
        }
      } else {
        void teamApi.leave(code).catch(() => {});
      }
      dropRequest(code);
      return { ok: true, message: req?.status === "pending" ? "Request taken back." : "" };
    },
    checkTeams: checkTeamsNow,
    /** A practice reminder on this phone for this training, at `at`. */
    remindPractice(packId: string, at: number) {
      const pack = get().packs.find((p) => p.id === packId);
      return setReminder(packId, "practise", at, pack?.rules.map((r) => r.id) ?? []);
    },
    cancelPracticeReminder: clearReminder,
    /** Leave a team: your copy stays as your own training, without updates. */
    async leaveTeam(packId: string): Promise<{ ok: boolean; message: string }> {
      const pack = get().packs.find((p) => p.id === packId);
      if (!pack?.team) return { ok: true, message: "" };
      const code = pack.team.code;
      const role = pack.team.role;
      try {
        if (role === "trainer") await teamApi.stop(code);
        else if (!pack.team.stopped) await teamApi.leave(code);
      } catch (e) {
        if (!(e instanceof CoachError && e.status === 404)) return { ok: false, message: coachMessage(e) };
      }
      patchPack(packId, ({ team: _t, ...rest }) => rest);
      return { ok: true, message: role === "trainer" ? "Stopped sharing. Your team keeps their copies, without updates." : "Left the team. Your copy stays." };
    },

    // ---------- your trainings in other apps (MCP) and the voice screen ----------
    async setCoach(on: boolean): Promise<{ ok: boolean; message: string }> {
      if (on) {
        set((s) => ({ ...s, coach: { on: true, pushedAt: s.coach?.pushedAt ?? 0 } }));
        try {
          await pushCoach();
          return { ok: true, message: "Your confirmed steps are ready for other apps." };
        } catch (e) {
          set((s) => ({ ...s, coach: null }));
          return { ok: false, message: coachMessage(e) };
        }
      }
      try {
        await coachApi.off();
      } catch (e) {
        if (!(e instanceof CoachError && e.status === 404)) return { ok: false, message: coachMessage(e) };
      }
      set((s) => ({ ...s, coach: null }));
      return { ok: true, message: "Turned off. Your steps and every key were deleted from the coach service." };
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
        ...(input.replayId ? { replayId: input.replayId } : {}),
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
        // Its questions go too, unless they already belong to a training.
        questions: s.questions.filter((q) => !(q.fromId === id && !q.packId)),
      }));
      pushPacksSoon();
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

    // ---------- patterns over time ----------
    /** Today's answer to "How did today feel?" (1–5). Answering again replaces it. */
    logMood(score: MoodEntry["score"]) {
      const at = now();
      const day = dayKey(at);
      set((s) => ({ ...s, moods: [...s.moods.filter((m) => m.day !== day), { day, score, at }].slice(-400) }));
    },
    /** A written look across the last four weeks, from Bedrock (brain or AWS). Null when no AI is available. */
    async reflect(): Promise<Reflection | null> {
      const state = get();
      const notes = reflectionNotes(state, now());
      if (!notes.length) return null;
      const r = await withAi((t) => brainApi.ask(t, REFLECTION_QUESTION, notes));
      if (!r) return null;
      const reflection: Reflection = { text: r.v.answer, at: now(), sources: r.v.sourceIds, by: r.by === "brain" ? "brain" : "cloud" };
      set((s) => ({ ...s, reflection }));
      return reflection;
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
      confirmed: { id: string; fromId?: string; situation: string; action: string; quote: string }[],
      target: { packId: string } | { title: string; trainer: string; source: string },
    ): { packId: string; updates: number; added: number; toTeam: boolean } {
      const ids = new Set(confirmed.map((c) => c.id));
      const sources = new Set(confirmed.map((c) => c.fromId).filter(Boolean));
      // Questions from the same conversations now belong to this training.
      const linkQuestions = (packId: string) => (s: AppState) => s.questions.map((q) => (q.fromId && sources.has(q.fromId) && !q.packId ? { ...q, packId } : q));
      if ("packId" in target) {
        const pack = get().packs.find((p) => p.id === target.packId);
        if (!pack) return { packId: target.packId, updates: 0, added: 0, toTeam: false };
        const { updates, added } = matchUpdates(
          pack,
          confirmed.map((c) => ({ situation: c.situation, action: c.action, quote: c.quote, isUpdate: false })),
          () => uid("rule"),
        );
        // A trainer's own shared training changes straight away, ready to send to the team.
        const trainer = pack.team?.role === "trainer";
        pushPacksSoon();
        set((s) => ({
          ...s,
          suggestedRules: s.suggestedRules.filter((r) => !ids.has(r.id)),
          questions: linkQuestions(pack.id)(s),
          packs: s.packs.map((p) =>
            p.id !== pack.id ? p
            : trainer ? applyDirect(p, updates, added)
            : { ...p, rules: [...p.rules, ...added], pendingUpdates: [...p.pendingUpdates.filter((u) => !updates.some((n) => n.ruleId === u.ruleId)), ...updates] }),
        }));
        return { packId: pack.id, updates: updates.length, added: added.length, toTeam: trainer && updates.length + added.length > 0 };
      }
      const pack: Pack = {
        id: uid("pack"), title: target.title.trim() || "My training", place: "", trainer: target.trainer.trim() || "Your trainer",
        sample: false, createdAt: now(), source: target.source,
        rules: confirmed.map((c) => ruleFromCandidate({ ...c, isUpdate: false }, uid("rule"))),
        questions: [], pendingUpdates: [],
      };
      set((s) => ({ ...s, packs: [pack, ...s.packs], suggestedRules: s.suggestedRules.filter((r) => !ids.has(r.id)), questions: linkQuestions(pack.id)(s) }));
      pushPacksSoon();
      return { packId: pack.id, updates: 0, added: pack.rules.length, toTeam: false };
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
      // Practised everything a reminder asked for? Check it off in Bee (or cancel the phone reminder).
      const withReminder = get().packs.find((p) => p.reminder && p.rules.some((r) => r.id === ruleId));
      if (withReminder?.reminder) {
        const progress = { ...get().progress, [ruleId]: nextProgress(get().progress[ruleId], firstTry, now()) };
        if (reminderDone(withReminder, progress, withReminder.reminder)) void clearReminder(withReminder.id);
      }
      set((s) => {
        const t = dayKey(now());
        const progress = { ...s.progress, [ruleId]: nextProgress(s.progress[ruleId], firstTry, now()) };
        // My record: a training fully practised, or a changed step answered the new way.
        const won = practiceWins({ packs: s.packs, progress, wins: s.wins }, ruleId, firstTry, now());
        return { ...s, progress, today: { date: t, count: (s.today.date === t ? s.today.count : 0) + 1 }, ...(won.length ? { wins: [...won, ...s.wins] } : {}) };
      });
    },
    /** My record: keep a suggested win (with who said it), or let it go. */
    keepWin(id: string, who: string) {
      set((s) => ({ ...s, wins: s.wins.map((w) => (w.id === id ? { ...w, suggested: false, who: who.trim() || undefined } : w)) }));
    },
    dropWin(id: string) {
      set((s) => ({ ...s, wins: s.wins.filter((w) => w.id !== id) }));
    },
    setResume(resume: Resume | null) {
      set((s) => ({ ...s, resume }));
    },
    deletePack(id: string) {
      const pack = get().packs.find((p) => p.id === id);
      if (pack?.reminder) void clearReminder(id);
      // Deleting a shared training stops sharing it (trainer) or leaves the team (trainee).
      if (pack?.team && !pack.team.stopped && coachAvailable) {
        void (pack.team.role === "trainer" ? teamApi.stop(pack.team.code) : teamApi.leave(pack.team.code)).catch(() => {});
      }
      pushPacksSoon();
      set((s) => ({
        ...s,
        packs: s.packs.filter((p) => p.id !== id),
        questions: s.questions.filter((q) => q.packId !== id),
        resume: s.resume?.packId === id ? null : s.resume,
      }));
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

/**
 * App state for one account. `user` is the signed-in account's id (null when signed out: nothing is
 * saved). When it changes, that account's own data is loaded in place, without unmounting the screens.
 */
export function StoreProvider({ children, fallback, user = null }: { children: ReactNode; fallback: ReactNode; user?: string | null }) {
  const [state, setState] = useState<AppState | null>(null);
  const ref = useRef<AppState | null>(null);
  ref.current = state;
  // Whose data is in `state` right now; saves always go to that account's file.
  const owner = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    saveNow();
    void loadRaw(user).then((raw) => {
      if (!alive) return;
      const s = migrate(raw, Date.now());
      setHaptics(s.settings.haptics);
      owner.current = user;
      ref.current = s;
      setState(s);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (st) => {
      if (st !== "active") saveNow();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (state) saveSoon(owner.current, state);
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
  const actions = useMemo(() => makeActions(get, set, () => owner.current), [get, set]);

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
    // Team trainings: your trainer's changes arrive when you open the app, and every 5 minutes while it's open.
    const teamTick = () => {
      if (RNAppState.currentState === "active") void actions.checkTeams();
    };
    const firstTeam = setTimeout(teamTick, 2500);
    const teamTimer = setInterval(teamTick, 5 * 60_000);
    const sub = RNAppState.addEventListener("change", (st) => {
      if (st === "active") {
        tick();
        teamTick();
      }
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      clearTimeout(firstTeam);
      clearInterval(teamTimer);
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
