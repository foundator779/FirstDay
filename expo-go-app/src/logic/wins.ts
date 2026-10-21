// My record: proof for your performance review or promotion, in other people's own words.
//
// Two kinds of wins:
// - Praise and thanks heard in a Bee conversation ("Great job handling that refund this morning"). FirstDay finds the
//   lines on this phone and suggests them; nothing goes on your record until you keep it and say who said it (Bee
//   labels every speaker "Unknown").
// - What you learned in FirstDay Go ("Learned all 3 Juniper Café steps", "Picked up Rosa's change to the cracked-mug
//   step"), added when it happens.
// "Copy for my review" turns the record into a dated list you can paste into a self-review.
import { uid } from "./text";
import type { AppState, Pack, Win } from "./types";

// Praise or thanks aimed at you. Kept narrow on purpose: a missed compliment costs little, a fake one costs trust.
const PRAISE = [
  /\b(great|good|nice|awesome|excellent|amazing|fantastic|brilliant|solid|terrific)\s+(job|work)\b/i,
  /\bwell done\b/i,
  /\b(thanks|thank you)\s+(so much\s+|a lot\s+)?for\b/i,
  /\byou\s+(really\s+)?(nailed|crushed|handled|killed)\s+(it|that|the)\b/i,
  /\byou(?:'re| are)\s+(the\s+)?(fastest|best|quickest|a natural|doing (great|really well|so well|well))\b/i,
  /\b(that|it)\s+(really\s+)?helped\b/i,
  /\bproud of you\b/i,
  /\bimpressed\b/i,
];
// Asking someone else to thank or praise isn't praise for you.
const NOT_FOR_YOU = /^(can|could|would|will) you\b|^(please|remember to|tell|ask)\b/i;

const speakerless = (line: string) => line.replace(/^\s*[\w .'-]{1,30}:\s+/, "").trim();

/** Lines of a conversation that praise or thank you, word for word (speaker label removed), in order, no repeats. */
export function findPraise(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = speakerless(raw);
    if (!line || NOT_FOR_YOU.test(line)) continue;
    if (PRAISE.some((p) => p.test(line)) && !out.includes(line)) out.push(line);
  }
  return out;
}

/** Suggested wins from one conversation. `who` is a guess you confirm (Bee doesn't name speakers). */
export function praiseWins(text: string, convo: { id: string; at: number; source?: Win["source"]; replayId?: string }, who: string, now: number): Win[] {
  return findPraise(text).map((quote) => ({
    id: uid("win"), kind: "praise", text: quote, quote, who, at: convo.at || now, fromId: convo.id, suggested: true,
    ...(convo.source ? { source: convo.source } : {}),
    ...(convo.replayId ? { replay: true } : {}),
  }));
}

const steps = (n: number) => `${n} step${n === 1 ? "" : "s"}`;

/**
 * Milestones reached by an answer to `ruleId` (progress already updated): every step of a training practised for the
 * first time, and a step your trainer changed answered the new way. Each happens once (`key`).
 */
export function practiceWins(state: Pick<AppState, "packs" | "progress" | "wins">, ruleId: string, firstTry: boolean, now: number): Win[] {
  const pack = state.packs.find((p) => p.rules.some((r) => r.id === ruleId));
  if (!pack) return [];
  const have = new Set(state.wins.map((w) => w.key).filter(Boolean));
  const out: Win[] = [];
  const add = (key: string, text: string) => {
    if (have.has(key)) return;
    have.add(key);
    out.push({ id: uid("win"), kind: "practice", text, at: now, suggested: false, key, packId: pack.id });
  };
  if (pack.rules.length && pack.rules.every((r) => state.progress[r.id]?.seen)) {
    add(`learned:${pack.id}`, `Learned all ${steps(pack.rules.length)} of ${pack.title}`);
  }
  const rule = pack.rules.find((r) => r.id === ruleId);
  if (rule?.changedFrom && firstTry) {
    add(`changed:${rule.id}:${rule.action}`, `Picked up ${who(pack)}'s change: ${short(rule.action)}`);
  }
  return out;
}

const who = (pack: Pack) => (pack.trainer && pack.trainer !== "Your trainer" ? pack.trainer : "the trainer");
const short = (t: string) => {
  const s = t.trim().replace(/[.!?]+$/, "");
  return s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s;
};

const MONTH: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** Kept wins, newest first, grouped by month ("October 2026"). */
export function byMonth(wins: Win[]): { month: string; wins: Win[] }[] {
  const kept = wins.filter((w) => !w.suggested).sort((a, b) => b.at - a.at);
  const out: { month: string; wins: Win[] }[] = [];
  for (const w of kept) {
    const m = new Date(w.at).toLocaleDateString("en-US", MONTH);
    const last = out[out.length - 1];
    if (last?.month === m) last.wins.push(w);
    else out.push({ month: m, wins: [w] });
  }
  return out;
}

/** The record as plain text, ready to paste into a self-review: dated, quoted, with where each came from. */
export function reviewText(wins: Win[]): string {
  const groups = byMonth(wins);
  if (!groups.length) return "";
  const lines = ["My record (from FirstDay Go)", ""];
  for (const g of groups) {
    lines.push(g.month);
    for (const w of g.wins) {
      const day = new Date(w.at).toLocaleDateString("en-US", DAY);
      lines.push(
        w.kind === "praise"
          ? `• ${day}: “${w.quote ?? w.text}”${w.who ? ` (${w.who})` : ""}${w.source === "bee" ? `, recorded by Bee${w.replay ? " (replay)" : ""}` : ""}`
          : `• ${day}: ${w.text}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
