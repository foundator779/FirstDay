import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beeSourceSchema, createSourceEvidenceId, type BeeSource } from "@firstday/contracts";
import { updateUnderstandingCheck, extractSyntheticInstructions, generateSyntheticPractice } from "@firstday/scenario-engine";
import library from "../fixtures/transcripts/library-onboarding.json" with { type: "json" };
import update from "../fixtures/transcripts/library-policy-update.json" with { type: "json" };
import bookshop from "../fixtures/transcripts/bookshop-onboarding.json" with { type: "json" };
import bookshopUpdate from "../fixtures/transcripts/bookshop-policy-update.json" with { type: "json" };
import { createSupabaseRepository } from "../services/api/src/supabase-repository.js";
import { createDemoGateway } from "../services/api/src/demo-server.js";
import { createFixtureInstructionExtractor } from "../services/api/src/extraction.js";
import { buildApiServer, deterministicScenarioEngine } from "../services/api/src/server.js";
import { createFirstDayApiClient } from "../apps/mobile/src/api.js";

const databaseUrl = process.env["FIRSTDAY_TEST_DATABASE_URL"];
const psql = process.env["FIRSTDAY_TEST_PSQL"] ?? "psql";
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
function sql(query: string): string {
  return execFileSync(psql, [databaseUrl!, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" }).trim();
}
const timestamp = "2026-09-29T12:00:00.000Z";
function repo(groundedExtraction = true) {
  return createSupabaseRepository({ supabaseUrl: "http://localhost:54321", serviceRoleKey: "test-service-only", groundedExtraction, async fetchImplementation(url, init) {
    const body = JSON.parse(String(init?.body)) as { p_learner_id: string; p_expected_version?: number; p_commands?: unknown };
    const name = new URL(String(url)).pathname.split("/").at(-1);
    const expression = name === "firstday_repository_load" ? `public.firstday_repository_load(${literal(body.p_learner_id)}::uuid)` : `public.firstday_repository_commit(${literal(body.p_learner_id)}::uuid, ${body.p_expected_version}, ${literal(JSON.stringify(body.p_commands))}::jsonb)`;
    return new Response(sql(`begin; set local role service_role; select to_jsonb(${expression}); commit;`), { status: 200 });
  } });
}
async function extract(learnerId: string, sourceId: string, source: BeeSource) {
  const repository = repo();
  const context = await repository.prepareExtraction({ learnerId, sourceConversationId: sourceId, sourceRevision: source.revision });
  const extraction = extractSyntheticInstructions({ source, sourceConversationId: sourceId, excludedRanges: [], idFactory: randomUUID, timestamp });
  if (source.id === update.id) extraction.items[0]!.supersedesId = context.previousConfirmedInstructions.find((r) => r.situation === extraction.items[0]!.situation)!.id;
  return repository.saveExtraction({ learnerId, sourceConversationId: sourceId, sourceRevision: source.revision, excludedRanges: [], extraction, allocation: { recordIds: [...extraction.items, ...extraction.openQuestions].map((r) => r.id), timestamp }, lineage: { previousInstructionContextsById: context.previousInstructionContextsById } });
}

describe.skipIf(!databaseUrl)("normalized Supabase repository against isolated Postgres", () => {
  it("persists private understanding context and history with RLS and revocation across repository restarts",async()=>{
    const learnerId=randomUUID(),other=randomUUID(),sourceId=randomUUID();sql(`insert into auth.users(id) values (${literal(learnerId)}),(${literal(other)});`);
    const source=beeSourceSchema.parse(library);await repo().importSource({learnerId,sourceConversationId:sourceId,source,timestamp});const extraction=await extract(learnerId,sourceId,source);const rule=extraction.items[0]!;
    for(const item of extraction.items)await repo().updateInstruction({learnerId,instructionId:item.id,sourceRevision:item.sourceRevision,status:"confirmed",timestamp});
    const practiceRequest={sourceConversationId:sourceId,sourceRevision:source.revision,instructionIds:extraction.items.map(i=>i.id),title:"Dispute guarding"};
    const practiceContext=await repo().prepareStandardPractice({learnerId,...practiceRequest});const generation=generateSyntheticPractice({...practiceContext,title:practiceRequest.title,practiceSetId:randomUUID(),scenarioIds:[randomUUID(),randomUUID(),randomUUID()],timestamp});
    const practice=await repo().saveStandardPractice({learnerId,request:practiceRequest,generation,allocation:{practiceSetId:generation.practiceSet.id,scenarioIds:generation.practiceSet.scenarioIds,timestamp}});
    const request={learnerId,instructionId:rule.id,sourceRevision:rule.sourceRevision,instructionRevision:extraction.instructionRevision,explanation:"I will follow the procedure.",inputMode:"voice" as const,requestId:randomUUID(),id:randomUUID(),timestamp};
    const created=await repo().createUnderstanding(request);expect(created.check.status).toBe("readyForConfirmation");
    const disputed=updateUnderstandingCheck(created.check,{action:"dispute",expectedVersion:1},timestamp);await repo().saveUnderstanding({learnerId,previous:created.check,next:disputed});
    const attemptInput={learnerId,scenarioId:practice.scenarios[0]!.id,sourceRevision:source.revision,instructionRevision:extraction.instructionRevision,responseText:"I would follow the confirmed action.",inputMode:"voice" as const};
    await expect(repo().prepareAttempt(attemptInput)).rejects.toMatchObject({code:"INVALID_STATE"});
    const reopened=updateUnderstandingCheck(disputed,{action:"reopen",expectedVersion:2},timestamp);await repo().saveUnderstanding({learnerId,previous:disputed,next:reopened});
    expect((await repo().prepareAttempt(attemptInput)).scenario.id).toBe(practice.scenarios[0]!.id);
    const previous=(await repo().getUnderstanding({learnerId,checkId:created.check.id})).check;const next=updateUnderstandingCheck(previous,{action:"confirmInterpretation",expectedVersion:previous.version},timestamp);
    await repo().saveUnderstanding({learnerId,previous,next});expect((await repo().listUnderstanding({learnerId,sourceConversationId:sourceId})).items[0]!.check.status).toBe("readyToRehearse");
    expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(other)},false);select count(*) from public.understanding_checks;`).split("\n").at(-1)).toBe("0");
    expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(learnerId)},false);select count(*) from public.understanding_checks;`).split("\n").at(-1)).toBe("1");
    expect(()=>sql(`set role service_role;update public.understanding_checks set payload=jsonb_set(payload,'{explanation}','"silently changed"') where id=${literal(created.check.id)};`)).toThrow();
    expect(()=>sql(`set role service_role;update public.understanding_checks set payload=jsonb_set(payload,'{version}','null') where id=${literal(created.check.id)};`)).toThrow();
    await repo().revokeConsent({learnerId,sourceConversationId:sourceId,sourceRevision:source.revision,timestamp});
    await expect(repo().getUnderstanding({learnerId,checkId:created.check.id})).rejects.toMatchObject({code:"CONSENT_REVOKED"});
    expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(learnerId)},false);select count(*) from public.understanding_checks;`).split("\n").at(-1)).toBe("0");
  });

  it("submits outdated and corrected fixture drill answers through HTTP and durable storage", async () => {
    const learnerId = randomUUID();
    sql(`insert into auth.users(id) values (${literal(learnerId)});`);
    const server = buildApiServer({ repository: repo(false), sessionVerifier: { async verify() { return { learnerId, access: "fixtureOnly" }; } }, beeGateway: createDemoGateway([beeSourceSchema.parse(bookshop), beeSourceSchema.parse(bookshopUpdate)]), extractor: createFixtureInstructionExtractor(), scenarioEngine: deterministicScenarioEngine, clock: () => timestamp, idFactory: randomUUID });
    const client = createFirstDayApiClient({ baseUrl: "http://firstday.test", sessionToken: "isolated-test", async fetchImplementation(url, init) {
      const response = await server.inject({ method: init?.method as "GET" | "POST" | "PATCH", url: new URL(url).pathname + new URL(url).search, headers: init?.headers as Record<string, string>, ...(typeof init?.body === "string" ? { payload: init.body } : {}) });
      return new Response(response.body, { status: response.statusCode });
    } });
    try {
      const original = (await client.importConversation({ beeSourceId: bookshop.id, sourceKind: "fixture", sourceRevision: bookshop.revision, consent: { confirmed: true } })).sourceConversation;
      const extraction = await client.extractInstructions({ sourceConversationId: original.id, sourceRevision: original.sourceRevision, excludedRanges: [] });
      for (const rule of extraction.items) await client.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" });
      const next = (await client.importConversation({ beeSourceId: bookshopUpdate.id, sourceKind: "fixture", sourceRevision: bookshopUpdate.revision, consent: { confirmed: true } })).sourceConversation;
      await client.extractInstructions({ sourceConversationId: next.id, sourceRevision: next.sourceRevision, excludedRanges: [] });
      const compared = await client.compareSources({ sourceConversationId: original.id, newSourceConversationId: next.id, previousInstructionRevision: extraction.instructionRevision });
      const confirmed = await client.confirmChange({ changeId: compared.changes[0]!.id, sourceRevision: next.sourceRevision });
      const scenario = confirmed.changeDrill.scenarios[0]!;
      const input = { scenarioId: scenario.id, sourceRevision: next.sourceRevision, instructionRevision: confirmed.changeDrill.practiceSet.instructionRevision, inputMode: "text" as const };
      expect((await client.submitAttempt({ ...input, responseText: confirmed.previousInstruction.expectedAction })).attempt.result).toBe("missed");
      expect((await client.submitAttempt({ ...input, responseText: "It changed from five to seven calendar days. Sunday is day seven and still held." })).attempt.result).toBe("covered");
      const restored = await repo(false).getSourceSession({ learnerId, sourceConversationId: original.id });
      expect(restored.practices[0]!.practice.practiceSet.status).toBe("complete");
      expect(restored.practices[0]!.attempts.map((a) => a.result)).toEqual(["missed", "covered"]);
    } finally { await server.close(); }
  }, 30_000);

  it("serializes concurrent imports, isolates direct reads and rolls back rejected transactions", async () => {
    const learnerId = randomUUID(), other = randomUUID();
    sql(`insert into auth.users(id) values (${literal(learnerId)}), (${literal(other)});`);
    const source = beeSourceSchema.parse(library);
    const imports = await Promise.all([repo(), repo()].map((repository) => repository.importSource({ learnerId, sourceConversationId: randomUUID(), source, timestamp })));
    expect(imports[0]!.id).toBe(imports[1]!.id);
    expect(sql(`select count(*) from public.source_conversations where learner_id=${literal(learnerId)};`)).toBe("1");
    expect(sql(`set role authenticated; select set_config('request.jwt.claim.sub',${literal(other)},false); select count(*) from public.source_conversations;`).split("\n").at(-1)).toBe("0");
    expect(sql(`set role authenticated; select set_config('request.jwt.claim.sub',${literal(learnerId)},false); select count(*) from public.source_conversations;`).split("\n").at(-1)).toBe("1");
    expect(sql("select has_table_privilege('authenticated','private.source_materials','SELECT'), has_table_privilege('anon','private.extraction_inputs','SELECT');")).toBe("f|f");
    expect(() => sql(`set role service_role; select public.firstday_repository_commit(${literal(other)},0,'[{"kind":"insert","table":"unknown","row":{}}]');`)).toThrow();
    expect(sql(`select count(*) from private.repository_versions where learner_id=${literal(other)};`)).toBe("0");
    for (const args of [`${literal(other)},null,'[]'`, `${literal(other)},0,null`, `null,0,'[]'`]) {
      expect(() => sql(`set role service_role; select public.firstday_repository_commit(${args});`)).toThrow();
    }
    expect(() => sql("set role service_role; select public.firstday_repository_load(null);")).toThrow();
  });

  it("persists review, retry/recap, change confirmation and revocation across repository restarts", async () => {
    const learnerId = randomUUID(), other = randomUUID(), sourceId = randomUUID(), updateId = randomUUID();
    sql(`insert into auth.users(id) values (${literal(learnerId)}), (${literal(other)});`);
    const original = beeSourceSchema.parse(library), changed = beeSourceSchema.parse(update);
    await repo().importSource({ learnerId, sourceConversationId: sourceId, source: original, timestamp });
    expect((await repo().getSourceForProcessing({ learnerId, sourceConversationId: sourceId, sourceRevision: original.revision })).source).toEqual(original);
    const extracted = await extract(learnerId, sourceId, original);
    for (const item of extracted.items) await repo().updateInstruction({ learnerId, instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed", timestamp });
    expect((await repo().getSourceSession({ learnerId, sourceConversationId: sourceId })).extraction?.items.every((r) => r.status === "confirmed")).toBe(true);
    await expect(repo().getSource({ learnerId: other, sourceConversationId: sourceId })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const request = { sourceConversationId: sourceId, sourceRevision: original.revision, instructionIds: extracted.items.map((r) => r.id), title: "Durable practice" };
    const context = await repo().prepareStandardPractice({ learnerId, ...request });
    const allocation = { practiceSetId: randomUUID(), scenarioIds: [randomUUID(), randomUUID(), randomUUID()], timestamp };
    const generation = generateSyntheticPractice({ ...context, ...allocation, learnerId, sourceConversationId: sourceId, sourceRevision: original.revision, title: request.title });
    await repo().saveStandardPractice({ learnerId, request, generation, allocation });
    for (const scenario of generation.scenarios) {
      const input = { learnerId, scenarioId: scenario.id, sourceRevision: original.revision, instructionRevision: extracted.instructionRevision, responseText: "skip", inputMode: "text" as const, attemptId: randomUUID(), timestamp };
      await repo().saveAttempt({ ...input, evaluation: { result: "missed", feedback: "Try the confirmed step.", matchedRuleIds: [], missedRuleIds: scenario.expectedRuleIds, sourceEvidence: scenario.sourceEvidence } });
      await repo().saveAttempt({ ...input, attemptId: randomUUID(), responseText: scenario.acceptableSignals[0]!, evaluation: { result: "covered", feedback: "Covered the source-backed step.", matchedRuleIds: scenario.expectedRuleIds, missedRuleIds: [], sourceEvidence: scenario.sourceEvidence } });
    }
    expect((await repo().getPracticeSet({ learnerId, practiceSetId: allocation.practiceSetId })).practiceSet.status).toBe("complete");
    const raw = JSON.parse(sql(`set role service_role; select public.firstday_repository_load(${literal(learnerId)});`));
    expect(raw.records.attempts).toHaveLength(6);
    expect(raw.records.instructions).toHaveLength(3);
    expect(raw.records.instruction_evidence).toHaveLength(3);
    await repo().importSource({ learnerId, sourceConversationId: updateId, source: changed, timestamp });
    await extract(learnerId, updateId, changed);
    const comparison = await repo().compareSources({ learnerId, sourceConversationId: sourceId, newSourceConversationId: updateId, previousInstructionRevision: extracted.instructionRevision, timestamp, idFactory: randomUUID });
    const proposal = comparison.changes[0]!;
    const confirmation = await repo().confirmChange({ learnerId, changeId: proposal.id, sourceRevision: changed.revision, timestamp, practiceSetId: randomUUID(), scenarioId: randomUUID() });
    expect((await repo().getPracticeSet({ learnerId, practiceSetId: allocation.practiceSetId })).practiceSet.status).toBe("stale");
    const drill = confirmation.changeDrill.scenarios[0]!;
    const drillInput = { learnerId, scenarioId: drill.id, sourceRevision: changed.revision, instructionRevision: confirmation.changeDrill.practiceSet.instructionRevision, inputMode: "text" as const, responseText: confirmation.replacementInstruction.expectedAction };
    const drillContext = await repo().prepareAttempt(drillInput);
    expect(drillContext.sourceEvidence).toHaveLength(2);
    await repo().saveAttempt({ ...drillInput, attemptId: randomUUID(), timestamp, evaluation: { result: "covered", feedback: "Used the confirmed update.", matchedRuleIds: drill.expectedRuleIds, missedRuleIds: [], sourceEvidence: drill.sourceEvidence } });
    expect((await repo().getPracticeSet({ learnerId, practiceSetId: confirmation.changeDrill.practiceSet.id })).practiceSet.status).toBe("complete");
    await repo().revokeConsent({ learnerId, sourceConversationId: sourceId, sourceRevision: original.revision, timestamp, reason: "Integration test" });
    await expect(repo().prepareAttempt(drillInput)).rejects.toMatchObject({ code: "STALE_PRACTICE_SET" });
    await expect(repo().saveAttempt({ ...drillInput, attemptId: randomUUID(), timestamp, evaluation: { result: "covered", feedback: "A late provider result.", matchedRuleIds: drill.expectedRuleIds, missedRuleIds: [], sourceEvidence: drill.sourceEvidence } })).rejects.toMatchObject({ code: "STALE_PRACTICE_SET" });
    expect(sql(`select count(*) from private.source_materials where learner_id=${literal(learnerId)} and source_conversation_id=${literal(sourceId)};`)).toBe("0");
    expect(sql(`select count(*) from public.attempts where learner_id=${literal(learnerId)};`)).toBe("7");
    expect(sql(`select has_function_privilege('anon','public.firstday_repository_load(uuid)','EXECUTE'), has_function_privilege('authenticated','public.firstday_repository_commit(uuid,bigint,jsonb)','EXECUTE');`)).toBe("f|f");
  }, 30_000);

  it("retains the proposal's reviewed replacement snapshot after a pending instruction edit", async () => {
    const learnerId = randomUUID(), sourceId = randomUUID(), updateId = randomUUID();
    sql(`insert into auth.users(id) values (${literal(learnerId)});`);
    const original = beeSourceSchema.parse(library), changed = beeSourceSchema.parse(update);
    await repo().importSource({ learnerId, sourceConversationId: sourceId, source: original, timestamp });
    const extracted = await extract(learnerId, sourceId, original);
    for (const item of extracted.items) await repo().updateInstruction({ learnerId, instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed", timestamp });
    await repo().importSource({ learnerId, sourceConversationId: updateId, source: changed, timestamp });
    const next = await extract(learnerId, updateId, changed);
    const comparison = await repo().compareSources({ learnerId, sourceConversationId: sourceId, newSourceConversationId: updateId, previousInstructionRevision: extracted.instructionRevision, timestamp, idFactory: randomUUID });
    await repo().updateInstruction({ learnerId, instructionId: next.items[0]!.id, sourceRevision: changed.revision, text: "User wording revised", timestamp });
    await expect(repo().confirmChange({ learnerId, changeId: comparison.changes[0]!.id, sourceRevision: changed.revision, timestamp, practiceSetId: randomUUID(), scenarioId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("preserves excluded passage reasons in fresh repository hydration", async () => {
    const learnerId = randomUUID(), sourceId = randomUUID();
    sql(`insert into auth.users(id) values (${literal(learnerId)});`);
    const source = beeSourceSchema.parse(library);
    await repo().importSource({ learnerId, sourceConversationId: sourceId, source, timestamp });
    const excludedRanges = [{ startMs: 0, endMs: 1, reason: "Private introduction" }];
    const extraction = extractSyntheticInstructions({ source, sourceConversationId: sourceId, excludedRanges, idFactory: randomUUID, timestamp });
    await repo().saveExtraction({ learnerId, sourceConversationId: sourceId, sourceRevision: source.revision, excludedRanges, extraction, allocation: { recordIds: [...extraction.items, ...extraction.openQuestions].map((r) => r.id), timestamp } });
    expect((await repo().getSourceSession({ learnerId, sourceConversationId: sourceId })).excludedRanges).toEqual(excludedRanges);
  });
});

it.skipIf(!databaseUrl)("persists reported point evidence, exact selections and raw timing across SQL repository restarts", async () => {
  const learnerId = randomUUID(), other = randomUUID(), sourceId = randomUUID();
  sql(`insert into auth.users(id) values (${literal(learnerId)}), (${literal(other)});`);
  const original = beeSourceSchema.parse(library);
  const points = original.utterances.map((u, index) => ({ ...u, id: `p-${index}`, startMs: 1780000000000, endMs: 1780000000000, timing: { basis: "reportedTimestamp" as const, rawStart: index + 0.25, rawEnd: index + 0.25 } }));
  const source = beeSourceSchema.parse({ ...original, id: `fictional-${sourceId}`, revision: "reported-fictional-r1", utterances: points });
  await repo().importSource({ learnerId, sourceConversationId: sourceId, source, timestamp });
  const excludedRanges = [{ startMs: points[1]!.startMs, endMs: points[1]!.endMs, timing: { basis: "reportedTimestamps" as const }, utteranceIds: [points[1]!.id] }];
  const extraction = extractSyntheticInstructions({ source, sourceConversationId: sourceId, excludedRanges, timestamp, idFactory: randomUUID });
  expect(extraction.items.length).toBe(2);
  const input = { learnerId, sourceConversationId: sourceId, sourceRevision: source.revision, excludedRanges, extraction, allocation: { recordIds: [...extraction.items, ...extraction.openQuestions].map(i => i.id), timestamp } };
  await repo().saveExtraction(input);
  const restored = await repo().getSourceSession({ learnerId, sourceConversationId: sourceId });
  expect(restored.source).toEqual(source);
  expect(restored.excludedRanges).toEqual(excludedRanges);
  expect(restored.extraction?.sourceEvidence).toEqual(extraction.sourceEvidence);
  expect(new Set(restored.extraction?.sourceEvidence.map(e => e.id)).size).toBe(extraction.sourceEvidence.length);
  await expect(repo().getSourceSession({ learnerId: other, sourceConversationId: sourceId })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  const row = JSON.parse(sql(`select to_jsonb(e) from public.source_evidence e where id = ${literal(extraction.sourceEvidence[0]!.id)};`)) as Record<string, unknown>;
  expect(row["timing"]).toEqual({ basis: "reportedTimestamps" });
  const selected = [points[0]!, points[2]!];
  const multiIdentity = { sourceConversationId: sourceId, sourceRevision: source.revision, startMs: selected[0]!.startMs, endMs: selected[1]!.endMs, timing: { basis: "reportedTimestamps" as const }, utteranceIds: selected.map(u => u.id) };
  const multi = { ...row, id: createSourceEvidenceId(multiIdentity), utterance_ids: multiIdentity.utteranceIds, quote: selected.map(u => u.text).join("\n") };
  expect(sql(`begin; set local role service_role; insert into public.source_evidence select (jsonb_populate_record(null::public.source_evidence, ${literal(JSON.stringify(multi))}::jsonb)).*; select count(*) from public.source_evidence where id = ${literal(String(multi.id))}; rollback;`)).toBe("1");
  const escapedIds = ["quoted\"ID", "line\nID", "🦉"];
  expect(sql(`select private.reported_utterance_identity(${literal(JSON.stringify(escapedIds))}::jsonb);`)).toBe(JSON.stringify(escapedIds));
  // Insert forged evidence with a recomputed digest to exercise selection checks.
  const forgedRows: Record<string, unknown>[] = [{ ...row, timing: null }, { ...row, timing: { basis: "reportedTimestamps", fabricated: true } }, { ...row, end_ms: Number(row["end_ms"]) + 1 }, { ...multi, utterance_ids: [...multiIdentity.utteranceIds].reverse() }, { ...row, quote: "Forged fictional quote" }, { ...row, speaker_label: "Counterfeit" }];
  for (const forged of forgedRows) {
    const forgedId = createSourceEvidenceId({ sourceConversationId: sourceId, sourceRevision: source.revision, startMs: Number(forged["start_ms"]), endMs: Number(forged["end_ms"]), ...(forged["timing"] ? { timing: { basis: "reportedTimestamps" }, utteranceIds: forged["utterance_ids"] as string[] } : {}) });
    expect(() => sql(`begin; set local role service_role; insert into public.source_evidence select (jsonb_populate_record(null::public.source_evidence, ${literal(JSON.stringify({ ...forged, id: forgedId }))}::jsonb)).*; rollback;`)).toThrow();
  }
  await repo().revokeConsent({ learnerId, sourceConversationId: sourceId, sourceRevision: source.revision, timestamp: "2026-09-29T13:00:00.000Z" });
  await expect(repo().getSourceSession({ learnerId, sourceConversationId: sourceId })).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
  expect(sql(`select count(*) from private.source_materials where source_conversation_id = ${literal(sourceId)};`)).toBe("0");
}, 30_000);

describe.skipIf(!databaseUrl)('durable correction provenance',()=>{
 it('retains exact annotations and immutable originals across restarts with owner RLS, CAS and revocation',async()=>{
 const learnerId=randomUUID(),other=randomUUID(),sourceId=randomUUID();sql(`insert into auth.users(id) values (${literal(learnerId)}),(${literal(other)});`);const source=beeSourceSchema.parse(library);await repo().importSource({learnerId,sourceConversationId:sourceId,source,timestamp});const e=await extract(learnerId,sourceId,source);for(const i of e.items)await repo().updateInstruction({learnerId,instructionId:i.id,sourceRevision:source.revision,status:'confirmed',timestamp});const session=await repo().getSourceSession({learnerId,sourceConversationId:sourceId}),i=session.extraction!.items[0]!,request={requestId:randomUUID(),target:{sourceConversationId:sourceId,sourceRevision:source.revision,instructionId:i.id,instructionRevision:e.instructionRevision,instruction:i,originalUtterances:source.utterances.filter(u=>e.sourceEvidence.filter(ev=>i.sourceEvidence.includes(ev.id)).some(ev=>ev.utteranceIds.includes(u.id))),sourceEvidence:e.sourceEvidence.filter(ev=>i.sourceEvidence.includes(ev.id))},after:{type:'transcription' as const,correctedText:'Cannot, not can.'},recognizedText:'Cannot, not can.',inputMode:'voice' as const};const p=await repo().previewCorrection({learnerId,request,id:randomUUID(),timestamp});expect((await repo().listCorrections({learnerId,sourceConversationId:sourceId})).items[0]).toEqual(p);const change={learnerId,correctionId:p.id,requestId:randomUUID(),expectedVersion:1,action:'confirm' as const,dependencyFingerprint:p.effects.dependencyFingerprint,timestamp,practiceSetId:randomUUID(),scenarioId:randomUUID()};const confirmed=await repo().updateCorrection(change);expect(await repo().updateCorrection(change)).toEqual(confirmed);expect((await repo().getSourceSession({learnerId,sourceConversationId:sourceId})).extraction!.items[0]).toEqual(i);expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(other)},false);select count(*) from public.source_corrections;`).split('\n').at(-1)).toBe('0');expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(learnerId)},false);select count(*) from public.source_corrections;`).split('\n').at(-1)).toBe('1');expect(()=>sql(`set role service_role;update public.source_corrections set payload=jsonb_set(payload,'{request,target,sourceEvidence,0,quote}','"invented"') where id=${literal(p.id)};`)).toThrow();await expect(repo().updateCorrection({...change,requestId:randomUUID(),action:'undo',expectedVersion:1})).rejects.toMatchObject({code:'REVISION_CONFLICT'});await repo().updateCorrection({...change,requestId:randomUUID(),action:'undo',expectedVersion:2});await repo().revokeConsent({learnerId,sourceConversationId:sourceId,sourceRevision:source.revision,timestamp});await expect(repo().listCorrections({learnerId,sourceConversationId:sourceId})).rejects.toMatchObject({code:'CONSENT_REVOKED'});expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(learnerId)},false);select count(*) from public.source_corrections;`).split('\n').at(-1)).toBe('0');
 });
});
it.skipIf(!databaseUrl)('authenticated derivative projections deny revoked sources while preserving unrelated consented history',async()=>{const learnerId=randomUUID();sql(`insert into auth.users(id) values (${literal(learnerId)});`);const source=beeSourceSchema.parse(library),ids=[randomUUID(),randomUUID()];let firstPractice='';for(const [index,sourceId] of ids.entries()){await repo().importSource({learnerId,sourceConversationId:sourceId,source:{...source,id:`fictional-read-guard-${index}`},timestamp});const e=await extract(learnerId,sourceId,{...source,id:`fictional-read-guard-${index}`});for(const i of e.items)await repo().updateInstruction({learnerId,instructionId:i.id,sourceRevision:i.sourceRevision,status:'confirmed',timestamp});const r={sourceConversationId:sourceId,sourceRevision:source.revision,instructionIds:e.items.map(i=>i.id),title:'Fictional consented history'},context=await repo().prepareStandardPractice({learnerId,...r}),allocation={practiceSetId:randomUUID(),scenarioIds:[randomUUID(),randomUUID(),randomUUID()],timestamp},practice=await repo().saveStandardPractice({learnerId,request:r,generation:generateSyntheticPractice({...context,...allocation,title:r.title}),allocation});if(index===0)firstPractice=practice.practiceSet.id;const scenario=practice.scenarios[0]!;await repo().saveAttempt({learnerId,scenarioId:scenario.id,sourceRevision:source.revision,instructionRevision:e.instructionRevision,responseText:'Fictional answer',inputMode:'text',attemptId:randomUUID(),timestamp,evaluation:{result:'missed',feedback:'Try',matchedRuleIds:[],missedRuleIds:scenario.expectedRuleIds,sourceEvidence:scenario.sourceEvidence}});}const readCounts=()=>sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(learnerId)},false);select jsonb_build_object('evidence',(select count(*) from public.source_evidence),'instructions',(select count(*) from public.instructions),'practice',(select count(*) from public.practice_sets),'scenarios',(select count(*) from public.scenarios),'attempts',(select count(*) from public.attempts));`).split('\n').at(-1)!;expect(JSON.parse(readCounts())).toEqual({evidence:8,instructions:6,practice:2,scenarios:6,attempts:2});await repo().revokeConsent({learnerId,sourceConversationId:ids[0]!,sourceRevision:source.revision,timestamp});expect(JSON.parse(readCounts())).toEqual({evidence:4,instructions:3,practice:1,scenarios:3,attempts:1});expect(sql(`set role service_role;select status from public.practice_sets where id=${literal(firstPractice)};`)).toBe('stale');expect(sql(`set role authenticated;select set_config('request.jwt.claim.sub',${literal(randomUUID())},false);select count(*) from public.practice_sets;`).split('\n').at(-1)).toBe('0');});

it.skipIf(!databaseUrl)('keeps consent SELECT policies acyclic invoker checks and repository RPC service-only',()=>{expect(sql(`select count(*) from pg_policies where schemaname='public' and policyname like '%active%read' and permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[];`)).toBe('10');expect(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='guard_source_correction' and not p.prosecdef and p.proconfig=array['search_path=""']::text[];`)).toBe('1');for(const role of ['anon','authenticated'])for(const signature of ['public.firstday_repository_load(uuid)','public.firstday_repository_commit(uuid,bigint,jsonb)'])expect(sql(`select has_function_privilege('${role}','${signature}','EXECUTE');`)).toBe('f');});
