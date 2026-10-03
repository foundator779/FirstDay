import { parseDue } from "./dates";
import { extract, splitLines, type Candidate } from "./extract";
import { capitalize, contentWords, stem } from "./text";
import type { Memory } from "./types";

export type Analysis = {
  title: string;
  summary: string[];
  todos: { text: string; due?: number; quote: string }[];
  memories: { text: string; kind: Memory["kind"]; quote: string }[];
  rules: Candidate[];
  questions: string[];
};

const TODO =
  /\b(?:i'll|i will|i'm going to|i am going to|i need to|i have to|i've got to|i gotta|i should|i must|remind me to|don't forget to|do not forget to|remember to|we need to|we have to|we should|you need to|can you|could you|would you mind|please)\s+(.+)/i;
const MEMORY =
  /\b(my (?:name|birthday|boss|manager|wife|husband|partner|girlfriend|boyfriend|kid|kids|son|daughter|mom|mum|dad|sister|brother|friend|best friend|dog|cat|favorite|favourite|address|doctor|therapist|team|job|shift|schedule|coworker|landlord)\b.*\b(?:is|are|was|starts|ends|works)\b|i'?m allergic|i am allergic|i (?:really )?(?:love|like|hate|prefer|don't like|can't stand|can't eat|don't eat)\b|i work (?:at|as|in|for)|i live (?:in|at|near)|i'm a |i am a |\w+'s birthday is)/i;
const PEOPLE = /\b(boss|manager|wife|husband|partner|girlfriend|boyfriend|kid|son|daughter|mom|mum|dad|sister|brother|friend|birthday|coworker|landlord|therapist|doctor)\b/i;
const WORK = /\b(work|job|shift|boss|manager|team|office|client|customer|schedule|coworker)\b/i;
const FILLER = new Set(["yeah", "okay", "really", "thing", "things", "just", "like", "know", "think", "going", "gonna", "want", "said", "good", "great", "right", "well", "kind", "sort", "actually", "maybe", "today", "tomorrow", "need", "time", "something", "people", "lot", "morning", "heads", "quick", "thanks", "hello", "sure", "perfect", "also"]);

const LEAD = /^(?:(?:by the way|btw|oh|and|also|so|just|then|quickly|um|uh|okay|ok)[,\s]+)+/i;

function cleanTodo(text: string): string {
  let t = text
    .replace(LEAD, "")
    .replace(/[?.!]+$/, "")
    .replace(/\b(for me|please)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 90) t = `${t.slice(0, 87).trim()}…`;
  return capitalize(t);
}

/** "My boss is Dana" -> "Your boss is Dana" */
export function secondPerson(text: string): string {
  return capitalize(
    text
      .replace(LEAD, "")
      .replace(/\bI'm\b/gi, "you're")
      .replace(/\bI am\b/gi, "you are")
      .replace(/\bI've\b/gi, "you've")
      .replace(/\bmy\b/gi, "your")
      .replace(/\bmine\b/gi, "yours")
      .replace(/\bI\b/g, "you")
      .replace(/\bme\b/gi, "you")
      .replace(/[.!]+$/, "")
      .trim(),
  ) + ".";
}

export function sentencesOf(text: string): string[] {
  return splitLines(text)
    .flatMap((line) => line.replace(/([.!?])\s+/g, "$1\n").split("\n"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function summarize(sentences: string[], max = 3): string[] {
  const usable = sentences.filter((s) => s.split(/\s+/).length >= 5 && !s.endsWith("?"));
  if (usable.length <= max) return usable.map(trimLine);
  const freq = new Map<string, number>();
  for (const s of usable) for (const w of contentWords(s)) freq.set(stem(w), (freq.get(stem(w)) ?? 0) + 1);
  const scored = usable.map((s, i) => {
    const ws = contentWords(s).map(stem);
    const score = ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.sqrt(Math.max(ws.length, 1));
    return { s, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => trimLine(x.s));
}

function trimLine(s: string): string {
  return s.length > 150 ? `${s.slice(0, 147).trim()}…` : s;
}

export function titleFor(text: string): string {
  const freq = new Map<string, { word: string; n: number }>();
  for (const w of contentWords(text)) {
    if (w.length < 4 || w.includes("'") || FILLER.has(w)) continue;
    const key = stem(w);
    const cur = freq.get(key);
    freq.set(key, { word: cur?.word ?? w, n: (cur?.n ?? 0) + 1 });
  }
  const top = [...freq.values()].sort((a, b) => b.n - a.n).slice(0, 2).map((x) => x.word);
  if (top.length === 0) return "Quick note";
  return capitalize(top.join(" & "));
}

const SPEAKER_LINE = /^(?:\[[^\]]*\]\s*)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?([A-Z][\w .'-]{0,30}|Speaker \d+)\s*:\s+(.*)$/;
const SELF = /^(me|i|you|myself)$/i;
const FIRST_PERSON_TODO = /^(?:i'll|i will|i'm going to|i am going to|i need to|i have to|i've got to|i gotta|i should|i must)\b/i;

/** Lines with the speaker split off. `speaker` is undefined for unlabelled lines or the user ("Me:"). */
export function speakerLines(text: string): { speaker?: string; text: string }[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = SPEAKER_LINE.exec(line);
      if (!m) return { text: line };
      const name = m[1]!.trim();
      return SELF.test(name) ? { text: m[2]! } : { speaker: name, text: m[2]! };
    });
}

function thirdPerson(text: string, who: string): string {
  return capitalize(
    text
      .replace(LEAD, "")
      .replace(/\bI'm\b/gi, `${who} is`)
      .replace(/\bI am\b/gi, `${who} is`)
      .replace(/\bmy\b/gi, `${who}'s`)
      .replace(/\bI\b/g, who)
      .replace(/[.!]+$/, "")
      .trim(),
  ) + ".";
}

export function analyzeLocally(text: string, now: number): Analysis {
  const sentences = sentencesOf(text);
  const { candidates, questions } = extract(text);
  const ruleQuotes = [...new Set(candidates.map((c) => c.quote))];
  const todos: Analysis["todos"] = [];
  const memories: Analysis["memories"] = [];
  const seen = new Set<string>();
  for (const line of speakerLines(text)) {
    for (const s of line.text.replace(/([.!?])\s+/g, "$1\n").split("\n").map((x) => x.trim()).filter(Boolean)) {
      if (ruleQuotes.some((q) => q.includes(s) || s.includes(q))) continue;
      const todo = TODO.exec(s);
      if (todo && !(line.speaker && FIRST_PERSON_TODO.test(todo[0]))) {
        const t = cleanTodo(todo[1]!);
        if (t.split(/\s+/).length >= 2 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          const due = parseDue(s, now);
          todos.push(due ? { text: t, due, quote: s } : { text: t, quote: s });
        }
      }
      if (MEMORY.test(s) && !s.endsWith("?")) {
        const kind: Memory["kind"] = line.speaker || PEOPLE.test(s) ? "people" : WORK.test(s) ? "work" : "me";
        memories.push({ text: line.speaker ? thirdPerson(s, line.speaker) : secondPerson(s), kind, quote: s });
      }
    }
  }
  return {
    title: candidates.length >= 2 ? `Training: ${titleFor(candidates.map((c) => c.situation).join(" "))}` : titleFor(speakerLines(text).map((l) => l.text).join(" ")),
    summary: summarize(sentences),
    todos: todos.slice(0, 8),
    memories: memories.slice(0, 8),
    rules: candidates,
    questions,
  };
}
