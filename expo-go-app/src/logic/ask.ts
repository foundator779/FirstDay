import { sentencesOf } from "./analyze";
import { friendlyDay, friendlyDue, isSameDay } from "./dates";
import { contentWords, stem } from "./text";
import type { AppState } from "./types";

export type Answer = { text: string; sources: string[] };

type Chunk = { text: string; label: string; id: string; boost: number };

function chunks(state: AppState, now: number): Chunk[] {
  const out: Chunk[] = [];
  for (const m of state.memories) if (!m.suggested) out.push({ text: m.text, label: "Memory", id: m.id, boost: 1.3 });
  for (const t of state.todos) if (!t.suggested && t.bucket !== "done") out.push({ text: t.text, label: "To-do", id: t.id, boost: 1.1 });
  for (const c of state.conversations) {
    for (const s of sentencesOf(c.text)) out.push({ text: s, label: `${c.title} · ${friendlyDay(c.at, now)}`, id: c.id, boost: 1 });
  }
  for (const p of state.packs) for (const r of p.rules) out.push({ text: `${r.situation} ${r.action}`, label: p.title, id: p.id, boost: 1 });
  return out;
}

/**
 * On-phone answer: a few direct intents, then plain keyword search across
 * memories, to-dos and conversations. Always says where the answer came from.
 */
export function askLocally(question: string, state: AppState, now: number): Answer {
  const q = question.toLowerCase();
  const openTodos = state.todos.filter((t) => !t.suggested && t.bucket !== "done");

  if (/\b(to-?dos?|tasks?|on my plate|need to do|have to do|what should i do|what's next|whats next)\b/.test(q)) {
    if (!openTodos.length) return { text: "Your to-do list is empty. Nice.", sources: [] };
    const now1 = openTodos.filter((t) => t.bucket === "now");
    const pick = (now1.length ? now1 : openTodos).slice(0, 3);
    return {
      text:
        `Start with just this: ${pick[0]!.text}.` +
        (pick.length > 1 ? `\n\nAfter that: ${pick.slice(1).map((t) => t.text + (t.due ? ` (${friendlyDue(t.due, now)})` : "")).join("; ")}.` : ""),
      sources: pick.map((t) => t.id),
    };
  }

  const day = /\byesterday\b/.test(q) ? now - 86400_000 : /\btoday\b|\bmy day\b/.test(q) ? now : undefined;
  if (day !== undefined && /\b(talk|happen|said|say|discuss|conversation|summary|summarize|recap|day|do)\b/.test(q)) {
    const convos = state.conversations.filter((c) => isSameDay(c.at, day));
    if (!convos.length) return { text: `I don't have any conversations from ${day === now ? "today" : "yesterday"} yet.`, sources: [] };
    return {
      text: convos
        .slice(0, 4)
        .map((c) => `• ${c.title}: ${c.summary[0] ?? c.text.slice(0, 100)}`)
        .join("\n"),
      sources: convos.map((c) => c.id),
    };
  }

  if (/\b(about me|know about me|remember about|my memories)\b/.test(q)) {
    const mems = state.memories.filter((m) => !m.suggested).slice(0, 5);
    if (!mems.length) return { text: "I haven't saved any memories yet. They come from your conversations.", sources: [] };
    return { text: mems.map((m) => `• ${m.text}`).join("\n"), sources: mems.map((m) => m.id) };
  }

  const qWords = new Set(contentWords(q).map(stem));
  if (qWords.size === 0) return { text: "Try asking with a few more words, like “What did Maya say about posters?”", sources: [] };
  const scored = chunks(state, now)
    .map((c) => {
      const words = new Set(contentWords(c.text).map(stem));
      let hit = 0;
      qWords.forEach((w) => {
        if (words.has(w)) hit++;
      });
      return { c, score: (hit / qWords.size) * c.boost };
    })
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const top = scored.filter((x) => (seen.has(x.c.text) ? false : (seen.add(x.c.text), true))).slice(0, 3);
  if (!top.length) return { text: "I couldn't find that in your conversations, to-dos or memories yet.", sources: [] };
  return {
    text: `Here's what I found:\n${top.map((x) => `• “${x.c.text}”\n   ${x.c.label}`).join("\n")}`,
    sources: [...new Set(top.map((x) => x.c.id))],
  };
}
