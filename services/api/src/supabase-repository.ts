import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { uuidSchema } from "@firstday/contracts";
import { ApiError } from "./errors.js";
import { MemoryFirstDayRepository, type RepositoryState } from "./memory-repository.js";
import { databaseSnapshotSchema, decodeRepositoryState, encodeRepositoryState, REPOSITORY_TABLES, type DatabaseRow, type RelationalRecords, type RepositoryTable } from "./relational-state.js";
import type { RepositoryStorage } from "./repository-storage.js";

export type DatabaseCommand = { kind: "insert" | "update" | "delete"; table: RepositoryTable; row: DatabaseRow } | { kind: "confirmChange"; id: string } | { kind: "revokeConsent"; id: string; sourceRevision: string; reason?: string };
const parentKeys: Partial<Record<RepositoryTable, string[]>> = {
  instruction_evidence: ["instruction_id", "evidence_id"], open_question_evidence: ["open_question_id", "evidence_id"], practice_set_instructions: ["practice_set_id", "instruction_id"], scenario_rules: ["scenario_id", "instruction_id"], scenario_evidence: ["scenario_id", "evidence_id"], attempt_rule_results: ["attempt_id", "instruction_id"],
};
const rowKey = (table: RepositoryTable, row: DatabaseRow) => JSON.stringify((parentKeys[table] ?? ["id"]).map((field) => row[field]));

/** Ordered relational delta. Existing database triggers own confirmation/revocation. */
export function repositoryCommands(learnerId: string, before: RepositoryState, after: RepositoryState): DatabaseCommand[] {
  const commands: DatabaseCommand[] = [];
  const controlledInstructions = new Set<string>(), controlledSources = new Set<string>(), controlledChanges = new Set<string>();
  for (const [id, change] of after.changes) {
    if (change.status === "confirmed" && before.changes.get(id)?.status === "needsReview") {
      commands.push({ kind: "confirmChange", id: change.id });
      controlledChanges.add(change.id);
      controlledInstructions.add(change.previousInstructionId);
      controlledInstructions.add(change.replacementInstruction.id);
    }
  }
  for (const [id, source] of after.sources) {
    if (source.consentStatus === "revoked" && before.sources.get(id)?.consentStatus === "confirmed") {
      const reason = [...after.consentEvents].reverse().find((e) => e.sourceConversationId === source.id && e.status === "revoked")?.reason;
      commands.push({ kind: "revokeConsent", id: source.id, sourceRevision: source.sourceRevision, ...(reason ? { reason } : {}) });
      controlledSources.add(source.id);
    }
  }
  const oldRows = encodeRepositoryState(learnerId, before), newRows = encodeRepositoryState(learnerId, after);
  const existing = Object.fromEntries(REPOSITORY_TABLES.map((table) => [table, new Map(oldRows[table].map((row) => [rowKey(table, row), row]))])) as Record<RepositoryTable, Map<string, DatabaseRow>>;
  const controlled = (table: RepositoryTable, row: DatabaseRow) =>
    table === "consent_events" ||
    (table === "instructions" && controlledInstructions.has(String(row["id"]))) ||
    (table === "change_proposals" && controlledChanges.has(String(row["id"]))) ||
    (table === "source_conversations" && controlledSources.has(String(row["id"]))) ||
    ((table === "source_materials" || table === "extraction_inputs") && controlledSources.has(String(row["source_conversation_id"]))) ||
    (table === "practice_sets" && row["status"] === "stale" && (controlledChanges.size > 0 || controlledSources.size > 0));
  // Editable evidence links must be removed while their parent is still reviewable.
  for (const table of ["instruction_evidence", "open_question_evidence"] as const) {
    const wanted = new Map(newRows[table].map((row) => [rowKey(table, row), row]));
    for (const row of oldRows[table]) if (!wanted.has(rowKey(table, row))) commands.push({ kind: "delete", table, row });
  }
  const pendingPractice: DatabaseCommand[] = [];
  for (const table of REPOSITORY_TABLES) for (const row of newRows[table]) {
    if (controlled(table, row)) continue;
    const old = existing[table].get(rowKey(table, row));
    if (old && isDeepStrictEqual(old, row)) continue;
    if (table === "practice_sets") {
      if (!old) commands.push({ kind: "insert", table, row: { ...row, status: "draft" } });
      // A single-scenario drill can complete on its first attempt; honor both SQL transitions.
      if (old?.["status"] === "ready" && row["status"] === "complete") pendingPractice.push({ kind: "update", table, row: { ...row, status: "inProgress" } });
      pendingPractice.push({ kind: "update", table, row });
    } else commands.push({ kind: old ? "update" : "insert", table, row });
  }
  return [...commands, ...pendingPractice];
}

export type SupabaseRepositoryOptions = { supabaseUrl: string; serviceRoleKey: string; groundedExtraction?: boolean; fetchImplementation?: typeof fetch };

export function createSupabaseStorage(options: SupabaseRepositoryOptions): RepositoryStorage {
  const url = new URL(options.supabaseUrl);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new ApiError("INVALID_STATE");
  if (!options.serviceRoleKey.trim() || options.serviceRoleKey.trim() !== options.serviceRoleKey) throw new ApiError("INVALID_STATE");
  const fetchImplementation = options.fetchImplementation ?? fetch;
  async function rpc(name: string, body: object): Promise<unknown> {
    try {
      const response = await fetchImplementation(`${url.origin}/rest/v1/rpc/${name}`, { method: "POST", redirect: "error", headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new ApiError("INTERNAL_ERROR");
      return await response.json();
    } catch { throw new ApiError("INTERNAL_ERROR"); }
  }
  return {
    async load(learnerId) {
      uuidSchema.parse(learnerId);
      const snapshot = databaseSnapshotSchema.parse(await rpc("firstday_repository_load", { p_learner_id: learnerId }));
      return { version: snapshot.version, state: decodeRepositoryState(learnerId, snapshot.records as RelationalRecords) };
    },
    async commit(learnerId, expectedVersion, before, after) {
      return z.boolean().parse(await rpc("firstday_repository_commit", { p_learner_id: uuidSchema.parse(learnerId), p_expected_version: expectedVersion, p_commands: repositoryCommands(learnerId, before, after) }));
    },
  };
}

export function createSupabaseRepository(options: SupabaseRepositoryOptions) {
  return new MemoryFirstDayRepository(options.groundedExtraction, createSupabaseStorage(options));
}
