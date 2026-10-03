import { contentWords, hashString, shuffle, stem } from "./text";
import type { AppState, Pack, Rule, RuleProgress, SessionMode } from "./types";

const DAY = 86400_000;
/** Review gaps by level: right away, 1 day, 3 days, 1 week, 2 weeks. */
const GAPS = [0, DAY, 3 * DAY, 7 * DAY, 14 * DAY];

const GENERIC_WRONG = [
  "Handle it however seems fastest.",
  "Ask them to come back later.",
  "Skip it. It's not a big deal.",
  "Wait for a coworker to deal with it.",
];

export type Choice = { text: string; correct: boolean };

export function buildChoices(rule: Rule, pack: Pack, attempt: number): Choice[] {
  const pool: string[] = [];
  if (rule.changedFrom) pool.push(rule.changedFrom);
  for (const d of rule.distractors ?? []) pool.push(d);
  for (const r of shuffle(pack.rules.filter((r) => r.id !== rule.id), hashString(rule.id))) pool.push(r.action);
  for (const g of GENERIC_WRONG) pool.push(g);
  const wrong: string[] = [];
  for (const p of pool) {
    if (wrong.length >= 2) break;
    if (p.trim().toLowerCase() === rule.action.trim().toLowerCase() || wrong.includes(p)) continue;
    wrong.push(p);
  }
  return shuffle(
    [{ text: rule.action, correct: true }, ...wrong.map((text) => ({ text, correct: false }))],
    hashString(`${rule.id}:${attempt}`),
  );
}

export type Grade = { pass: boolean; hits: string[]; misses: string[] };

/** Typed/dictated answers pass when most key words are present (any order, simple word endings ignored). */
export function gradeWords(answer: string, rule: Rule): Grade {
  const said = new Set(contentWords(answer).map(stem));
  const keys = rule.keywords.length ? rule.keywords : contentWords(rule.action).slice(0, 5);
  const hits = keys.filter((k) => said.has(stem(k)));
  const misses = keys.filter((k) => !said.has(stem(k)));
  const ratio = keys.length ? hits.length / keys.length : 0;
  let pass = ratio >= 0.6;
  // A change drill must not accept the old answer.
  if (pass && rule.changedFrom) {
    const oldOnly = contentWords(rule.changedFrom).map(stem).filter((w) => !keys.map(stem).includes(w) && !contentWords(rule.action).map(stem).includes(w));
    if (oldOnly.some((w) => said.has(w))) pass = false;
  }
  return { pass, hits, misses };
}

export function nextProgress(prev: RuleProgress | undefined, firstTry: boolean, now: number): RuleProgress {
  const level = firstTry ? Math.min((prev?.level ?? 0) + 1, GAPS.length - 1) : Math.max((prev?.level ?? 0) - 1, 0);
  return {
    level,
    due: now + (firstTry ? GAPS[level]! : 10 * 60_000),
    seen: true,
    tries: (prev?.tries ?? 0) + 1,
    firstTryWins: (prev?.firstTryWins ?? 0) + (firstTry ? 1 : 0),
    last: now,
  };
}

export type PackStats = { total: number; seen: number; due: number; solid: number };

export function packStats(pack: Pack, progress: AppState["progress"], now: number): PackStats {
  let seen = 0;
  let due = 0;
  let solid = 0;
  for (const r of pack.rules) {
    const p = progress[r.id];
    if (!p?.seen) continue;
    seen++;
    if (p.due <= now) due++;
    if (p.level >= 3) solid++;
  }
  return { total: pack.rules.length, seen, due, solid };
}

export function queueFor(pack: Pack, mode: SessionMode, progress: AppState["progress"], size: number, now: number): string[] {
  if (mode === "change") return pack.pendingUpdates.map((u) => u.ruleId).slice(0, size);
  const unseen = pack.rules.filter((r) => !progress[r.id]?.seen);
  const due = pack.rules
    .filter((r) => progress[r.id]?.seen && progress[r.id]!.due <= now)
    .sort((a, b) => progress[a.id]!.level - progress[b.id]!.level);
  if (mode === "learn" && unseen.length) return unseen.slice(0, size).map((r) => r.id);
  if (due.length) return due.slice(0, size).map((r) => r.id);
  // Nothing due: practise the shakiest ones.
  return pack.rules
    .slice()
    .sort((a, b) => (progress[a.id]?.level ?? 0) - (progress[b.id]?.level ?? 0))
    .slice(0, size)
    .map((r) => r.id);
}

export type NextTraining =
  | { kind: "resume"; packId: string; mode: SessionMode; left: number }
  | { kind: "change"; packId: string; count: number }
  | { kind: "review"; packId: string; count: number }
  | { kind: "learn"; packId: string; count: number }
  | { kind: "done" };

export function nextTraining(state: AppState, now: number): NextTraining {
  const { resume, packs, progress, settings } = state;
  if (resume && packs.some((p) => p.id === resume.packId)) {
    return { kind: "resume", packId: resume.packId, mode: resume.mode, left: resume.ruleIds.length - resume.index };
  }
  for (const p of packs) {
    const s = packStats(p, progress, now);
    if (p.pendingUpdates.length && s.seen === s.total) return { kind: "change", packId: p.id, count: p.pendingUpdates.length };
  }
  let best: { id: string; due: number } | undefined;
  for (const p of packs) {
    const s = packStats(p, progress, now);
    if (s.due > (best?.due ?? 0)) best = { id: p.id, due: s.due };
  }
  if (best) return { kind: "review", packId: best.id, count: Math.min(best.due, settings.cardsPerSession) };
  for (const p of packs) {
    const s = packStats(p, progress, now);
    if (s.seen < s.total) return { kind: "learn", packId: p.id, count: Math.min(s.total - s.seen, settings.cardsPerSession) };
  }
  return { kind: "done" };
}

/** Words of `text` that match a keyword, for the highlighter. */
export function markWords(text: string, keywords: string[]): { text: string; mark: boolean }[] {
  const keys = new Set(keywords.map((k) => stem(k.toLowerCase())));
  return text.split(/(\s+)/).map((part) => {
    const bare = part.toLowerCase().replace(/[^a-z0-9']/g, "");
    return { text: part, mark: bare.length > 0 && keys.has(stem(bare)) };
  });
}

export type Understanding = {
  verdict: "match" | "partial" | "different";
  matched: string[];
  missing: string[];
  /** Words the learner used that belong to the old (changed) rule. */
  outdated: string[];
};

/**
 * "Check what I understood": compare what the learner says they would do with the
 * exact source, before any practice. Nothing here is graded or saved as a score.
 */
export function compareUnderstanding(intended: string, rule: Rule): Understanding {
  const g = gradeWords(intended, rule);
  const said = new Set(contentWords(intended).map(stem));
  const current = new Set(contentWords(rule.action).map(stem));
  const outdated = rule.changedFrom
    ? contentWords(rule.changedFrom).filter((w) => !current.has(stem(w)) && said.has(stem(w)))
    : [];
  const verdict = outdated.length ? "different" : g.pass ? "match" : g.hits.length ? "partial" : "different";
  return { verdict, matched: g.hits, missing: g.misses, outdated };
}
