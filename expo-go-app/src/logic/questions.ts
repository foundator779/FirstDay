// Questions for your trainer: the vague lines ("maybe allow another day") that FirstDay never turns into
// a rule. They get their own tab, so they're asked before the next shift instead of buried in to-dos.
import { uid } from "./text";
import type { AppState, Pack, TrainerQuestion } from "./types";

/** To-dos older versions made from vague lines. Only this exact prefix, so "Ask Mom: …" stays a to-do. */
const OLD_TODO = /^Ask your trainer: +(.+)$/;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** New questions from an analysed conversation. */
export function questionsFrom(texts: string[], fromId: string, now: number, packId?: string): TrainerQuestion[] {
  const seen = new Set<string>();
  const out: TrainerQuestion[] = [];
  for (const raw of texts) {
    const text = raw.trim();
    if (!text || seen.has(norm(text))) continue;
    seen.add(norm(text));
    out.push({ id: uid("q"), text, quote: quoteOf(text), fromId, createdAt: now, ...(packId ? { packId } : {}) });
  }
  return out;
}

/** The vague line inside a question like `“Maybe we'll …” — what is the exact rule here?`. */
export function quoteOf(question: string): string | undefined {
  const m = /^[“"](.+?)[”"]/.exec(question.trim());
  return m?.[1];
}

/** Adds a pack's own questions (sample trainings ship one) without duplicates. */
export function withPackQuestions(questions: TrainerQuestion[], pack: Pack, now: number): TrainerQuestion[] {
  const have = new Set(questions.map((q) => norm(q.text)));
  const fresh = pack.questions
    .filter((q) => q.trim() && !have.has(norm(q)))
    .map((text): TrainerQuestion => ({ id: uid("q"), text, packId: pack.id, createdAt: now }));
  return fresh.length ? [...fresh, ...questions] : questions;
}

/** Open questions first (newest first), then the ones you asked. */
export function openQuestions(state: Pick<AppState, "questions">): TrainerQuestion[] {
  return state.questions.filter((q) => !q.askedAt).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Runs on every load (and changes nothing once done): "Ask your trainer: …" to-dos saved by older versions
 * become questions, and sample trainings' questions are listed. To-dos linked to Bee or with a reminder set
 * stay to-dos, so Bee sync doesn't bring them back and no reminder is left behind.
 */
export function migrateQuestions(state: AppState, now: number): AppState {
  let questions = Array.isArray(state.questions) ? state.questions : [];
  const moved: TrainerQuestion[] = [];
  const todos = state.todos.filter((t) => {
    const m = OLD_TODO.exec(t.text);
    if (!m || t.bucket === "done" || t.beeTodoId || t.beeSuggestionId || t.notificationId) return true;
    moved.push({ id: uid("q"), text: m[1]!.trim(), quote: quoteOf(m[1]!) ?? t.quote, createdAt: t.createdAt, ...(t.fromId ? { fromId: t.fromId } : {}) });
    return false;
  });
  if (moved.length) {
    const have = new Set(questions.map((q) => norm(q.text)));
    questions = [...moved.filter((q) => !have.has(norm(q.text))), ...questions];
  }
  for (const p of state.packs) questions = withPackQuestions(questions, p, now);
  if (!moved.length && questions === state.questions) return state;
  return { ...state, todos, questions };
}
