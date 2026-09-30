import { describe,expect,it } from "vitest";
import { createSyntheticFirstDayClient } from "./synthetic-client";
import { hasUnderstandingClient } from "./understanding-client";
describe("usable conditional reservation demo",()=>{
 it("offers the new/old reservation source, keeps unknown context out, rehearses both cases and saves private questions",async()=>{
  const client=createSyntheticFirstDayClient();expect(hasUnderstandingClient(client)).toBe(true);if(!hasUnderstandingClient(client))throw new Error("Missing understanding interface");
  const list=await client.listConversations({sourceKind:"fixture",limit:20});const source=list.items.find(i=>i.id==="fixture-reservation-exceptions");expect(source).toBeDefined();if(!source?.revision)throw new Error("Missing source revision");
  const {sourceConversation}=await client.importConversation({beeSourceId:source.id,sourceKind:"fixture",sourceRevision:source.revision,consent:{confirmed:true}});
  const extraction=await client.extractInstructions({sourceConversationId:sourceConversation.id,sourceRevision:sourceConversation.sourceRevision,excludedRanges:[]});expect(extraction.items).toHaveLength(3);
  for(const item of extraction.items)await client.updateInstruction({instructionId:item.id,sourceRevision:item.sourceRevision,status:"confirmed"});
  const rule=extraction.items.find(r=>r.exceptions.length)!;expect(rule.expectedAction).toBe("New reservations last three days.");expect(rule.exceptions).toEqual(["Reservations already made keep their original seven-day window."]);
  let counter=10;const id=()=>`99999999-9999-4999-8999-${String(counter++).padStart(12,"0")}`;
  for(const applies of [true,false]){
   let {check}=await client.createUnderstanding({instructionId:rule.id,sourceRevision:rule.sourceRevision,instructionRevision:extraction.instructionRevision,requestId:id(),explanation:"I would cancel this four-day reservation.",inputMode:"voice"});
   await expect(client.updateUnderstanding({checkId:check.id,action:"rehearse",expectedVersion:check.version,requestId:id(),responseText:"Cancel it",inputMode:"text"})).rejects.toMatchObject({code:"INVALID_STATE"});
   check=(await client.updateUnderstanding({checkId:check.id,action:"clarify",expectedVersion:1,applicability:[applies]})).check;
   check=(await client.updateUnderstanding({checkId:check.id,action:"confirmInterpretation",expectedVersion:2})).check;
   check=(await client.updateUnderstanding({checkId:check.id,action:"rehearse",expectedVersion:3,requestId:id(),responseText:applies?rule.exceptions[0]!:rule.expectedAction,inputMode:"voice"})).check;
   expect(check.responses[0]!.comparison).toBe("consistent");expect(check.responses[0]!.applicability).toEqual([applies]);
  }
  const saved=await client.listUnderstanding(sourceConversation.id);const check=saved.items[0]!.check;
  await client.updateUnderstanding({checkId:check.id,action:"dispute",expectedVersion:check.version});
  await expect(client.createPractice({sourceConversationId:sourceConversation.id,sourceRevision:sourceConversation.sourceRevision,instructionIds:extraction.items.map(r=>r.id),title:"Practice"})).rejects.toMatchObject({code:"INVALID_STATE"});
  const question=await client.createOpenQuestion({sourceConversationId:sourceConversation.id,sourceRevision:sourceConversation.sourceRevision,instructionId:rule.id,question:"Was this reservation made before the policy change?",sourceEvidence:rule.sourceEvidence,shareConsent:false});expect(question.openQuestion.shareConsent).toBe(false);
  expect((await client.listUnderstanding(sourceConversation.id)).items[0]!.check.status).toBe("disputed");
  if(!client.updateOpenQuestion)throw new Error("Question review unavailable");
  const closed=await client.updateOpenQuestion({openQuestionId:question.openQuestion.id,sourceRevision:rule.sourceRevision,status:"resolved",resolution:"I reviewed the unchanged source and confirmed the reservation predates the change.",shareConsent:false});expect(closed.openQuestion.status).toBe("resolved");
  const reopened=(await client.updateUnderstanding({checkId:check.id,action:"reopen",expectedVersion:check.version+1})).check;expect(reopened.status).toBe("clarifying");expect(reopened.responses).toHaveLength(1);
 });

 it.each(["generation", "existingAttempt"] as const)("keeps an unresolved private question blocking %s after the check is reopened", async stage => {
  const client = createSyntheticFirstDayClient();
  if (!hasUnderstandingClient(client) || !client.updateOpenQuestion) throw new Error("Missing understanding/question interface");
  const { sourceConversation } = await client.importConversation({ beeSourceId: "fixture-reservation-exceptions", sourceKind: "fixture", sourceRevision: "fixture-reservation-exceptions-r1", consent: { confirmed: true } });
  const extraction = await client.extractInstructions({ sourceConversationId: sourceConversation.id, sourceRevision: sourceConversation.sourceRevision, excludedRanges: [] });
  for (const item of extraction.items) await client.updateInstruction({ instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed" });
  const rule = extraction.items.find(item => item.exceptions.length)!;
  const practiceInput = { sourceConversationId: sourceConversation.id, sourceRevision: sourceConversation.sourceRevision, instructionIds: extraction.items.map(item => item.id), title: "Practice" };
  const practice = stage === "existingAttempt" ? await client.createPractice(practiceInput) : null;
  let { check } = await client.createUnderstanding({ instructionId: rule.id, sourceRevision: rule.sourceRevision, instructionRevision: extraction.instructionRevision, requestId: "77777777-7777-4777-8777-777777777777", explanation: "Cancel this reservation", inputMode: "text" });
  check = (await client.updateUnderstanding({ checkId: check.id, action: "dispute", expectedVersion: check.version })).check;
  const { openQuestion } = await client.createOpenQuestion({ sourceConversationId: sourceConversation.id, sourceRevision: rule.sourceRevision, instructionId: rule.id, question: "Which context applies?", sourceEvidence: rule.sourceEvidence, shareConsent: false });
  check = (await client.updateUnderstanding({ checkId: check.id, action: "reopen", expectedVersion: check.version })).check;
  check = (await client.updateUnderstanding({ checkId: check.id, action: "clarify", expectedVersion: check.version, applicability: [false] })).check;
  check = (await client.updateUnderstanding({ checkId: check.id, action: "confirmInterpretation", expectedVersion: check.version })).check;
  const attemptInput = { scenarioId: practice?.scenarios.find(scenario => scenario.expectedRuleIds.includes(rule.id))?.id ?? "88888888-8888-4888-8888-888888888888", sourceRevision: rule.sourceRevision, instructionRevision: extraction.instructionRevision, responseText: rule.expectedAction, inputMode: "text" as const };
  const operation = () => stage === "generation" ? client.createPractice(practiceInput) : client.submitAttempt(attemptInput);
  await expect(operation()).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(client.updateUnderstanding({ checkId: check.id, action: "rehearse", expectedVersion: check.version, requestId: "99999999-9999-4999-8999-999999999999", responseText: rule.expectedAction, inputMode: "text" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await client.updateOpenQuestion({ openQuestionId: openQuestion.id, sourceRevision: rule.sourceRevision, status: "resolved", resolution: "Reviewed the unchanged source and confirmed this is a new reservation.", shareConsent: false });
  const result = await operation();
  if (stage === "generation") expect("practiceSet" in result && result.practiceSet.status).toBe("ready");
  else expect("attempt" in result && result.attempt.result).toBe("covered");
 });
});
