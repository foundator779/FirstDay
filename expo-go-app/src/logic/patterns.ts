// Patterns over time, worked out on the phone from what you've captured: how you've been feeling,
// who you've been spending time with, what keeps coming up, and how much you follow through.
// Pure functions (no React, no network) so they're tested in logic.test.ts.
import { speakerLines } from "./analyze";
import { contentWords, dayKey, stem, words } from "./text";
import type { AppState, Conversation, MoodEntry } from "./types";

const DAY = 86_400_000;
export const MOOD_LABELS = ["Rough", "Low", "Okay", "Good", "Great"] as const;

// ---------- mood ----------

const POSITIVE = new Set(
  "great good glad happy excited love loved thanks thank proud calm fun nice awesome amazing relieved better fine easy enjoyed enjoy smile laugh laughed win won perfect helpful kind welcome".split(" "),
);
const NEGATIVE = new Set(
  "stressed stress anxious worried worry tired exhausted overwhelmed sad angry upset frustrated annoyed late sorry scared afraid hard difficult bad awful terrible sick hurt lonely nervous panic rough forgot mistake problem struggling".split(" "),
);

/** A 1–5 mood reading of a conversation from its words (your own lines when speakers are labelled). Null if it says nothing about mood. */
export function moodFromText(text: string): number | null {
  const lines = speakerLines(text);
  const mine = lines.filter((l) => !l.speaker).map((l) => l.text);
  const source = (mine.length ? mine : lines.map((l) => l.text)).join(" ");
  let pos = 0;
  let neg = 0;
  const ws = words(source);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const negated = i > 0 && /^(not|never|no|isn't|wasn't|don't|didn't)$/.test(ws[i - 1]!);
    if (POSITIVE.has(w)) negated ? neg++ : pos++;
    else if (NEGATIVE.has(w)) negated ? pos++ : neg++;
  }
  if (pos + neg === 0) return null;
  const score = (pos - neg) / (pos + neg + 1);
  return Math.max(1, Math.min(5, Math.round((3 + 2 * score) * 10) / 10));
}

export type MoodDay = { day: string; at: number; score: number | null; source: "check-in" | "conversations" | null };

/** One entry per day for the last `days` days (oldest first). Your own check-in wins over the reading of conversations. */
export function moodDays(moods: MoodEntry[], conversations: Conversation[], now: number, days = 28): MoodDay[] {
  const out: MoodDay[] = [];
  const start = startOfDay(now) - (days - 1) * DAY;
  for (let i = 0; i < days; i++) {
    const at = start + i * DAY;
    const day = dayKey(at);
    const checked = [...moods].reverse().find((m) => m.day === day);
    if (checked) {
      out.push({ day, at, score: checked.score, source: "check-in" });
      continue;
    }
    const read = conversations.filter((c) => dayKey(c.at) === day).map((c) => moodFromText(c.text)).filter((x): x is number => x !== null);
    out.push(read.length ? { day, at, score: avg(read), source: "conversations" } : { day, at, score: null, source: null });
  }
  return out;
}

export type Trend = "up" | "down" | "steady" | "unknown";

function trendOf(thisWeek: number | null, before: number | null, threshold: number): Trend {
  if (thisWeek === null || before === null) return "unknown";
  if (thisWeek - before >= threshold) return "up";
  if (before - thisWeek >= threshold) return "down";
  return "steady";
}

// ---------- people ----------

const GENERIC_SPEAKER = /^(speaker|unknown|person|someone|caller|user|me)\b/i;

/** Names of people in a conversation: labelled speakers, plus people you've saved as memories when they're mentioned. */
export function peopleIn(c: Conversation, knownNames: string[]): string[] {
  const names = new Set<string>();
  for (const l of speakerLines(c.text)) if (l.speaker && !GENERIC_SPEAKER.test(l.speaker)) names.add(cleanName(l.speaker));
  for (const n of knownNames) if (new RegExp(`\\b${escape(n)}\\b`).test(c.text)) names.add(n);
  return [...names].filter(Boolean);
}

/** First names from "people" memories ("Rosa is your trainer at Juniper Café." → Rosa). */
export function namesFromMemories(memories: AppState["memories"]): string[] {
  const out = new Set<string>();
  for (const m of memories) {
    if (m.kind !== "people" || m.suggested) continue;
    const name = /^([A-Z][a-z]+)(?:'s)?\b/.exec(m.text)?.[1];
    if (name && !/^(You|Your|The|They|She|He|It|We|Ask|Tell)$/.test(name)) out.add(name);
  }
  return [...out];
}

export type PersonPattern = { name: string; weeks: number[]; thisWeek: number; usual: number; shift: Trend; line: string };

// ---------- themes ----------

const THEME_STOP = new Set(
  "about after again also always another anything around back because been before being came come could didn't does doing done don't down each even every first from going gonna good got have here he's i'll i'm into it's just know let's like little look make maybe more much need next okay only other over people really right said same says should some something sure take tell than thank thanks that that's their them then there they thing things think this time today told tomorrow want wanna well we'll were what when where which while will with would yeah year you'll your you're week yesterday".split(" "),
);

export type ThemePattern = { word: string; weeks: number; mentions: number; lastAt: number };

/** Words that keep coming back across weeks (in at least two different weeks and three conversations). */
export function recurringThemes(conversations: Conversation[], now: number, weeks = 4, max = 6, names: string[] = []): ThemePattern[] {
  const people = new Set(names.map((n) => n.toLowerCase()));
  const since = startOfDay(now) - (weeks * 7 - 1) * DAY;
  const byStem = new Map<string, { forms: Map<string, number>; weeks: Set<number>; convos: number; lastAt: number }>();
  for (const c of conversations) {
    if (c.at < since || c.at > now) continue;
    const week = weekIndex(c.at, now);
    const seen = new Set<string>();
    for (const w of contentWords(c.text)) {
      if (w.length < 4 || THEME_STOP.has(w) || people.has(w) || /^\d/.test(w)) continue;
      const s = stem(w);
      const e = byStem.get(s) ?? { forms: new Map(), weeks: new Set(), convos: 0, lastAt: 0 };
      e.forms.set(w, (e.forms.get(w) ?? 0) + 1);
      e.weeks.add(week);
      if (!seen.has(s)) e.convos++;
      e.lastAt = Math.max(e.lastAt, c.at);
      seen.add(s);
      byStem.set(s, e);
    }
  }
  return [...byStem.values()]
    .filter((e) => e.weeks.size >= 2 && e.convos >= 3)
    .map((e) => ({ word: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0], weeks: e.weeks.size, mentions: e.convos, lastAt: e.lastAt }))
    .sort((a, b) => b.weeks - a.weeks || b.mentions - a.mentions || b.lastAt - a.lastAt)
    .slice(0, max);
}

// ---------- the whole picture ----------

export type Patterns = {
  enough: boolean;
  mood: { days: MoodDay[]; thisWeek: number | null; before: number | null; trend: Trend; line: string; checkedToday: boolean };
  people: PersonPattern[];
  themes: ThemePattern[];
  followThrough: { added: number; done: number; addedBefore: number; doneBefore: number; line: string };
  /** The single most useful line, for the Today card. */
  headline: string;
};

/** 0 = the 7 days ending today, 1 = the 7 days before that, … */
export function weekIndex(at: number, now: number): number {
  return Math.floor((startOfDay(now) + DAY - 1 - at) / (7 * DAY));
}

export function patternsFor(state: Pick<AppState, "conversations" | "todos" | "memories" | "moods">, now: number, weeks = 4): Patterns {
  const moods = state.moods ?? [];
  const convos = state.conversations.filter((c) => c.source !== "sample");

  // Mood
  const days = moodDays(moods, convos, now, weeks * 7);
  const scored = (from: number, to: number) => days.slice(days.length - to, days.length - from).map((d) => d.score).filter((x): x is number => x !== null);
  const thisWeekScores = scored(0, 7);
  const beforeScores = scored(7, weeks * 7);
  const thisWeek = thisWeekScores.length ? round1(avg(thisWeekScores)) : null;
  const before = beforeScores.length ? round1(avg(beforeScores)) : null;
  const trend = trendOf(thisWeek, before, 0.4);
  const word = (x: number) => MOOD_LABELS[Math.max(0, Math.min(4, Math.round(x) - 1))]!.toLowerCase();
  const moodLine =
    thisWeek === null ? "Log how today felt to start seeing your mood over time."
    : trend === "up" ? `You've felt better this week (mostly ${word(thisWeek)}) than the weeks before (${word(before!)}).`
    : trend === "down" ? `This week has felt harder (mostly ${word(thisWeek)}) than the weeks before (${word(before!)}).`
    : trend === "steady" ? `Your mood has been steady: mostly ${word(thisWeek)}.`
    : `This week has felt mostly ${word(thisWeek)}.`;

  // People
  const known = namesFromMemories(state.memories);
  const counts = new Map<string, number[]>();
  for (const c of convos) {
    const w = weekIndex(c.at, now);
    if (w < 0 || w >= weeks) continue;
    for (const name of peopleIn(c, known)) {
      const arr = counts.get(name) ?? new Array<number>(weeks).fill(0);
      arr[weeks - 1 - w]! += 1; // oldest first
      counts.set(name, arr);
    }
  }
  const people: PersonPattern[] = [...counts.entries()]
    .map(([name, ws]) => {
      const thisW = ws[weeks - 1]!;
      const usual = round1(avg(ws.slice(0, weeks - 1)));
      const total = ws.reduce((a, b) => a + b, 0);
      const shift: Trend = total < 2 ? "unknown" : thisW >= usual + 2 || (usual === 0 && thisW >= 2) ? "up" : usual >= 1 && thisW === 0 ? "down" : "steady";
      const line =
        shift === "up" ? `More time with ${name} this week (${thisW}, usually ${fmtUsual(usual)}).`
        : shift === "down" ? `You haven't talked with ${name} this week (usually ${fmtUsual(usual)}).`
        : `${name}: ${thisW} this week.`;
      return { name, weeks: ws, thisWeek: thisW, usual, shift, line, total };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map(({ total: _t, ...p }) => p);

  // Themes (people's names are patterns of their own, not themes)
  const allNames = new Set(known);
  for (const c of convos) for (const n of peopleIn(c, [])) allNames.add(n);
  const themes = recurringThemes(convos, now, weeks, 6, [...allNames]);

  // Follow-through
  const inWeek = (at: number | undefined, w: number) => at !== undefined && weekIndex(at, now) === w;
  const real = state.todos.filter((t) => !t.suggested);
  const added = real.filter((t) => inWeek(t.createdAt, 0)).length;
  const done = real.filter((t) => inWeek(t.doneAt, 0)).length;
  const addedBefore = real.filter((t) => inWeek(t.createdAt, 1)).length;
  const doneBefore = real.filter((t) => inWeek(t.doneAt, 1)).length;
  const ftLine =
    added + done === 0 ? "No to-dos this week yet."
    : done >= added ? `You finished ${done} thing${done === 1 ? "" : "s"} this week: as many as you added, or more.`
    : `You finished ${done} of the ${added} thing${added === 1 ? "" : "s"} you added this week.`;

  const shifted = people.find((p) => p.shift !== "steady" && p.shift !== "unknown");
  const headline =
    trend === "up" || trend === "down" ? moodLine
    : shifted ? shifted.line
    : themes[0] ? `"${themes[0].word}" keeps coming up (${themes[0].weeks} of the last ${weeks} weeks).`
    : thisWeek !== null ? moodLine
    : ftLine;

  const enough = days.some((d) => d.score !== null) || people.length > 0 || themes.length > 0 || added + done > 0;
  return {
    enough,
    mood: { days, thisWeek, before, trend, line: moodLine, checkedToday: moods.some((m) => m.day === dayKey(now)) },
    people,
    themes,
    followThrough: { added, done, addedBefore, doneBefore, line: ftLine },
    headline,
  };
}

/** Notes for the AI weekly reflection: dated summaries and mood, never more than needed. */
export function reflectionNotes(state: Pick<AppState, "conversations" | "moods">, now: number, weeks = 4): { id: string; text: string }[] {
  const since = startOfDay(now) - (weeks * 7 - 1) * DAY;
  const convos = state.conversations
    .filter((c) => c.source !== "sample" && c.at >= since)
    .slice(0, 60)
    .map((c) => ({ id: c.id, text: `${new Date(c.at).toDateString()} · ${c.title}: ${(c.summary.length ? c.summary.join(" ") : c.text.slice(0, 600))}` }));
  const moods = (state.moods ?? [])
    .filter((m) => m.at >= since)
    .map((m) => ({ id: `mood-${m.day}`, text: `${new Date(m.at).toDateString()} · Mood check-in: ${MOOD_LABELS[m.score - 1]} (${m.score}/5)` }));
  return [...moods, ...convos];
}

export const REFLECTION_QUESTION =
  "Look across these weeks and tell me, in three short lines: how I've been feeling and whether it changed, who I've been spending more or less time with, and what keeps coming up. Kind and plain. Use only the notes.";

// ---------- helpers ----------

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const fmtUsual = (x: number) => (x < 1 ? "less than once a week" : `${Math.round(x)} a week`);
const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").split(" ")[0]!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
