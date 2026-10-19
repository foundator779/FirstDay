// The FirstDay coach, shared by the coach Agent Skill's CLI (brain/firstday.mjs) and the coach MCP server
// in AWS (infra/coach-lambda). It only ever uses steps the user confirmed against the trainer's exact
// words: pick what to quiz, check an answer against the trainer's key words, find a step, list changes.
// Plain JavaScript, no dependencies. The grading mirrors the app's (src/logic/training.ts, src/logic/text.ts).

const STOP = new Set(
  ("a an the and or but if then than so to of in on at by for from with into onto it its it's this that these those " +
    "is are was were be been being do does did doing you your yours we our us they them their he she his her i me my " +
    "as up out over under before after when whenever while once also just only both each any all some no not " +
    "can could will would should must may might shall have has had get got make sure please let lets let's " +
    "there here what which who whom how about give gets").split(/\s+/),
);

export function stem(word) {
  let w = String(word).toLowerCase();
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export const contentWords = (text) => words(text).filter((w) => w.length > 2 && !STOP.has(w));

/** The text without its contrast clause (", not the grey bin", "instead of …"): those words name the old way. */
export const withoutContrast = (text) => String(text ?? "").replace(/(,\s*(?:and\s+)?not\b|\binstead of\b|\brather than\b)[^,.;!?]*/gi, " ");

/** An answer without what it names only to reject ("blue crate, not the grey bin"; commas optional, as in speech). */
export const answerWithoutContrast = (text) => String(text ?? "").replace(/\b(not|instead of|rather than)\b[^,.;!?]*/gi, " ");

export function keywordsFor(text, max = 5) {
  const seen = new Set();
  const out = [];
  for (const w of contentWords(withoutContrast(text))) {
    const s = stem(w);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

function overlap(a, b) {
  const A = new Set(contentWords(a).map(stem));
  const B = new Set(contentWords(b).map(stem));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.min(A.size, B.size);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keeps only the fields the coach needs, with size limits. The same shape the app sends (packsForCoach). */
export function cleanPacks(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 50)
    .map((p) => ({
      id: str(p?.id, 80),
      title: str(p?.title, 120) || "Training",
      trainer: str(p?.trainer, 80) || "Your trainer",
      sample: p?.sample === true,
      questions: Array.isArray(p?.questions) ? p.questions.slice(0, 20).map((q) => str(q, 300)).filter(Boolean) : [],
      rules: Array.isArray(p?.rules)
        ? p.rules
            .slice(0, 100)
            .map((r) => ({
              id: str(r?.id, 80),
              situation: str(r?.situation, 300),
              action: str(r?.action, 400),
              quote: str(r?.quote, 600),
              ...(Array.isArray(r?.keywords) && r.keywords.length ? { keywords: r.keywords.slice(0, 8).map((k) => str(k, 40)).filter(Boolean) } : {}),
              ...(str(r?.customerLine, 300) ? { customerLine: str(r.customerLine, 300) } : {}),
              ...(str(r?.changedFrom, 400) ? { changedFrom: str(r.changedFrom, 400) } : {}),
              level: Number.isFinite(r?.level) ? Math.max(0, Math.min(4, Math.round(r.level))) : 0,
            }))
            .filter((r) => r.situation && r.action)
        : [],
    }))
    .filter((p) => p.rules.length);
}

/** One row per confirmed step, with its training's title and trainer. */
export function flatten(packs) {
  return packs.flatMap((p) => p.rules.map((r) => ({ pack: p.title, packId: p.id, trainer: p.trainer, sample: p.sample, ...r })));
}

/** Trainings whose title shares a word with `pick` (all of them when `pick` is empty). */
export function choosePacks(packs, pick) {
  const want = words(pick ?? "").filter((w) => w.length > 2);
  if (!want.length) return packs;
  return packs.filter((p) => words(p.title).some((w) => want.includes(w)));
}

/** Up to `count` steps to quiz, shakiest first; `rand` varies the order within a level. */
export function pickQuiz(rows, count = 3, rand = Math.random) {
  const n = Math.max(1, Math.min(10, Number(count) || 3));
  return rows
    .map((r) => ({ r, k: r.level + rand() * 0.9 }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.r);
}

/** The step a situation or id refers to (an exact id, else the best word overlap with the situation). */
export function findStep(rows, { id, situation } = {}) {
  if (id) {
    const hit = rows.find((r) => r.id === id);
    if (hit) return hit;
  }
  if (!situation) return null;
  let best = null;
  let bestScore = 0;
  for (const r of rows) {
    const s = overlap(situation, `${r.situation} ${r.customerLine ?? ""}`);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/**
 * Checks a spoken or typed answer the way the app does: it passes when most of the trainer's key words are
 * there (any order, simple word endings ignored). After a rule changed, the old way never passes.
 */
export function grade(answer, step) {
  const said = new Set(contentWords(answer).map(stem));
  const keys = step.keywords?.length ? step.keywords : keywordsFor(step.action);
  const hits = keys.filter((k) => said.has(stem(k)));
  const misses = keys.filter((k) => !said.has(stem(k)));
  let pass = keys.length ? hits.length / keys.length >= 0.6 : false;
  let oldWay = false;
  if (step.changedFrom) {
    const current = new Set([...keys.map(stem), ...contentWords(withoutContrast(step.action)).map(stem)]);
    const oldOnly = contentWords(step.changedFrom).map(stem).filter((w) => !current.has(w));
    const meant = new Set(contentWords(answerWithoutContrast(answer)).map(stem));
    oldWay = oldOnly.some((w) => meant.has(w));
    if (oldWay) pass = false;
  }
  return { pass, hits, misses, oldWay };
}

/** Best matches for a question like "what do I do with a cracked mug". */
export function findRules(rows, query, max = 5) {
  const q = contentWords(query).map(stem);
  return rows
    .map((r) => {
      const have = new Set(contentWords(`${r.situation} ${r.action} ${r.quote} ${r.customerLine ?? ""}`).map(stem));
      return { r, score: q.filter((w) => have.has(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.r);
}

export const changedRules = (rows) => rows.filter((r) => r.changedFrom);

/** One line of feedback that always quotes the trainer. */
export function feedback(result, step) {
  const said = `${step.trainer} said: "${step.quote}"`;
  if (result.pass) return `Yes, that's it. ${said}`;
  if (result.oldWay) return `That's the old way. It changed. Now: ${step.action} ${said}`;
  return `Not quite. ${step.action} ${said}`;
}
