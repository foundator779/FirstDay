// The brain's small private memory on your computer: which Bee conversations it has seen, new ones
// waiting for the phone, and the confirmed work rules the phone shared for the FirstDay coach skill.
// Lives in brain/.brain-state.json (git-ignored). Contains your training rules, so don't commit it.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STATE_FILE = process.env.FIRSTDAY_BRAIN_STATE || resolve(dirname(fileURLToPath(import.meta.url)), ".brain-state.json");

const EMPTY = { seen: [], inbox: [], todosChangedAt: 0, packs: [], packsUpdatedAt: 0 };

export function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return structuredClone(EMPTY);
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { ...structuredClone(EMPTY), ...s };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keeps only the fields the coach needs, with size limits. */
export function cleanPacks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map((p) => ({
    id: str(p?.id, 80),
    title: str(p?.title, 120) || "Training",
    trainer: str(p?.trainer, 80) || "Your trainer",
    sample: p?.sample === true,
    questions: Array.isArray(p?.questions) ? p.questions.slice(0, 20).map((q) => str(q, 300)).filter(Boolean) : [],
    rules: Array.isArray(p?.rules)
      ? p.rules.slice(0, 100).map((r) => ({
          id: str(r?.id, 80),
          situation: str(r?.situation, 300),
          action: str(r?.action, 400),
          quote: str(r?.quote, 600),
          ...(str(r?.changedFrom, 400) ? { changedFrom: str(r.changedFrom, 400) } : {}),
          level: Number.isFinite(r?.level) ? Math.max(0, Math.min(4, Math.round(r.level))) : 0,
        })).filter((r) => r.situation && r.action)
      : [],
  })).filter((p) => p.rules.length);
}
