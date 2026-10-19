// Real Bee recordings for the eval (eval/real/*.json), made with `npm run eval:export` from conversations
// everyone in them agreed to record (fictional scripts are best). Only cases you labeled (labeled: true)
// are scored. They're reported next to the fictional sets, never used for tuning and never gated in CI.
import { existsSync, readdirSync, readFileSync } from "node:fs";

export function loadReal(dir = new URL("./real/", import.meta.url)) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")))
    .filter((c) => c && c.labeled === true && typeof c.transcript === "string" && Array.isArray(c.rules));
}
