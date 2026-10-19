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

// The coach's pack shape (and its size limits) is shared with the coach MCP server in AWS.
export { cleanPacks } from "./coach.mjs";
