import {resolvedUnderstandingAction} from "../services/api/src/understanding.js";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { beeSourceSchema, createSourceEvidenceId, type CreateUnderstandingRequest } from "@firstday/contracts";
import { MemoryFirstDayRepository, initialState } from "../services/api/src/memory-repository.js";
import { buildApiServer, deterministicScenarioEngine } from "../services/api/src/server.js";
import { createFixtureInstructionExtractor } from "../services/api/src/extraction.js";
import type { RepositoryStorage } from "../services/api/src/repository-storage.js";
const time = "2026-09-30T12:00:00.000Z";
const quote = "New reservations last three days. Reservations already made keep their original seven-day window.";
async function setup() {
  let saved = initialState(), version = 0;
  const storage: RepositoryStorage = { async load(){ return { version, state: structuredClone(saved) }; }, async commit(_learner,expected,_before,after){ if(expected!==version)return false; saved=structuredClone(after); version++; return true; } };
  const learnerId=randomUUID(), sourceId=randomUUID(), instructionId=randomUUID();
  const repo=new MemoryFirstDayRepository(true,storage);
  const source=beeSourceSchema.parse({ id:"fixture-exception",sourceKind:"fixture",title:"Fictional conditional reservations", startedAt:time,status:"processed",revision:"r1",transcript:quote,utterances:[{id:"u1",startMs:0,endMs:9000,text:quote}] });
  await repo.importSource({learnerId,sourceConversationId:sourceId,source,timestamp:time});
  const ev={id:createSourceEvidenceId({sourceConversationId:sourceId,sourceRevision:"r1",startMs:0,endMs:9000}),sourceConversationId:sourceId,sourceRevision:"r1",startMs:0,endMs:9000,quote,utteranceIds:["u1"]};
  await repo.saveExtraction({learnerId,sourceConversationId:sourceId,sourceRevision:"r1",excludedRanges:[],allocation:{recordIds:[instructionId],timestamp:time},extraction:{sourceConversationId:sourceId,sourceRevision:"r1",instructionRevision:"ir1",items:[{id:instructionId,sourceConversationId:sourceId,sourceRevision:"r1",text:"Reservation window",situation:"A four-day-old reservation",expectedAction:"New reservations last three days.",exceptions:["Reservations already made keep their original seven-day window."],sourceEvidence:[ev.id],confidence:1,status:"needsReview",createdAt:time,updatedAt:time}],openQuestions:[],sourceEvidence:[ev]}});
  await repo.updateInstruction({learnerId,instructionId,sourceRevision:"r1",status:"confirmed",timestamp:time});
  const request:CreateUnderstandingRequest={instructionId,sourceRevision:"r1",instructionRevision:"ir1",requestId:randomUUID(),explanation:"I would cancel this four-day reservation.",inputMode:"voice"};
  const serverFor=(repository:MemoryFirstDayRepository, comparator?: Parameters<typeof buildApiServer>[0]["understandingComparator"],initialComparator?:Parameters<typeof buildApiServer>[0]["understandingInitialComparator"]) => buildApiServer({repository, sessionVerifier:{async verify(token){return {learnerId:token==="owner"?learnerId:randomUUID(),access:"all"};}},beeGateway:{async health(){return {authenticated:true};},async listConversations(){return {items:[],nextCursor:null};},async getConversation(){return {conversation:source};}},extractor:createFixtureInstructionExtractor(),scenarioEngine:deterministicScenarioEngine,...(comparator?{understandingComparator:comparator}:{}),...(initialComparator?{understandingInitialComparator:initialComparator}:{}),clock:()=>time});
  return {repo,storage,learnerId,sourceId,request,serverFor,getSaved:()=>saved};
}
const headers={authorization:"Bearer owner","content-type":"application/json"};
it.each(["explanation","rehearsal"] as const)("reconciles a lost %s response after device and API restart without repeating inference",async phase=>{
  const s=await setup();
  const {createDraftStore}=await import("../apps/mobile/src/draft-store.js");
  const {submitUnderstandingDraft,recoverUnderstandingDraft}=await import("../apps/mobile/src/understanding-drafts.js");
  let inferenceCalls=0;
  const comparator:Parameters<typeof buildApiServer>[0]["understandingComparator"]=async({check,responseText})=>{inferenceCalls++;return {comparison:"consistent",answerQuote:responseText,sourceAction:resolvedUnderstandingAction(check)};};
  const initialComparator:Parameters<typeof buildApiServer>[0]["understandingInitialComparator"]=async({explanation})=>{inferenceCalls++;return {answerQuote:explanation,exceptionIndex:0};};
  const app=s.serverFor(s.repo,comparator,initialComparator);
  const slotsValues=new Map<number,string>();
  const slots={async read(slot:0|1){return slotsValues.get(slot)??null;},async write(slot:0|1,value:string){slotsValues.set(slot,value);},async remove(slot:0|1){slotsValues.delete(slot);}};
  const requestId=randomUUID(),text=phase==="explanation"?s.request.explanation:"New reservations last three days.";
  let checkId:string|undefined;
  if(phase==="rehearsal"){
    let check=(await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request})).json().check;
    check=(await app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload:{action:"clarify",expectedVersion:check.version,applicability:[false]}})).json().check;
    check=(await app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload:{action:"confirmInterpretation",expectedVersion:check.version}})).json().check;
    checkId=check.id;inferenceCalls=0;
  }
  const context={kind:"understanding" as const,learnerId:s.learnerId,sourceConversationId:s.sourceId,instructionId:s.request.instructionId,sourceRevision:"r1",instructionRevision:"ir1",phase,...(checkId?{checkId}:{})};
  try{
    await expect(submitUnderstandingDraft({context,text,inputMode:"voice",requestId,store:createDraftStore(slots),async submit(){
      const result=await app.inject(phase==="explanation"?{method:"POST",url:"/api/understanding-checks",headers,payload:{...s.request,requestId,explanation:text}}:{method:"PATCH",url:`/api/understanding-checks/${checkId}`,headers,payload:{action:"rehearse",expectedVersion:3,requestId,responseText:text,inputMode:"voice"}});
      expect(result.statusCode).toBe(phase==="explanation"?201:200);
      throw new Error("Response lost after commit");
    }})).rejects.toThrow("Response lost");
  }finally{await app.close();}
  expect((await createDraftStore(slots).load(context))).toMatchObject({requestId,text});
  const resumed=s.serverFor(new MemoryFirstDayRepository(true,s.storage),comparator,initialComparator);
  try{
    const list=(await resumed.inject({method:"GET",url:`/api/source-conversations/${s.sourceId}/understanding-checks`,headers})).json();
    const restored=await recoverUnderstandingDraft({context,bundles:list.items,store:createDraftStore(slots),id:randomUUID});
    if(restored.draft){
      await resumed.inject(phase==="explanation"?{method:"POST",url:"/api/understanding-checks",headers,payload:{...s.request,requestId:restored.requestId,explanation:restored.draft.text}}:{method:"PATCH",url:`/api/understanding-checks/${checkId}`,headers,payload:{action:"rehearse",expectedVersion:list.items[0].check.version,requestId:restored.requestId,responseText:restored.draft.text,inputMode:restored.draft.inputMode}});
    }
    expect(inferenceCalls).toBe(1);
    expect(restored.draft).toBeNull();expect(restored.committed).toBeDefined();
    const saved=(await resumed.inject({method:"GET",url:`/api/source-conversations/${s.sourceId}/understanding-checks`,headers})).json();
    expect(saved.items).toHaveLength(1);expect(saved.items[0].check.responses).toHaveLength(phase==="rehearsal"?1:0);
    expect(await createDraftStore(slots).load(context)).toBeNull();
  }finally{await resumed.close();}
});
