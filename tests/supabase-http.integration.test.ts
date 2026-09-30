import {hasUnderstandingClient} from "../apps/mobile/src/understanding-client.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { beeSourceSchema } from "@firstday/contracts";
import bookshop from "../fixtures/transcripts/bookshop-onboarding.json" with { type: "json" };
import update from "../fixtures/transcripts/bookshop-policy-update.json" with { type: "json" };
import { createSupabaseRepository } from "../services/api/src/supabase-repository.js";
import { createSupabaseSessionVerifier } from "../services/api/src/auth.js";
import { createDemoGateway } from "../services/api/src/demo-server.js";
import { createFixtureInstructionExtractor } from "../services/api/src/extraction.js";
import { buildApiServer, deterministicScenarioEngine } from "../services/api/src/server.js";
import { createFirstDayApiClient } from "../apps/mobile/src/api.js";

// Only a dedicated local Supabase CLI stack is eligible for this test.
// Credentials remain in the temporary CLI status file and server-side memory.
const statusFile = process.env["FIRSTDAY_TEST_SUPABASE_STATUS_FILE"];
const settings = statusFile ? z.object({ API_URL: z.string().url(), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1) }).parse(JSON.parse(readFileSync(statusFile, "utf8"))) : undefined;
if (settings && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(settings.API_URL).hostname)) throw new Error("Supabase HTTP validation requires an isolated loopback stack.");

describe.skipIf(!settings)("actual local Supabase Auth and PostgREST", () => {
  it("persists the authenticated rehearsal/update journey and enforces direct RLS", async () => {
    const { API_URL: url, ANON_KEY: anon, SERVICE_ROLE_KEY: service } = settings!;
    async function request(path: string, key: string, token: string, body?: object) {
      return fetch(`${url}${path}`, { method: body ? "POST" : "GET", headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    async function learner() {
      const email = `firstday-test-${randomUUID()}@example.invalid`, password = randomUUID() + randomUUID();
      const created = await request("/auth/v1/admin/users", service, service, { email, password, email_confirm: true });
      expect(created.ok).toBe(true);
      const id = z.object({ id: z.string().uuid() }).parse(await created.json()).id;
      const signedIn = await request("/auth/v1/token?grant_type=password", anon, anon, { email, password });
      expect(signedIn.ok).toBe(true);
      const token = z.object({ access_token: z.string().min(1) }).parse(await signedIn.json()).access_token;
      return { id, token };
    }
    const owner = await learner(), other = await learner();
    const repository = () => createSupabaseRepository({ supabaseUrl: url, serviceRoleKey: service });
    const verifier = createSupabaseSessionVerifier({ supabaseUrl:url,anonKey:anon,allowLocalHttp:true,nodeEnv:'development' });
    expect((await verifier.verify(owner.token)).learnerId).toBe(owner.id);
    const start = () => buildApiServer({ repository: repository(), sessionVerifier: verifier, beeGateway: createDemoGateway([beeSourceSchema.parse(bookshop), beeSourceSchema.parse(update)]), extractor: createFixtureInstructionExtractor(), scenarioEngine: deterministicScenarioEngine, clock: () => new Date().toISOString(), idFactory: randomUUID });
    let server = start();
    const client = (token = owner.token) => createFirstDayApiClient({ baseUrl: "http://firstday.test", sessionToken: token, async fetchImplementation(input, init) {
      const endpoint = new URL(String(input));
      const response = await server.inject({ method: init?.method as "GET" | "POST" | "PATCH", url: endpoint.pathname + endpoint.search, headers: init?.headers as Record<string, string>, ...(typeof init?.body === "string" ? { payload: init.body } : {}) });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
    } });
    try {
      const api = client();if(!hasUnderstandingClient(api))throw new Error("Understanding client unavailable");
      const original = (await api.importConversation({ beeSourceId: bookshop.id, sourceKind: "fixture", sourceRevision: bookshop.revision, consent: { confirmed: true } })).sourceConversation;
      const extraction = await api.extractInstructions({ sourceConversationId: original.id, sourceRevision: original.sourceRevision, excludedRanges: [] });
      for (const rule of extraction.items) await api.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" });
      const selected=extraction.items.at(-1)!;
      let {check}=await api.createUnderstanding({instructionId:selected.id,sourceRevision:selected.sourceRevision,instructionRevision:extraction.instructionRevision,explanation:"I will follow the confirmed action.",inputMode:"voice",requestId:randomUUID()});
      if(check.instruction.exceptions.length)check=(await api.updateUnderstanding({checkId:check.id,action:"clarify",expectedVersion:check.version,applicability:check.instruction.exceptions.map(()=>false)})).check;
      check=(await api.updateUnderstanding({checkId:check.id,action:"confirmInterpretation",expectedVersion:check.version})).check;
      check=(await api.updateUnderstanding({checkId:check.id,action:"rehearse",expectedVersion:check.version,requestId:randomUUID(),responseText:selected.expectedAction,inputMode:"text"})).check;
      expect(check.responses[0]!.comparison).toBe("consistent");
      const ownCheck=await request("/rest/v1/understanding_checks?select=id",anon,owner.token);expect(ownCheck.ok).toBe(true);expect(await ownCheck.json()).toEqual([{id:check.id}]);
      const otherCheck=await request("/rest/v1/understanding_checks?select=id",anon,other.token);expect(await otherCheck.json()).toEqual([]);
      const practice = await api.createPractice({ sourceConversationId: original.id, sourceRevision: original.sourceRevision, instructionIds: extraction.items.map(r => r.id), title: "Actual database transport validation" });
      const first = practice.scenarios[0]!;
      await api.submitAttempt({ scenarioId: first.id, sourceRevision: original.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, responseText: "I would hold it until Saturday.", inputMode: "text" });
      await server.close(); server = start();
      expect((await api.listUnderstanding(original.id)).items[0]!.check.responses[0]!.inputMode).toBe("text");
      const restored = await client().getSourceSession(original.id);
      expect(restored.practices[0]!.attempts[0]!.result).toBe("missed");
      expect(restored.extraction?.items.every(r => r.status === "confirmed")).toBe(true);
      await expect(client(other.token).getSourceSession(original.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
      const ownRead = await request("/rest/v1/source_conversations?select=id", anon, owner.token);
      expect(ownRead.ok).toBe(true); expect(await ownRead.json()).toEqual([{ id: original.id }]);
      const otherRead = await request("/rest/v1/source_conversations?select=id", anon, other.token);
      expect(otherRead.ok).toBe(true); expect(await otherRead.json()).toEqual([]);
      const deniedRpc = await request("/rest/v1/rpc/firstday_repository_load", anon, owner.token, { p_learner_id: owner.id });
      expect(deniedRpc.ok).toBe(false);
      const next = (await api.importConversation({ beeSourceId: update.id, sourceKind: "fixture", sourceRevision: update.revision, consent: { confirmed: true } })).sourceConversation;
      await api.extractInstructions({ sourceConversationId: next.id, sourceRevision: next.sourceRevision, excludedRanges: [] });
      const comparison = await api.compareSources({ sourceConversationId: original.id, newSourceConversationId: next.id, previousInstructionRevision: extraction.instructionRevision });
      const changed = await api.confirmChange({ changeId: comparison.changes[0]!.id, sourceRevision: next.sourceRevision });
      expect((await api.getPractice(practice.practiceSet.id)).practiceSet.status).toBe("stale");
      const drill = changed.changeDrill.scenarios[0]!;
      const input = { scenarioId: drill.id, sourceRevision: next.sourceRevision, instructionRevision: changed.changeDrill.practiceSet.instructionRevision, inputMode: "text" as const };
      expect((await api.submitAttempt({ ...input, responseText: changed.previousInstruction.expectedAction })).attempt.result).toBe("missed");
      expect((await api.submitAttempt({ ...input, responseText: "It changed from five to seven calendar days. Sunday is day seven and still held." })).attempt.result).toBe("covered");
      await server.close(); server = start();
      expect((await api.getSourceSession(original.id)).practices.at(-1)!.practice.practiceSet.status).toBe("complete");
      await api.revokeConsent({ sourceConversationId: original.id, sourceRevision: original.sourceRevision });
      await expect(api.listUnderstanding(original.id)).rejects.toMatchObject({code:"CONSENT_REVOKED"});
      for(const table of ['practice_sets','scenarios','attempts','attempt_rule_results','change_proposals']){const rows=await request(`/rest/v1/${table}?select=*`,anon,owner.token);expect(rows.ok).toBe(true);expect(await rows.json()).toEqual([]);}
      const laterRules=await request(`/rest/v1/instructions?select=id,source_conversation_id`,anon,owner.token);expect(laterRules.ok).toBe(true);expect((await laterRules.json() as {source_conversation_id:string}[]).every(row=>row.source_conversation_id===next.id)).toBe(true);
      const revokedCheck=await request("/rest/v1/understanding_checks?select=id",anon,owner.token);expect(await revokedCheck.json()).toEqual([]);
      await expect(api.getSourceSession(original.id)).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
      await expect(api.submitAttempt({ ...input, responseText: "seven days" })).rejects.toMatchObject({ code: "STALE_PRACTICE_SET" });
      await expect(repository().getPracticeSet({ learnerId: owner.id, practiceSetId: changed.changeDrill.practiceSet.id })).rejects.toMatchObject({code:"CONSENT_REVOKED"});
    } finally { await server.close(); }
  }, 60_000);
});

it.skipIf(!settings)("preserves fictional reported timestamp provenance through actual Auth/PostgREST and API restart", async () => {
  const { API_URL: url, ANON_KEY: anon, SERVICE_ROLE_KEY: service } = settings!;
  const { extractSyntheticInstructions } = await import("@firstday/scenario-engine");
  const { default: fictional } = await import("../fixtures/transcripts/library-onboarding.json", { with: { type: "json" } });
  async function request(path: string, key: string, token: string, body?: object) {
    return fetch(`${url}${path}`, { method: body ? "POST" : "GET", headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function learner() {
    const email = `firstday-point-${randomUUID()}@example.invalid`, password = randomUUID() + randomUUID();
    const created = await request("/auth/v1/admin/users", service, service, { email, password, email_confirm: true });
    expect(created.ok).toBe(true);
    const id = z.object({ id: z.string().uuid() }).parse(await created.json()).id;
    const signedIn = await request("/auth/v1/token?grant_type=password", anon, anon, { email, password });
    expect(signedIn.ok).toBe(true);
    return { id, token: z.object({ access_token: z.string() }).parse(await signedIn.json()).access_token };
  }
  const owner = await learner(), other = await learner();
  const utterances = fictional.utterances.map((u, i) => ({ ...u, id: `p-${i}`, startMs: 1780000000000, endMs: 1780000000000, timing: { basis: "reportedTimestamp" as const, rawStart: i, rawEnd: i } }));
  const source = beeSourceSchema.parse({ ...fictional, id: `fictional-${randomUUID()}`, revision: "reported-http-r1", utterances });
  const repo = () => createSupabaseRepository({ supabaseUrl: url, serviceRoleKey: service, groundedExtraction: true });
  const verifier = createSupabaseSessionVerifier({supabaseUrl:url,anonKey:anon,allowLocalHttp:true,nodeEnv:'development'});
  const start = () => buildApiServer({ repository: repo(), sessionVerifier: verifier, beeGateway: createDemoGateway([source]), extractor: { async extract(input) { return extractSyntheticInstructions({ ...input, sourceConversationId: input.sourceConversation.id }); } }, scenarioEngine: deterministicScenarioEngine, idFactory: randomUUID, clock: () => new Date().toISOString() });
  let server = start();
  const client = (token = owner.token) => createFirstDayApiClient({ baseUrl: "http://firstday.test", sessionToken: token, async fetchImplementation(input, init) { const endpoint = new URL(String(input)); const response = await server.inject({ method: init?.method as "GET" | "POST" | "PATCH", url: endpoint.pathname + endpoint.search, headers: init?.headers as Record<string, string>, ...(typeof init?.body === "string" ? { payload: init.body } : {}) }); return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } }); } });
  try {
    const api = client();
    const imported = (await api.importConversation({ beeSourceId: source.id, sourceKind: "fixture", sourceRevision: source.revision, consent: { confirmed: true } })).sourceConversation;
    const excludedRanges = [{ startMs: utterances[1]!.startMs, endMs: utterances[1]!.endMs, timing: { basis: "reportedTimestamps" as const }, utteranceIds: [utterances[1]!.id] }];
    await expect(api.extractInstructions({ sourceConversationId: imported.id, sourceRevision: source.revision, excludedRanges: [{ ...excludedRanges[0]!, utteranceIds: ["counterfeit"] }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const extraction = await api.extractInstructions({ sourceConversationId: imported.id, sourceRevision: source.revision, excludedRanges });
    for (const rule of extraction.items) await api.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" });
    await server.close(); server = start();
    const restored = await api.getSourceSession(imported.id);
    expect(restored.source.utterances).toEqual(utterances);
    expect(restored.excludedRanges).toEqual(excludedRanges);
    expect(restored.extraction?.sourceEvidence).toEqual(extraction.sourceEvidence);
    const ownEvidence = await request("/rest/v1/source_evidence?select=id,timing,start_ms,end_ms", anon, owner.token);
    expect(ownEvidence.ok).toBe(true);
    const rows = await ownEvidence.json() as Record<string, unknown>[];
    expect(rows).toHaveLength(extraction.sourceEvidence.length);
    expect(rows.every(row => row["start_ms"] === row["end_ms"] && JSON.stringify(row["timing"]) === '{"basis":"reportedTimestamps"}')).toBe(true);
    const otherEvidence = await request("/rest/v1/source_evidence?select=id", anon, other.token);
    expect(otherEvidence.ok).toBe(true); expect(await otherEvidence.json()).toEqual([]);
    await expect(client(other.token).getSourceSession(imported.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    if(!hasUnderstandingClient(api))throw new Error('Understanding client missing');const {hasCorrectionClient}=await import('../apps/mobile/src/corrections-client.js');if(!hasCorrectionClient(api))throw new Error('Correction client missing');const originalRule=restored.extraction!.items[0]!;await api.createUnderstanding({instructionId:originalRule.id,sourceRevision:source.revision,instructionRevision:extraction.instructionRevision,requestId:randomUUID(),explanation:'Earlier fictional intended action',inputMode:'text'});const correction=await api.previewCorrection({requestId:randomUUID(),target:{sourceConversationId:imported.id,sourceRevision:source.revision,instructionId:originalRule.id,instructionRevision:extraction.instructionRevision,instruction:originalRule,sourceEvidence:extraction.sourceEvidence.filter(e=>originalRule.sourceEvidence.includes(e.id)),originalUtterances:utterances.filter(u=>extraction.sourceEvidence.filter(e=>originalRule.sourceEvidence.includes(e.id)).some(e=>e.utteranceIds.includes(u.id)))},after:{type:'interpretation',meaning:'uncertain'},recognizedText:'I am uncertain about the intended action',inputMode:'text'});await api.updateCorrection({correctionId:correction.id,requestId:randomUUID(),action:'confirm',expectedVersion:1,dependencyFingerprint:correction.effects.dependencyFingerprint});
    await api.revokeConsent({ sourceConversationId: imported.id, sourceRevision: source.revision });
    const revoked = await request("/rest/v1/source_evidence?select=id", anon, owner.token);
    expect(revoked.ok).toBe(true); expect(await revoked.json()).toEqual([]);
    await expect(api.getSourceSession(imported.id)).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
    for(const table of ['open_questions','instructions']){const cleared=await fetch(`${url}/rest/v1/${table}?learner_id=eq.${owner.id}`,{method:'DELETE',headers:{apikey:service,authorization:`Bearer ${service}`}});expect(cleared.ok).toBe(true);}
    const deleted=await fetch(`${url}/rest/v1/source_conversations?id=eq.${imported.id}`,{method:'DELETE',headers:{apikey:service,authorization:`Bearer ${service}`}});expect(deleted.ok).toBe(true);
    for(const table of ['source_evidence','instructions','understanding_checks','source_corrections']){const records=await request(`/rest/v1/${table}?select=*`,anon,owner.token);expect(records.ok).toBe(true);expect(await records.json()).toEqual([]);}
    await expect(api.getSourceSession(imported.id)).rejects.toMatchObject({code:'RESOURCE_NOT_FOUND'});
  } finally { await server.close(); }
}, 60_000);

it.skipIf(!settings)('recovers lost correction preview and confirmation through actual Auth/PostgREST restart and keeps canonical new rule history',async()=>{
  const {API_URL:url,ANON_KEY:anon,SERVICE_ROLE_KEY:service}=settings!;
  const {hasCorrectionClient}=await import('../apps/mobile/src/corrections-client.js');
  const {createDraftStore}=await import('../apps/mobile/src/draft-store.js');
  const {submitCorrectionDraft,recoverCorrectionDraft,submitCorrectionLifecycle}=await import('../apps/mobile/src/correction-drafts.js');
  const request=async(path:string,key:string,token:string,body?:object)=>fetch(`${url}${path}`,{method:body?'POST':'GET',headers:{apikey:key,authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const email=`firstday-correction-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID();
  const created=await request('/auth/v1/admin/users',service,service,{email,password,email_confirm:true});expect(created.ok).toBe(true);const owner=z.object({id:z.string().uuid()}).parse(await created.json()).id;
  const signed=await request('/auth/v1/token?grant_type=password',anon,anon,{email,password});const token=z.object({access_token:z.string()}).parse(await signed.json()).access_token;
  const repository=()=>createSupabaseRepository({supabaseUrl:url,serviceRoleKey:service});
  const verifier=createSupabaseSessionVerifier({supabaseUrl:url,anonKey:anon,allowLocalHttp:true,nodeEnv:'development'});
  const start=()=>buildApiServer({repository:repository(),sessionVerifier:verifier,beeGateway:createDemoGateway([beeSourceSchema.parse(bookshop),beeSourceSchema.parse(update)]),extractor:createFixtureInstructionExtractor(),scenarioEngine:deterministicScenarioEngine,clock:()=>new Date().toISOString(),idFactory:randomUUID});
  let server=start(),losePath:string|null=null;
  const client=()=>createFirstDayApiClient({baseUrl:'http://firstday.test',sessionToken:token,async fetchImplementation(input,init){const endpoint=new URL(input),response=await server.inject({method:init?.method as 'GET'|'POST'|'PATCH',url:endpoint.pathname+endpoint.search,headers:init?.headers as Record<string,string>,...(typeof init?.body==='string'?{payload:init.body}:{})});if(losePath===endpoint.pathname&&response.statusCode<300){losePath=null;throw new Error('Fictional lost response');}return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});}});
  const slots:[string|null,string|null]=[null,null],store=()=>createDraftStore({async read(i){return slots[i];},async write(i,value){slots[i]=value;},async remove(i){slots[i]=null;}});
  try{
    let api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');const original=(await api.importConversation({beeSourceId:bookshop.id,sourceKind:'fixture',sourceRevision:bookshop.revision,consent:{confirmed:true}})).sourceConversation;
    const e=await api.extractInstructions({sourceConversationId:original.id,sourceRevision:original.sourceRevision,excludedRanges:[]});for(const i of e.items)await api.updateInstruction({instructionId:i.id,sourceRevision:i.sourceRevision,status:'confirmed'});
    const standard=await api.createPractice({sourceConversationId:original.id,sourceRevision:original.sourceRevision,instructionIds:e.items.map(i=>i.id),title:'Original consented fictional history'});
    const session=await api.getSourceSession(original.id),i=session.extraction!.items[0]!,target={sourceConversationId:original.id,sourceRevision:original.sourceRevision,instructionId:i.id,instructionRevision:e.instructionRevision,instruction:i,sourceEvidence:session.extraction!.sourceEvidence.filter(ev=>i.sourceEvidence.includes(ev.id)),originalUtterances:session.source.utterances.filter(u=>session.extraction!.sourceEvidence.filter(ev=>i.sourceEvidence.includes(ev.id)).some(ev=>ev.utteranceIds.includes(u.id)))};
    const pRequest={requestId:randomUUID(),target,after:{type:'transcription' as const,correctedText:'Cannot, not can.'},recognizedText:'Cannot, not can.',inputMode:'voice' as const},context={kind:'correction' as const,learnerId:owner,sourceConversationId:original.id,sourceRevision:original.sourceRevision,instructionRevision:e.instructionRevision,slot:0},metadata={requestId:pRequest.requestId,after:pRequest.after,instructionId:i.id,evidenceIds:i.sourceEvidence,status:'pending' as const};
    losePath='/api/source-corrections/preview';await expect(submitCorrectionDraft({store:store(),context,text:pRequest.recognizedText,inputMode:pRequest.inputMode,metadata,submit:()=>api.previewCorrection!(pRequest)})).rejects.toMatchObject({code:'NETWORK_ERROR'});
    for(let index=0;index<30;index++)await store().save({learnerId:owner,sourceConversationId:original.id,sourceRevision:original.sourceRevision,instructionRevision:e.instructionRevision,...(index%2?{kind:'understanding' as const,instructionId:randomUUID(),phase:'explanation' as const}:{scenarioId:randomUUID(),practiceSetId:randomUUID()})},'Fictional device response','text');
    await server.close();server=start();api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');let recovered=await recoverCorrectionDraft({store:store(),context,session:await api.getSourceSession(original.id),corrections:(await api.listCorrections(original.id)).items});expect(recovered.receipt!.status).toBe('preview');expect(recovered.draft!.requestId).toBe(pRequest.requestId);expect(await api.previewCorrection(pRequest)).toEqual(recovered.receipt);
    const p=recovered.receipt!,confirm={correctionId:p.id,requestId:randomUUID(),expectedVersion:1,action:'confirm' as const,dependencyFingerprint:p.effects.dependencyFingerprint};losePath=`/api/source-corrections/${p.id}`;await expect(submitCorrectionDraft({store:store(),context,text:pRequest.recognizedText,inputMode:pRequest.inputMode,metadata:{...metadata,mutation:confirm},submit:()=>api.updateCorrection!(confirm)})).rejects.toMatchObject({code:'NETWORK_ERROR'});
    await server.close();server=start();api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');recovered=await recoverCorrectionDraft({store:store(),context,session:await api.getSourceSession(original.id),corrections:(await api.listCorrections(original.id)).items});expect(recovered.mutationCommitted).toBe(true);expect(recovered.receipt!.reviewHistory).toHaveLength(2);expect(await api.updateCorrection(confirm)).toEqual(recovered.receipt);
    await expect(api.createUnderstanding({instructionId:i.id,sourceRevision:i.sourceRevision,instructionRevision:e.instructionRevision,requestId:randomUUID(),explanation:'Direct route must not bypass source review',inputMode:'text'})).rejects.toMatchObject({code:'INVALID_STATE'});
    const own=await request('/rest/v1/source_corrections?select=id',anon,token);expect(own.ok).toBe(true);expect(await own.json()).toEqual([{id:p.id}]);const denied=await request('/rest/v1/source_corrections',anon,token,{id:randomUUID()});expect(denied.ok).toBe(false);
    await api.updateCorrection({correctionId:p.id,requestId:randomUUID(),action:'undo',expectedVersion:2});
    const understanding=await api.createUnderstanding({instructionId:i.id,sourceRevision:i.sourceRevision,instructionRevision:e.instructionRevision,requestId:randomUUID(),explanation:'My original intended action',inputMode:'text'});
    const later=(await api.importConversation({beeSourceId:update.id,sourceKind:'fixture',sourceRevision:update.revision,consent:{confirmed:true}})).sourceConversation;await api.extractInstructions({sourceConversationId:later.id,sourceRevision:later.sourceRevision,excludedRanges:[]});const comparison=await api.compareSources({sourceConversationId:original.id,newSourceConversationId:later.id,previousInstructionRevision:e.instructionRevision});
    const n=await api.previewCorrection({requestId:randomUUID(),target,after:{type:'newRule',changeId:comparison.changes[0]!.id,laterSourceConversationId:later.id,laterSourceRevision:later.sourceRevision},recognizedText:'The later actual conversation changed this rule.',inputMode:'text'});
    await store().saveCorrection(context,'Unresolved history A','text',{requestId:randomUUID(),after:{type:'interpretation',meaning:'uncertain'},evidenceIds:[],status:'skipped'});const savedA=await store().load(context);losePath=`/api/source-corrections/${n.id}`;
    const lifecycle={store:store(),context,correction:n,action:'confirm' as const,id:randomUUID,submit:(request:import('@firstday/contracts').UpdateCorrectionRequest)=>api.updateCorrection!(request)};
    await expect(submitCorrectionLifecycle(lifecycle)).rejects.toMatchObject({code:'NETWORK_ERROR'});await server.close();server=start();api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');const historyDraft=(await store().loadCorrections(owner)).find(d=>d.requestId===n.request.requestId)!;expect(historyDraft.slot).toBe(1);expect(await store().load(context)).toEqual(savedA);const retried=await submitCorrectionLifecycle({...lifecycle,store:store()});expect(retried.receipt.reviewHistory.at(-1)!.requestId).toBe(historyDraft.mutation!.requestId);expect(await store().load(context)).toEqual(savedA);expect(await store().load({...context,slot:1})).toBeNull();

    await server.close();server=start();api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');expect((await api.listCorrections(original.id)).items.find(c=>c.id===n.id)!.request.target).toEqual(target);const history=await api.listUnderstanding(original.id,true);expect(history.items[0]!.historical).toBe(true);expect(history.items[0]!.check).toEqual(understanding.check);
    const replacementSession=await api.getSourceSession(later.id),preparedRequest={learnerId:owner,instructionId:replacementSession.extraction!.items[0]!.id,sourceRevision:later.sourceRevision,instructionRevision:replacementSession.extraction!.instructionRevision,requestId:randomUUID(),explanation:'Earlier prepared later action',inputMode:'text' as const},preparedContext=await repository().prepareUnderstanding(preparedRequest);
    expect(preparedContext.approvedCorrections).toEqual([]);
    await api.updateCorrection({correctionId:n.id,requestId:randomUUID(),expectedVersion:2,action:'reopen'});
    const revised=await api.previewCorrection({...n.request,requestId:randomUUID(),revisesId:n.id,recognizedText:'Reviewed local wording for this same actual later policy.'});
    expect((await api.getSourceSession(original.id)).extraction!.items[0]!.status).toBe('changed');
    const revisedConfirm={correctionId:revised.id,requestId:randomUUID(),expectedVersion:1,action:'confirm' as const,dependencyFingerprint:revised.effects.dependencyFingerprint};
    const revisedReceipt=await api.updateCorrection(revisedConfirm);await server.close();server=start();api=client();if(!hasCorrectionClient(api)||!hasUnderstandingClient(api))throw new Error('Review clients missing');expect(await api.updateCorrection(revisedConfirm)).toEqual(revisedReceipt);expect((await api.listCorrections(original.id)).items.find(c=>c.id===n.id)!.status).toBe('superseded');expect((await repository().prepareUnderstanding({...preparedRequest,requestId:randomUUID()})).dependencyFingerprint).not.toBe(preparedContext.dependencyFingerprint);await expect(repository().createUnderstanding({...preparedRequest,id:randomUUID(),timestamp:new Date().toISOString(),dependencyFingerprint:preparedContext.dependencyFingerprint})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await api.updateCorrection({correctionId:revised.id,requestId:randomUUID(),expectedVersion:2,action:'reopen'});await api.updateCorrection({correctionId:revised.id,requestId:randomUUID(),expectedVersion:3,action:'undo'});expect((await api.getSourceSession(original.id)).extraction!.items[0]!.status).toBe('changed');expect((await api.getSourceSession(later.id)).extraction!.items[0]!.status).toBe('confirmed');
    const currentLater=await api.getSourceSession(later.id),replacement=currentLater.extraction!.items[0]!,replacementRequest={learnerId:owner,instructionId:replacement.id,sourceRevision:later.sourceRevision,instructionRevision:currentLater.extraction!.instructionRevision,requestId:randomUUID(),explanation:'Current fictional later action',inputMode:'text' as const},beforeContext=await repository().prepareUnderstanding(replacementRequest);
    expect(beforeContext.approvedCorrections).toEqual([]);
    await api.revokeConsent({sourceConversationId:later.id,sourceRevision:later.sourceRevision});await expect(api.listCorrections(original.id)).rejects.toMatchObject({code:'CONSENT_REVOKED'});const rows=await request('/rest/v1/source_corrections?select=id',anon,token);expect(await rows.json()).toEqual([{id:p.id}]);
    for(const table of ['practice_sets','scenarios','attempts','change_proposals','understanding_checks','source_evidence','instructions']){const projected=await request(`/rest/v1/${table}?select=*`,anon,token);expect(projected.ok).toBe(true);const records=await projected.json() as {id:string;source_conversation_id?:string;practice_set_id?:string}[];if(table==='practice_sets')expect(records.map(row=>row.id)).toEqual([standard.practiceSet.id]);if(table==='scenarios')expect(records.map(row=>row.id).sort()).toEqual(standard.scenarios.map(s=>s.id).sort());if(table==='change_proposals'||table==='attempts')expect(records).toEqual([]);if(['instructions','source_evidence','understanding_checks'].includes(table))expect(records.every(row=>row.source_conversation_id===original.id)).toBe(true);}
    await expect(api.updateCorrection({correctionId:revised.id,requestId:randomUUID(),expectedVersion:4,action:'reopen'})).rejects.toMatchObject({code:'CONSENT_REVOKED'});
    await api.revokeConsent({sourceConversationId:original.id,sourceRevision:original.sourceRevision});for(const table of ['source_evidence','instructions','practice_sets','scenarios','attempts','understanding_checks','source_corrections']){const projected=await request(`/rest/v1/${table}?select=*`,anon,token);expect(projected.ok).toBe(true);expect(await projected.json()).toEqual([]);}
    expect(slots.join('')).not.toContain(token);
  }finally{await server.close();}
},60000);
