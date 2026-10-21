// What Today shows: one job, being ready for your next shift. Pure, so the order is tested.
import { openQuestions } from "./questions";
import { nextTraining, packStats } from "./training";
import type { AppState } from "./types";

export type NextKind = "bee" | "change" | "steps" | "practice" | "questions" | "team" | "wins" | "start";

export type NextThing = {
  kind: NextKind;
  kicker: string;
  title: string;
  sub: string;
  cta: string;
  /** Where the button goes (an app route, with params for Bee). */
  href: string;
  params?: Record<string, string>;
  /** Bee inbox id, so "Not now" can dismiss it. */
  beeId?: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * In order: a training Bee just recorded, a rule your trainer changed, steps waiting for your OK,
 * practice (resume, review, learn), questions to ask before your shift, a team update to send.
 */
export function nextThings(state: AppState, now: number): NextThing[] {
  const out: NextThing[] = [];

  const fromBee = state.bee.inbox.find((i) => !state.conversations.some((c) => c.beeId === i.id));
  if (fromBee) {
    out.push({
      kind: "bee",
      kicker: "Just recorded by Bee",
      title: fromBee.title,
      // Saying yes here is the OK to read it, so it opens straight into reading (no second consent screen).
      sub: `Turn it into practice while it's fresh? FirstDay Go reads it only if you say yes.${state.bee.inbox.length > 1 ? ` (${state.bee.inbox.length} new)` : ""}`,
      cta: "Yes, read it",
      href: "/capture",
      params: { beeId: fromBee.id, beeTitle: fromBee.title, beeAt: String(fromBee.at), ok: "1" },
      beeId: fromBee.id,
    });
  }

  // Trainer: someone asked to join a training you shared. Nobody gets it until you let them in.
  const asking = state.packs.find((p) => p.team?.role === "trainer" && (p.team.requests ?? 0) > 0);
  if (asking) {
    const n = asking.team?.requests ?? 0;
    out.push({
      kind: "team",
      kicker: "Your team",
      title: `${plural(n, "person", "people")} ${n === 1 ? "wants" : "want"} to join ${asking.title}`,
      sub: "Let in only the people you're training. They get nothing until you do.",
      cta: "Review",
      href: `/pack/${asking.id}`,
    });
  }

  // A change to a step you've practised: unlearn the old way before your next shift.
  for (const p of state.packs) {
    const drills = p.pendingUpdates.filter((u) => state.progress[u.ruleId]?.seen);
    if (!drills.length) continue;
    out.push({
      kind: "change",
      kicker: p.team?.role === "trainee" ? `Update from ${p.trainer}` : "Something changed",
      title: `${p.trainer} changed ${plural(drills.length, "step")} in ${p.title}`,
      sub: "See old vs. new, then practise the new way. About a minute.",
      cta: "See what changed",
      href: `/session/${p.id}`,
      params: { mode: "change" },
    });
    break;
  }

  if (state.suggestedRules.length) {
    const n = state.suggestedRules.length;
    out.push({
      kind: "steps",
      kicker: "Work steps found",
      title: `${plural(n, "instruction")} to check`,
      sub: "Confirm what your trainer said, word for word. Then practise it.",
      cta: "Check them",
      href: "/confirm",
    });
  }

  const t = nextTraining(state, now);
  if (t.kind !== "done" && t.kind !== "change") {
    const pack = state.packs.find((p) => p.id === t.packId);
    const left = t.kind === "resume" ? t.left : t.count;
    const label =
      t.kind === "resume" ? `Pick up where you left off · ${left} left`
      : t.kind === "review" ? `${plural(t.count, "quick review")} before you forget`
      : `Learn ${plural(t.count, "new step")}`;
    out.push({
      kind: "practice",
      kicker: "Practise for your shift",
      title: pack?.title ?? "Practice",
      sub: `${label} · about ${Math.max(1, Math.round(left * 0.8))} min`,
      cta: "Start",
      href: `/session/${t.packId}`,
      params: { mode: t.kind === "resume" ? t.mode : t.kind },
    });
  } else if (t.kind === "change" && !out.some((o) => o.kind === "change")) {
    const pack = state.packs.find((p) => p.id === t.packId);
    out.push({
      kind: "change",
      kicker: "Something changed",
      title: `${pack?.trainer ?? "Your trainer"} changed ${plural(t.count, "step")}`,
      sub: "See old vs. new, then practise the new way.",
      cta: "See what changed",
      href: `/session/${t.packId}`,
      params: { mode: "change" },
    });
  }

  const open = openQuestions(state).length;
  if (open) {
    out.push({
      kind: "questions",
      kicker: "Before your shift",
      title: `${plural(open, "question")} to ask your trainer`,
      sub: "Things that were said vaguely. Ask, so you don't guess.",
      cta: "See them",
      href: "/questions",
    });
  }

  const wins = (state.wins ?? []).filter((w) => w.suggested).length;
  if (wins) {
    out.push({
      kind: "wins",
      kicker: "For your record",
      title: `${plural(wins, "win")} to keep`,
      sub: "Praise from a conversation, word for word. Keep it for your next review.",
      cta: "See it",
      href: "/record",
    });
  }

  const unsent = state.packs.find((p) => p.team?.role === "trainer" && p.team.dirty);
  if (unsent) {
    out.push({
      kind: "team",
      kicker: "Your team",
      title: `Send your changes to ${unsent.title}`,
      sub: `${plural(unsent.team?.members ?? 0, "person", "people")} will get a Change Drill for what changed.`,
      cta: "Review and send",
      href: `/pack/${unsent.id}`,
    });
  }
  return out;
}

export type Readiness = { total: number; solid: number; learned: number; due: number; changed: number; questions: number };

/** "Before your next shift": how ready you are across every training. */
export function readiness(state: AppState, now: number): Readiness {
  let total = 0;
  let solid = 0;
  let learned = 0;
  let due = 0;
  let changed = 0;
  for (const p of state.packs) {
    const s = packStats(p, state.progress, now);
    total += s.total;
    solid += s.solid;
    learned += s.seen;
    due += s.due;
    changed += p.pendingUpdates.length;
  }
  return { total, solid, learned, due, changed, questions: openQuestions(state).length };
}

/** Bee-style extras that live under More, with how many need you. */
export function moreCounts(state: AppState): { toSort: number; now: number; memories: number } {
  return {
    toSort: state.todos.filter((t) => t.suggested).length + state.memories.filter((m) => m.suggested).length,
    now: state.todos.filter((t) => !t.suggested && t.bucket === "now").length,
    memories: state.memories.filter((m) => !m.suggested).length,
  };
}
