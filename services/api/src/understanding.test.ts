import {resolvedUnderstandingAction} from "./understanding.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beeSourceSchema, createSourceEvidenceId, type CreateUnderstandingRequest } from "@firstday/contracts";
import { MemoryFirstDayRepository, initialState } from "./memory-repository.js";
import { buildApiServer, deterministicScenarioEngine } from "./server.js";
import { createFixtureInstructionExtractor } from "./extraction.js";
import type { RepositoryStorage } from "./repository-storage.js";
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
describe("persisted understanding dialogue",()=>{
  it("restores interrupted clarification, keeps voice/text parity, and requires known context plus confirmation",async()=>{
    const s=await setup(), app=s.serverFor(s.repo);
    try {
      const created=await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request}); expect(created.statusCode).toBe(201);
      const check=created.json().check; expect(check.status).toBe("clarifying"); expect(created.json().sourceEvidence[0].quote).toBe(quote);
      expect((await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request})).json().check.id).toBe(check.id);
      const edit=async(payload:object)=>app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload});
      expect((await edit({action:"rehearse",expectedVersion:1,requestId:randomUUID(),responseText:"Cancel it",inputMode:"voice"})).statusCode).toBe(409);
      const clarified=await edit({action:"clarify",expectedVersion:1,applicability:[true]}); expect(clarified.statusCode).toBe(200);
      const resumed=s.serverFor(new MemoryFirstDayRepository(true,s.storage));
      try{const list=await resumed.inject({method:"GET",url:`/api/source-conversations/${s.sourceId}/understanding-checks`,headers});expect(list.json().items[0].check.applicability).toEqual([true]);}finally{await resumed.close();}
      expect((await edit({action:"confirmInterpretation",expectedVersion:1})).statusCode).toBe(409);
      expect((await edit({action:"confirmInterpretation",expectedVersion:2})).statusCode).toBe(200);
      const response={action:"rehearse",expectedVersion:3,requestId:randomUUID(),responseText:"Keep its original seven-day window",inputMode:"text"};
      const rehearse=await edit(response); expect(rehearse.statusCode).toBe(200);expect(rehearse.json().check.responses).toHaveLength(1);expect(rehearse.json().check.responses[0].inputMode).toBe("text");
      expect((await edit(response)).json().check.responses).toHaveLength(1);
    }finally{await app.close();}
  });
  it("isolates learners, rejects stale revisions and disputed policy, and blocks revoked source reads",async()=>{
    const s=await setup(),app=s.serverFor(s.repo);
    try{
      const create=async(request=s.request)=>app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:request});
      expect((await create({...s.request,instructionRevision:"old"})).statusCode).toBe(409);
      const created=await create();expect(created.statusCode).toBe(201); const id=created.json().check.id;
      const path=`/api/understanding-checks/${id}`;
      expect((await app.inject({method:"PATCH",url:path,headers:{...headers,authorization:"Bearer other"},payload:{action:"dispute",expectedVersion:1}})).statusCode).toBe(404);
      expect((await app.inject({method:"PATCH",url:path,headers,payload:{action:"dispute",expectedVersion:1}})).json().check.status).toBe("disputed");
      expect((await app.inject({method:"PATCH",url:path,headers,payload:{action:"confirmInterpretation",expectedVersion:2}})).statusCode).toBe(409);
      await s.repo.revokeConsent({learnerId:s.learnerId,sourceConversationId:s.sourceId,sourceRevision:"r1",timestamp:time});
      expect((await app.inject({method:"GET",url:`/api/source-conversations/${s.sourceId}/understanding-checks`,headers})).statusCode).toBe(409);
    }finally{await app.close();}
  });
});

describe("understanding provider trust boundary",()=>{
  it.each(["inventedPolicy","fabricatedAnswer","providerException"])("rejects %s without recording a response",async mode=>{
    const s=await setup(),app=s.serverFor(s.repo,async({check})=>{
      if(mode==="providerException")throw new Error("private upstream token");
      return {comparison:"consistent",sourceAction:mode==="inventedPolicy"?"All reservations last ninety days.":resolvedUnderstandingAction(check),answerQuote:mode==="fabricatedAnswer"?"This was never said":"Keep the existing reservation"};
    });
    try{
      let check=(await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request})).json().check;
      const edit=async(payload:object)=>app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload});
      check=(await edit({action:"clarify",expectedVersion:1,applicability:[true]})).json().check;
      check=(await edit({action:"confirmInterpretation",expectedVersion:2})).json().check;
      const result=await edit({action:"rehearse",expectedVersion:3,requestId:randomUUID(),responseText:"Keep the existing reservation",inputMode:"voice"});
      expect(result.statusCode).toBe(500);expect(result.body).not.toContain("private upstream");
      expect((await s.repo.getUnderstanding({learnerId:s.learnerId,checkId:check.id})).check.responses).toEqual([]);
    }finally{await app.close();}
  });
  it("rechecks source consent after a provider call and rolls back that response",async()=>{
    const s=await setup(),app=s.serverFor(s.repo,async({check})=>{
      await s.repo.revokeConsent({learnerId:s.learnerId,sourceConversationId:s.sourceId,sourceRevision:"r1",timestamp:time});
      return {comparison:"consistent",sourceAction:resolvedUnderstandingAction(check),answerQuote:"Cancel new reservations after three days"};
    });
    try{
      const check=(await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request})).json().check;
      const edit=async(payload:object)=>app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload});
      await edit({action:"clarify",expectedVersion:1,applicability:[false]});await edit({action:"confirmInterpretation",expectedVersion:2});
      expect((await edit({action:"rehearse",expectedVersion:3,requestId:randomUUID(),responseText:"Cancel new reservations after three days",inputMode:"text"})).statusCode).toBe(409);
      expect(s.getSaved().understandingChecks.values().next().value!.check.responses).toEqual([]);
    }finally{await app.close();}
  });
  it.each([true,false])("compares older/newer scope from known context with voice/text parity (%s)",async applies=>{
    const s=await setup(),app=s.serverFor(s.repo,async({check,responseText})=>({comparison:"consistent",sourceAction:resolvedUnderstandingAction(check),answerQuote:responseText}));
    try{
      const check=(await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request})).json().check;
      const edit=async(payload:object)=>app.inject({method:"PATCH",url:`/api/understanding-checks/${check.id}`,headers,payload});
      await edit({action:"clarify",expectedVersion:1,applicability:[applies]});await edit({action:"confirmInterpretation",expectedVersion:2});
      for(const [i,inputMode] of (["voice","text"] as const).entries()){
        const result=await edit({action:"rehearse",expectedVersion:3+i,requestId:randomUUID(),responseText:applies?"This predates the change, so keep it until day seven.":"It was made after the change and expired at day three.",inputMode});
        expect(result.statusCode).toBe(200);expect(result.json().check.responses.at(-1).comparison).toBe("consistent");
      }
    }finally{await app.close();}
  });
});

it("rejects fabricated initial explanation/exception anchors without saving a check",async()=>{
 const s=await setup();for(const invalid of [{answerQuote:"I never said this",exceptionIndex:0},{answerQuote:s.request.explanation,exceptionIndex:19}]){
 const app=s.serverFor(s.repo,undefined,async()=>invalid);try{const result=await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request});expect(result.statusCode).toBe(500);expect((await s.repo.listUnderstanding({learnerId:s.learnerId,sourceConversationId:s.sourceId})).items).toEqual([]);}finally{await app.close();}}
});
it("does not repeat initial Nova inference after an interrupted successful request",async()=>{
 const s=await setup();let calls=0;const app=s.serverFor(s.repo,undefined,async()=>{calls++;if(calls>1)throw new Error("Provider unavailable after commit");return {answerQuote:s.request.explanation,exceptionIndex:0};});
 try{const first=await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request});const repeated=await app.inject({method:"POST",url:"/api/understanding-checks",headers,payload:s.request});expect(first.statusCode).toBe(201);expect(repeated.statusCode).toBe(201);expect(repeated.json()).toEqual(first.json());expect(calls).toBe(1);}finally{await app.close();}
});

it("repository rejects a fabricated reopen that skips fresh context clarification", async () => {
  const s = await setup();
  const { updateUnderstandingCheck } = await import("@firstday/scenario-engine");
  const initial = (await s.repo.createUnderstanding({ ...s.request, learnerId: s.learnerId, id: randomUUID(), timestamp: time })).check;
  const disputed = updateUnderstandingCheck(initial, { action: "dispute", expectedVersion: initial.version }, time);
  await s.repo.saveUnderstanding({ learnerId: s.learnerId, previous: initial, next: disputed });
  const reopened = updateUnderstandingCheck(disputed, { action: "reopen", expectedVersion: disputed.version }, time);
  await expect(s.repo.saveUnderstanding({ learnerId: s.learnerId, previous: disputed, next: { ...reopened, status: "readyToRehearse", applicability: [true] } })).rejects.toThrow();
  expect((await s.repo.getUnderstanding({ learnerId: s.learnerId, checkId: initial.id })).check.status).toBe("disputed");
  await s.repo.saveUnderstanding({ learnerId: s.learnerId, previous: disputed, next: reopened });
  expect((await s.repo.getUnderstanding({ learnerId: s.learnerId, checkId: initial.id })).check.status).toBe("clarifying");
});
