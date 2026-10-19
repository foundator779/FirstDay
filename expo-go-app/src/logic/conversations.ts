// Finding a conversation again. Every conversation you bring in stays on this phone until you delete it;
// these helpers group them by the training they became, so "what exactly did Rosa say?" is two taps away.
// Pure, so it's tested. Nothing here is stored: links are worked out from each step's exact quote.
import type { AppState, Conversation, Pack } from "./types";

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Steps of this training whose exact quote appears in the conversation (how a step points back to what was said). */
export function stepsFrom(convo: Conversation, pack: Pack): number {
  const text = ` ${squash(convo.text)} `;
  const found = (quote: string | undefined) => {
    const q = squash(quote ?? "");
    return q.length >= 12 && text.includes(` ${q} `);
  };
  // A trainer's update waiting as a Change Drill counts too, so "Quick update from Rosa" sits with its training.
  return pack.rules.filter((r) => found(r.quote)).length + (pack.pendingUpdates ?? []).filter((u) => found(u.quote)).length;
}

export type ConvoRow = { convo: Conversation; steps: number; questions: number; todos: number };
export type ConvoGroup = { packId: string | null; title: string; rows: ConvoRow[] };

function rowFor(state: AppState, convo: Conversation, pack: Pack | null): ConvoRow {
  return {
    convo,
    steps: pack ? stepsFrom(convo, pack) : 0,
    questions: state.questions.filter((q) => q.fromId === convo.id).length,
    todos: state.todos.filter((t) => t.fromId === convo.id && !t.suggested).length,
  };
}

/** The training a conversation fed most (by steps quoted from it), or null. Ties go to the newer training. */
export function trainingOf(state: AppState, convo: Conversation): Pack | null {
  let best: Pack | null = null;
  let most = 0;
  for (const p of state.packs) {
    const n = stepsFrom(convo, p);
    if (n > most || (n === most && n > 0 && best && p.createdAt > best.createdAt)) {
      best = p;
      most = n;
    }
  }
  if (best) return best;
  // No step quoted from it (a conversation that only had questions): follow its questions to their training.
  const viaQuestion = state.questions.find((q) => q.fromId === convo.id && q.packId)?.packId;
  return state.packs.find((p) => p.id === viaQuestion) ?? null;
}

const belongs = (state: AppState, c: Conversation, pack: Pack) =>
  stepsFrom(c, pack) > 0 || state.questions.some((q) => q.fromId === c.id && q.packId === pack.id);

/** Conversations a training came from, oldest first, so a later change ("Quick update from Rosa") reads in order. */
export function conversationsForPack(state: AppState, packId: string): ConvoRow[] {
  const pack = state.packs.find((p) => p.id === packId);
  if (!pack) return [];
  return state.conversations
    .filter((c) => belongs(state, c, pack))
    .sort((a, b) => a.at - b.at)
    .map((c) => rowFor(state, c, pack));
}

/** Every conversation, grouped by training (most recently recorded first), then "Other". Newest first inside each. */
export function conversationsByTraining(state: AppState): ConvoGroup[] {
  const groups = new Map<string, ConvoGroup>();
  const other: ConvoGroup = { packId: null, title: "Other conversations", rows: [] };
  for (const c of [...state.conversations].sort((a, b) => b.at - a.at)) {
    const pack = trainingOf(state, c);
    if (!pack) {
      other.rows.push(rowFor(state, c, null));
      continue;
    }
    const g = groups.get(pack.id) ?? { packId: pack.id, title: pack.title, rows: [] };
    g.rows.push(rowFor(state, c, pack));
    groups.set(pack.id, g);
  }
  return [...groups.values(), ...(other.rows.length ? [other] : [])];
}

/** "3 steps · 1 question · 2 to-dos", leaving out zeros. */
export function foundLine(r: Pick<ConvoRow, "steps" | "questions" | "todos">): string {
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : "");
  return [part(r.steps, "step"), part(r.questions, "question"), part(r.todos, "to-do")].filter(Boolean).join(" · ") || "Nothing to practise";
}
