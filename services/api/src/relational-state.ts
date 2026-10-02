import { createHash } from "node:crypto";
import { z } from "zod";
import { sourceCorrectionSchema, understandingCheckSchema, attemptSchema, beeSourceSchema, changeProposalSchema, excludedRangeSchema, instructionCardSchema, openQuestionSchema, practiceSetSchema, scenarioSchema, sourceConversationSchema, sourceEvidenceSchema } from "@firstday/contracts";
import { initialState, type RepositoryState } from "./memory-repository.js";

export const REPOSITORY_TABLES = ["source_conversations", "source_materials", "instruction_revisions", "source_evidence", "instructions", "instruction_evidence", "open_questions", "open_question_evidence", "extraction_inputs", "change_proposals", "practice_sets", "practice_set_instructions", "scenarios", "scenario_rules", "scenario_evidence", "attempts", "attempt_rule_results", "consent_events", "understanding_checks", "source_corrections"] as const;
export type RepositoryTable = typeof REPOSITORY_TABLES[number];
export type DatabaseRow = Record<string, unknown>;
export type RelationalRecords = Record<RepositoryTable, DatabaseRow[]>;
export const databaseSnapshotSchema = z.object({ version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), records: z.object(Object.fromEntries(REPOSITORY_TABLES.map((name) => [name, z.array(z.record(z.string(), z.unknown()))]))) });
const key = (learner: string, id: string) => JSON.stringify([learner, id]);
const text = (row: DatabaseRow, field: string) => z.string().parse(row[field]);
function internalId(parts: string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const revisionId = (learner: string, source: string, revision: string) => internalId([learner, "instruction-revision", source, revision]);
function camel(row: DatabaseRow): DatabaseRow {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null).map(([name, value]) => [name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), /_at$/.test(name) && typeof value === "string" ? new Date(value).toISOString() : value]));
}
function snake(row: object, omit: readonly string[] = []): DatabaseRow {
  return Object.fromEntries(Object.entries(row).filter(([name, value]) => !omit.includes(name) && value !== undefined).map(([name, value]) => [name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
}
function pick(row: DatabaseRow, names: readonly string[]): DatabaseRow { return Object.fromEntries(names.filter((name) => row[name] !== undefined).map((name) => [name, row[name]])); }
function links(rows: DatabaseRow[], parentField: string, parent: string, targetField: string): string[] {
  return rows.filter((row) => row[parentField] === parent).sort((a, b) => Number(a["position"]) - Number(b["position"])).map((row) => text(row, targetField));
}

/** Rebuild runtime indexes exclusively from normalized persisted records. */
export function decodeRepositoryState(learnerId: string, records: RelationalRecords): RepositoryState {
  const state = initialState();
  for (const name of REPOSITORY_TABLES) for (const row of records[name]) {
    if (row["learner_id"] !== learnerId) throw new Error("Database returned another learner's records.");
  }
  for (const row of records.source_conversations) {
    const source = sourceConversationSchema.parse(camel(row));
    state.sources.set(key(learnerId, source.id), source);
    state.sourceIdentity.set(JSON.stringify([learnerId, source.sourceKind, source.beeSourceId, source.sourceRevision]), source.id);
  }
  for (const row of records.source_materials) {
    const source = state.sources.get(key(learnerId, text(row, "source_conversation_id")));
    if (!source || source.consentStatus !== "confirmed") throw new Error("Invalid private source material.");
    state.sourceMaterials.set(key(learnerId, source.id), beeSourceSchema.parse({ id: source.beeSourceId, sourceKind: source.sourceKind, title: source.title, startedAt: source.startedAt, ...(source.endedAt ? { endedAt: source.endedAt } : {}), status: "processed", revision: source.sourceRevision, ...pick(camel(row), ["transcript", "utterances", "speakers", "sourceUrl"]) }));
  }
  for (const row of records.source_evidence) {
    const evidence = sourceEvidenceSchema.parse(pick(camel(row), ["id", "sourceConversationId", "sourceRevision", "startMs", "endMs", "quote", "utteranceIds", "speakerLabel", "timing"]));
    state.evidence.set(key(learnerId, evidence.id), { learnerId, evidence });
  }
  for (const row of records.instructions) {
    const id = text(row, "id");
    const instruction = instructionCardSchema.parse({ ...pick(camel(row), ["id", "sourceConversationId", "sourceRevision", "text", "situation", "expectedAction", "exceptions", "confidence", "status", "supersedesId", "createdAt", "updatedAt"]), sourceEvidence: links(records.instruction_evidence, "instruction_id", id, "evidence_id") });
    const revision = records.instruction_revisions.find((r) => r["id"] === row["instruction_revision_id"]);
    if (!revision) throw new Error("Missing instruction revision.");
    state.instructions.set(key(learnerId, id), { learnerId, instructionRevision: text(revision, "revision"), instruction });
  }
  for (const row of records.open_questions) {
    const id = text(row, "id");
    const openQuestion = openQuestionSchema.parse({ ...pick(camel(row), ["id", "sourceConversationId", "sourceRevision", "instructionId", "question", "status", "shareConsent", "resolution", "createdAt", "updatedAt"]), sourceEvidence: links(records.open_question_evidence, "open_question_id", id, "evidence_id") });
    state.openQuestions.set(key(learnerId, id), { learnerId, openQuestion });
  }
  for (const row of records.instruction_revisions) {
    const sourceConversationId = text(row, "source_conversation_id"), sourceRevision = text(row, "source_revision"), instructionRevision = text(row, "revision");
    const sourceKey = key(learnerId, sourceConversationId);
    const previous = records.instruction_revisions.find((r) => r["id"] === row["previous_revision_id"]);
    const input = records.extraction_inputs.find((r) => r["instruction_revision_id"] === row["id"]);
    const metadata = input ? z.object({ instructionIds: z.array(z.string()), openQuestionIds: z.array(z.string()), sourceEvidenceIds: z.array(z.string()) }).parse(input["payload"]) : { instructionIds: [...state.instructions.values()].filter((i) => i.instruction.sourceConversationId === sourceConversationId).map((i) => i.instruction.id), openQuestionIds: [...state.openQuestions.values()].filter((q) => q.openQuestion.sourceConversationId === sourceConversationId).map((q) => q.openQuestion.id), sourceEvidenceIds: [...state.evidence.values()].filter((e) => e.evidence.sourceConversationId === sourceConversationId).map((e) => e.evidence.id) };
    state.extractions.set(sourceKey, { learnerId, sourceConversationId, sourceRevision, instructionRevision, ...metadata, ...(previous ? { previousInstructionRevision: text(previous, "revision") } : {}) });
    if (input) state.extractionInputs.set(sourceKey, { excludedRanges: z.array(excludedRangeSchema).max(100).parse(input["excluded_ranges"]) });
  }
  for (const row of records.change_proposals) {
    const replacement = instructionCardSchema.parse(row["replacement_snapshot"]);
    const previous = state.instructions.get(key(learnerId, text(row, "previous_instruction_id")))?.instruction;
    if (!replacement || !previous) throw new Error("Missing changed instruction.");
    const proposal = changeProposalSchema.parse({ ...pick(camel(row), ["id", "previousInstructionId", "previousSourceRevision", "sourceRevision", "status", "createdAt", "updatedAt"]), replacementInstruction: replacement, previousSourceEvidence: previous.sourceEvidence });
    state.changes.set(key(learnerId, proposal.id), proposal);
  }
  for (const row of records.scenarios) {
    const id = text(row, "id");
    const scenario = scenarioSchema.parse({ ...pick(camel(row), ["id", "practiceSetId", "sourceRevision", "kind", "characterId", "prompt", "context", "acceptableSignals", "criticalMisses", "retryPrompt"]), order: row["ordering"], expectedRuleIds: links(records.scenario_rules, "scenario_id", id, "instruction_id"), sourceEvidence: links(records.scenario_evidence, "scenario_id", id, "evidence_id") });
    state.scenarios.set(key(learnerId, id), { learnerId, scenario });
  }
  for (const row of [...records.practice_sets].sort((a, b) => Number(a["recorded_order"]) - Number(b["recorded_order"]))) {
    const id = text(row, "id");
    const scenarios = [...state.scenarios.values()].filter((s) => s.scenario.practiceSetId === id).map((s) => s.scenario).sort((a, b) => a.order - b.order);
    const practiceSet = practiceSetSchema.parse({ ...pick(camel(row), ["id", "learnerId", "sourceConversationId", "sourceRevision", "sourceKind", "title", "kind", "instructionRevision", "status", "createdAt", "updatedAt"]), scenarioIds: scenarios.map((s) => s.id) });
    state.practiceSets.set(key(learnerId, id), { learnerId, practiceSet, instructionIds: links(records.practice_set_instructions, "practice_set_id", id, "instruction_id"), sourceEvidenceIds: [...new Set(scenarios.flatMap((s) => s.sourceEvidence))], ...(row["change_proposal_id"] ? { changeId: text(row, "change_proposal_id") } : {}) });
    if (practiceSet.kind === "standard") state.standardPracticeBySource.set(JSON.stringify([learnerId, practiceSet.sourceConversationId, practiceSet.sourceRevision, "standard"]), id);
  }
  for (const row of [...records.attempts].sort((a, b) => Number(a["recorded_order"]) - Number(b["recorded_order"]))) {
    const id = text(row, "id"), scenarioId = text(row, "scenario_id");
    const results = records.attempt_rule_results.filter((r) => r["attempt_id"] === id).sort((a, b) => Number(a["position"]) - Number(b["position"]));
    const attempt = attemptSchema.parse({ ...pick(camel(row), ["id", "scenarioId", "sourceRevision", "instructionRevision", "responseText", "inputMode", "result", "feedback", "createdAt"]), matchedRuleIds: results.filter((r) => r["disposition"] === "matched").map((r) => r["instruction_id"]), missedRuleIds: results.filter((r) => r["disposition"] === "missed").map((r) => r["instruction_id"]), sourceEvidence: state.scenarios.get(key(learnerId, scenarioId))?.scenario.sourceEvidence });
    state.attempts.set(key(learnerId, id), { learnerId, attempt });
    state.attemptIdsByScenario.set(key(learnerId, scenarioId), [...state.attemptIdsByScenario.get(key(learnerId, scenarioId)) ?? [], id]);
  }
  for(const row of [...records.source_corrections].sort((a,b)=>Number(a["recorded_order"])-Number(b["recorded_order"]))){
    const correction=sourceCorrectionSchema.parse(row['payload']),t=correction.request.target;
    if(correction.learnerId!==learnerId||correction.id!==row['id']||correction.request.requestId!==row['request_id']||t.sourceConversationId!==row['source_conversation_id']||t.sourceRevision!==row['source_revision']||t.instructionId!==row['instruction_id']||t.instructionRevision!==row['instruction_revision']||correction.status!==row['status']||correction.version!==row['version'])throw new Error('Invalid correction provenance.');
    state.sourceCorrections.set(key(learnerId,correction.id),correction);
  }
  for (const row of records.understanding_checks) {
    const check=understandingCheckSchema.parse(row["payload"]);
    if(check.id!==row["id"] || check.requestId!==row["request_id"] || check.instruction.id!==row["instruction_id"] || check.instruction.sourceConversationId!==row["source_conversation_id"] || check.instruction.sourceRevision!==row["source_revision"] || check.instructionRevision!==row["instruction_revision"])throw new Error("Invalid understanding provenance.");
    state.understandingChecks.set(key(learnerId,check.id),{learnerId,check});
  }
  state.consentEvents = records.consent_events.map((row) => ({ learnerId, sourceConversationId: text(row, "source_conversation_id"), sourceRevision: text(row, "source_revision"), status: z.enum(["confirmed", "revoked"]).parse(row["consent_status"]), timestamp: new Date(text(row, "occurred_at")).toISOString(), ...(row["reason"] ? { reason: text(row, "reason") } : {}) }));
  return state;
}

/** Project runtime records to the checked-in relational schema. No persisted runtime snapshot. */
export function encodeRepositoryState(learnerId: string, state: RepositoryState): RelationalRecords {
  const records: RelationalRecords = { source_corrections: [], understanding_checks: [], source_conversations: [], source_materials: [], instruction_revisions: [], source_evidence: [], instructions: [], instruction_evidence: [], open_questions: [], open_question_evidence: [], extraction_inputs: [], change_proposals: [], practice_sets: [], practice_set_instructions: [], scenarios: [], scenario_rules: [], scenario_evidence: [], attempts: [], attempt_rule_results: [], consent_events: [] };
  const add = (name: RepositoryTable, row: DatabaseRow) => records[name].push({ learner_id: learnerId, ...row });
  const addEvidenceLinks = (name: "instruction_evidence" | "open_question_evidence" | "scenario_evidence", parentField: string, parentId: string, references: string[]) => references.forEach((id, index) => {
    const evidence = state.evidence.get(key(learnerId, id))!.evidence;
    add(name, { [parentField]: parentId, evidence_id: id, source_conversation_id: evidence.sourceConversationId, source_revision: evidence.sourceRevision, position: index + 1 });
  });
  for(const correction of state.sourceCorrections.values()){
    if(correction.learnerId!==learnerId)continue;
    const t=correction.request.target;add('source_corrections',{id:correction.id,request_id:correction.request.requestId,source_conversation_id:t.sourceConversationId,source_revision:t.sourceRevision,instruction_id:t.instructionId,instruction_revision:t.instructionRevision,status:correction.status,version:correction.version,payload:correction});
  }
  for (const {learnerId:owner,check} of state.understandingChecks.values()) {
    if(owner!==learnerId)continue;
    add("understanding_checks",{id:check.id,request_id:check.requestId,source_conversation_id:check.instruction.sourceConversationId,source_revision:check.instruction.sourceRevision,instruction_id:check.instruction.id,instruction_revision:check.instructionRevision,payload:check});
  }
  for (const source of state.sources.values()) {
    add("source_conversations", snake(source));
    const material = state.sourceMaterials.get(key(learnerId, source.id));
    if (material) add("source_materials", { id: internalId([learnerId, "source-material", source.id]), source_conversation_id: source.id, source_revision: source.sourceRevision, ...snake(pick(material as unknown as DatabaseRow, ["transcript", "utterances", "speakers", "sourceUrl"])), created_at: source.importedAt });
  }
  for (const extracted of state.extractions.values()) {
    const id = revisionId(learnerId, extracted.sourceConversationId, extracted.instructionRevision);
    const source = state.sources.get(key(learnerId, extracted.sourceConversationId))!;
    const parentSources = new Set(extracted.instructionIds.flatMap((instructionId) => {
      const instruction = state.instructions.get(key(learnerId, instructionId))?.instruction;
      const previous = instruction?.supersedesId ? state.instructions.get(key(learnerId, instruction.supersedesId))?.instruction : undefined;
      return previous ? [previous.sourceConversationId] : [];
    }));
    const prior = [...state.extractions.values()].find((r) => parentSources.has(r.sourceConversationId) && r.instructionRevision === extracted.previousInstructionRevision);
    add("instruction_revisions", { id, source_conversation_id: source.id, source_revision: extracted.sourceRevision, revision: extracted.instructionRevision, previous_revision_id: prior ? revisionId(learnerId, prior.sourceConversationId, prior.instructionRevision) : null, created_at: source.importedAt });
    const input = state.extractionInputs.get(key(learnerId, source.id));
    if (input) add("extraction_inputs", { id: internalId([id, "extraction-input"]), source_conversation_id: source.id, source_revision: extracted.sourceRevision, instruction_revision_id: id, payload: { instructionIds: extracted.instructionIds, openQuestionIds: extracted.openQuestionIds, sourceEvidenceIds: extracted.sourceEvidenceIds }, excluded_ranges: input.excludedRanges, created_at: source.importedAt });
  }
  for (const { evidence } of state.evidence.values()) add("source_evidence", { ...snake(evidence), created_at: state.sources.get(key(learnerId, evidence.sourceConversationId))!.importedAt });
  for (const { instruction, instructionRevision } of state.instructions.values()) {
    add("instructions", { ...snake(instruction, ["sourceEvidence"]), instruction_revision_id: revisionId(learnerId, instruction.sourceConversationId, instructionRevision) });
    addEvidenceLinks("instruction_evidence", "instruction_id", instruction.id, instruction.sourceEvidence);
  }
  for (const { openQuestion } of state.openQuestions.values()) {
    add("open_questions", snake(openQuestion, ["sourceEvidence"]));
    addEvidenceLinks("open_question_evidence", "open_question_id", openQuestion.id, openQuestion.sourceEvidence);
  }
  for (const change of state.changes.values()) add("change_proposals", { ...snake(change, ["replacementInstruction", "previousSourceEvidence", "sourceEvidence"]), replacement_instruction_id: change.replacementInstruction.id, replacement_snapshot: change.replacementInstruction });
  for (const stored of state.practiceSets.values()) {
    const { practiceSet: practice } = stored;
    add("practice_sets", { ...snake(practice, ["scenarioIds"]), instruction_revision_id: revisionId(learnerId, practice.sourceConversationId, practice.instructionRevision), change_proposal_id: stored.changeId ?? null });
    stored.instructionIds.forEach((id, index) => add("practice_set_instructions", { practice_set_id: practice.id, instruction_id: id, instruction_source_revision: state.instructions.get(key(learnerId, id))!.instruction.sourceRevision, position: index + 1 }));
  }
  for (const { scenario } of state.scenarios.values()) {
    add("scenarios", { ...snake(scenario, ["order", "expectedRuleIds", "sourceEvidence"]), ordering: scenario.order, created_at: state.practiceSets.get(key(learnerId, scenario.practiceSetId))!.practiceSet.createdAt });
    scenario.expectedRuleIds.forEach((id, index) => add("scenario_rules", { scenario_id: scenario.id, instruction_id: id, instruction_source_revision: state.instructions.get(key(learnerId, id))!.instruction.sourceRevision, position: index + 1 }));
    addEvidenceLinks("scenario_evidence", "scenario_id", scenario.id, scenario.sourceEvidence);
  }
  for (const { attempt } of state.attempts.values()) {
    add("attempts", snake(attempt, ["matchedRuleIds", "missedRuleIds", "sourceEvidence"]));
    [...attempt.matchedRuleIds, ...attempt.missedRuleIds].forEach((id, index) => add("attempt_rule_results", { attempt_id: attempt.id, scenario_id: attempt.scenarioId, instruction_id: id, disposition: attempt.matchedRuleIds.includes(id) ? "matched" : "missed", position: index + 1 }));
  }
  return records;
}
