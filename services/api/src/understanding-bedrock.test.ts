import { describe, expect, it } from "vitest";
import { createBedrockProvider, DEFAULT_BEDROCK_MODEL } from "./bedrock.js";
import { createUnderstandingCheck, updateUnderstandingCheck } from "@firstday/scenario-engine";
import { resolvedUnderstandingAction, compareUnderstandingResponse } from "./understanding.js";
import { instructionCardSchema } from "@firstday/contracts";
const timestamp="2026-09-30T12:00:00.000Z";
const instruction=instructionCardSchema.parse({id:"11111111-1111-4111-8111-111111111111",sourceConversationId:"22222222-2222-4222-8222-222222222222",sourceRevision:"r1",text:"Reservation window",situation:"A four-day reservation",expectedAction:"New reservations last three days.",exceptions:["Reservations already made keep their original seven-day window."],status:"confirmed",confidence:1,sourceEvidence:[`evd_${"a".repeat(64)}`],createdAt:timestamp,updatedAt:timestamp});
function ready(applies:boolean){let c=createUnderstandingCheck({id:"33333333-3333-4333-8333-333333333333",requestId:"44444444-4444-4444-8444-444444444444",instruction,instructionRevision:"ir1",explanation:"Cancel at day four",inputMode:"voice",timestamp});c=updateUnderstandingCheck(c,{action:"clarify",expectedVersion:1,applicability:[applies]},timestamp);return updateUnderstandingCheck(c,{action:"confirmInterpretation",expectedVersion:2},timestamp);}
describe("Nova understanding boundary",()=>{
  it.each([true,false])("sends supplied context and exact confirmed source action for older/newer practice (%s)",async applies=>{
    const check=ready(applies),responseText=applies?"Keep this older reservation through its seven-day window.":"This new reservation expired at day three.";
    let payload="";
    const provider=createBedrockProvider({region:"us-east-1",modelId:DEFAULT_BEDROCK_MODEL,bearerToken:"ABSKsynthetic"},{async fetchImplementation(_url,init){payload=String(init?.body);return new Response(JSON.stringify({stopReason:"tool_use",output:{message:{content:[{toolUse:{name:"submit_result",input:{actionComparison:"The proposed action follows the supplied policy.",comparison:"consistent",answerQuote:responseText}}}]}}}));}});
    expect(typeof provider.compareUnderstanding).toBe("function");
    const result=await compareUnderstandingResponse(check,{requestId:"55555555-5555-4555-8555-555555555555",responseText,inputMode:"voice"},timestamp,provider.compareUnderstanding);
    expect(result.responses[0]!.comparison).toBe("consistent");expect(payload).toContain("activeAction");expect(payload).toContain(applies?instruction.exceptions[0]:instruction.expectedAction);expect(payload).not.toContain("ABSKsynthetic");
  });

  it.each([
    { applies: true, responseText: "This predates the change, so keep the reservation through its seven-day window.", comparison: "consistent" },
    { applies: true, responseText: "This predates the change, but cancel it after three days.", comparison: "possibleMismatch" },
    { applies: false, responseText: "This new reservation expires after three days.", comparison: "consistent" },
    { applies: false, responseText: "This new reservation stays active for seven days.", comparison: "possibleMismatch" },
  ] as const)("supplies explicit conditional scope for old/new context: $responseText", async ({ applies, responseText, comparison }) => {
    const check = ready(applies);
    let task = "", data: { context?: { sourceClause: string; applies: boolean }[]; activeAction?: string; resolvedAction?: string } = {};
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation(_url, init) {
        const payload = JSON.parse(String(init?.body));
        task = payload.system[0].text;
        data = JSON.parse(payload.messages[0].content[0].text);
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief policy and proposed-action comparison.", comparison, answerQuote: responseText } } }] } } }));
      },
    });
    const result = await compareUnderstandingResponse(check, { requestId: "55555555-5555-4555-8555-555555555555", responseText, inputMode: "voice" }, timestamp, provider.compareUnderstanding);
    expect(task).toContain("A situation's elapsed time is different from the required duration");
    expect(task).toContain("First give a brief actionComparison");
    expect(Object.keys(data).sort()).toEqual(["activeAction", "learnerAnswer"]);
    expect(data.activeAction).toBe(applies ? instruction.exceptions[0] : instruction.expectedAction);
    expect(data.resolvedAction).toBeUndefined();
    expect(result.responses[0]!.comparison).toBe(comparison);
  });

  it.each([
    { responseText: "Check the customer ID; the manager can provide the lost code.", comparison: "consistent" },
    { responseText: "The manager can provide the lost code, so I do not need to check ID.", comparison: "possibleMismatch" },
  ] as const)("preserves unaffected base obligations with an additive exception: $comparison", async ({ responseText, comparison }) => {
    const check = { ...ready(true), instruction: { ...instruction, expectedAction: "Check the customer ID and reservation code.", exceptions: ["A manager may provide a lost reservation code."] } };
    let task = "", activeAction = "";
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation(_url, init) {
        const payload = JSON.parse(String(init?.body));
        task = payload.system[0].text;
        activeAction = JSON.parse(payload.messages[0].content[0].text).activeAction;
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief policy and proposed-action comparison.", comparison, answerQuote: responseText } } }] } } }));
      },
    });
    const result = await compareUnderstandingResponse(check, { requestId: "55555555-5555-4555-8555-555555555555", responseText, inputMode: "text" }, timestamp, provider.compareUnderstanding);
    expect(task).toContain("preserving durations and required steps");
    expect(activeAction).toContain("Check the customer ID and reservation code.");
    expect(result.responses[0]!.comparison).toBe(comparison);
  });

  it.each([0, 1, 3])("constrains initial source selection to exactly the %i actual indexed choices", async count => {
    const exceptions = Array.from({ length: count }, (_, index) => `Source clause ${index}.`);
    const selectedIndex = count ? count - 1 : null;
    let exceptionSchema: { anyOf?: { const?: number }[]; const?: number } = {};
    let choices: unknown;
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation(_url, init) {
        const payload = JSON.parse(String(init?.body));
        exceptionSchema = payload.toolConfig.tools[0].toolSpec.inputSchema.json.properties.exceptionIndex;
        choices = JSON.parse(payload.messages[0].content[0].text).exceptionChoices;
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { answerQuote: "Cancel after four days", exceptionIndex: selectedIndex } } }] } } }));
      },
    });
    const result = await provider.compareUnderstandingInitial({ instruction: { ...instruction, exceptions }, sourceEvidence: [], explanation: "Cancel after four days" });
    expect(result.exceptionIndex).toBe(selectedIndex);
    expect((exceptionSchema.anyOf ?? [exceptionSchema]).flatMap(value => typeof value.const === "number" ? [value.const] : [])).toEqual(exceptions.map((_clause, index) => index));
    expect(choices).toEqual(exceptions.map((sourceClause, index) => ({ index, sourceClause })));
  });

  it("rejects a one-based initial index rather than guessing its intended exception", async () => {
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation() {
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { answerQuote: "Cancel after four days", exceptionIndex: 1 } } }] } } }));
      },
    });
    await expect(provider.compareUnderstandingInitial({ instruction, sourceEvidence: [], explanation: "Cancel after four days" })).rejects.toThrow();
  });

  it("sends only the active older clause to inference and binds the full source reference in application code", async () => {
    const check = ready(true), responseText = "Keep the older reservation for seven days.";
    let data: Record<string, unknown> = {}, toolFields: string[] = [];
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation(_url, init) {
        const payload = JSON.parse(String(init?.body));
        data = JSON.parse(payload.messages[0].content[0].text);
        toolFields = Object.keys(payload.toolConfig.tools[0].toolSpec.inputSchema.json.properties).sort();
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief policy and proposed-action comparison.", comparison: "consistent", answerQuote: responseText } } }] } } }));
      },
    });
    const result = await provider.compareUnderstanding({ check, responseText });
    expect(data).toEqual({ activeAction: instruction.exceptions[0], learnerAnswer: responseText });
    expect(JSON.stringify(data)).not.toContain(instruction.expectedAction);
    expect(toolFields).toEqual(["actionComparison", "answerQuote", "comparison"]);
    expect(result).not.toHaveProperty("actionComparison");
    expect(result.sourceAction).toBe(resolvedUnderstandingAction(check));
    expect(result.sourceAction).toContain(instruction.expectedAction);
  });

  it("rejects missing active context before making a provider call", async () => {
    let calls = 0;
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, { async fetchImplementation() { calls++; throw new Error("Must not call"); } });
    await expect(provider.compareUnderstanding({ check: { ...ready(true), status: "clarifying", applicability: [null] }, responseText: "Cancel it" })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("rejects a model-supplied extra policy field instead of binding it to the comparison", async () => {
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, { async fetchImplementation() { return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief comparison.", comparison: "consistent", answerQuote: "Keep it", sourceAction: "Invented policy" } } }] } } })); } });
    await expect(provider.compareUnderstanding({ check: ready(true), responseText: "Keep it" })).rejects.toThrow();
  });

  it.each([undefined, "", " ", null, "a".repeat(1001)])("rejects a missing or malformed brief comparison (%#)", async actionComparison => {
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
      async fetchImplementation() {
        return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { ...(actionComparison !== undefined ? { actionComparison } : {}), comparison: "consistent", answerQuote: "Keep it" } } }] } } }));
      },
    });
    await expect(provider.compareUnderstanding({ check: ready(true), responseText: "Keep it" })).rejects.toThrow();
  });

  it.each(["consistent", "possibleMismatch", "uncertain"])("rejects an empty provider quote for %s", async comparison => {
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, { async fetchImplementation() {
      return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief comparison.", comparison, answerQuote: "" } } }] } } }));
    } });
    await expect(provider.compareUnderstanding({ check: ready(true), responseText: "Keep it" })).rejects.toThrow();
  });

  it("requires a nonempty quote in the plain inference schema and clears a validated uncertain quote for the application", async () => {
    let schema: { type?: string; anyOf?: unknown; additionalProperties?: boolean; properties?: { answerQuote?: { minLength?: number; maxLength?: number } } } = {}, task = "";
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, { async fetchImplementation(_url, init) {
      const payload = JSON.parse(String(init?.body));
      schema = payload.toolConfig.tools[0].toolSpec.inputSchema.json;
      task = payload.system[0].text;
      return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "The answer is ambiguous.", comparison: "uncertain", answerQuote: "Maybe keep it" } } }] } } }));
    } });
    const result = await provider.compareUnderstanding({ check: ready(true), responseText: "Maybe keep it, but I am unsure." });
    expect(schema.type).toBe("object"); expect(schema.anyOf).toBeUndefined(); expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.answerQuote).toMatchObject({ minLength: 1, maxLength: 4000 });
    expect(task).toContain("For every classification, answerQuote must copy an exact nonempty substring");
    expect(result).toEqual({ comparison: "uncertain", answerQuote: "", sourceAction: resolvedUnderstandingAction(ready(true)) });
  });

  it.each(["consistent", "possibleMismatch", "uncertain"])("rejects a fabricated provider quote for %s", async comparison => {
    const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, { async fetchImplementation() {
      return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { actionComparison: "Brief comparison.", comparison, answerQuote: "Words never spoken" } } }] } } }));
    } });
    await expect(provider.compareUnderstanding({ check: ready(true), responseText: "Keep it" })).rejects.toThrow();
  });
});

it("preserves base obligations with partial and multiple applicable exceptions",async()=>{
 const check={...ready(true),instruction:{...instruction,expectedAction:"Check the customer ID and reservation code.",exceptions:["A manager may provide a lost reservation code.","Use the accessible desk if the customer needs it."]},applicability:[true,true]};
 const action=resolvedUnderstandingAction(check);expect(action).toContain("Check the customer ID");expect(action).toContain("manager may provide");expect(action).toContain("accessible desk");
 const {offlineUnderstandingComparator}=await import("./understanding.js");
 const result=await offlineUnderstandingComparator({check,responseText:"A manager may provide a lost reservation code."});expect(result.comparison).toBe("uncertain");
});

it("preserves explicit source exception even when Nova leaves it inline, for Bee as well as fixture sources",async()=>{
 const {randomUUID}=await import("node:crypto"),{MemoryFirstDayRepository}=await import("./memory-repository.js"),{beeSourceSchema}=await import("@firstday/contracts");
 for(const sourceKind of ["bee","fixture"] as const){
  const quote="When a customer asks whether a reservation is active, New reservations last three days. Reservations already made keep their original seven-day window.";
  const source=beeSourceSchema.parse({id:sourceKind==="bee"?"123456":"fixture-exception",sourceKind,title:"Conditional source",startedAt:timestamp,status:"processed",revision:"r1",transcript:quote,utterances:[{id:"u1",startMs:0,endMs:12000,text:quote}]});
  const repo=new MemoryFirstDayRepository(true),learnerId=randomUUID(),sourceConversationId=randomUUID();await repo.importSource({learnerId,sourceConversationId,source,timestamp});const context=await repo.prepareExtraction({learnerId,sourceConversationId,sourceRevision:"r1"});
  const provider=createBedrockProvider({region:"us-east-1",modelId:DEFAULT_BEDROCK_MODEL,bearerToken:"ABSKsynthetic"},{async fetchImplementation(){return new Response(JSON.stringify({stopReason:"tool_use",output:{message:{content:[{toolUse:{name:"submit_result",input:{instructions:[{text:"Reservation windows",situation:"A customer asks whether a reservation is active",expectedAction:"New reservations last three days and existing reservations keep seven days.",exceptions:[],utteranceIds:["u1"]}],questions:[]}}}]}}}));}});
  const result=await provider.extractor.extract({...context,excludedRanges:[],timestamp,idFactory:randomUUID});expect(result.items[0]!.expectedAction).toBe("New reservations last three days.");expect(result.items[0]!.exceptions).toEqual(["Reservations already made keep their original seven-day window."]);expect(result.sourceEvidence[0]!.quote).toBe(quote);
 }
});

async function extractMixedReservationSource(rules: { text: string; situation: string; expectedAction: string; exceptions?: unknown; utteranceIds: string[] }[], sourceQuote?: string) {
  const { randomUUID } = await import("node:crypto");
  const { MemoryFirstDayRepository } = await import("./memory-repository.js");
  const { beeSourceSchema } = await import("@firstday/contracts");
  const quote = sourceQuote ?? "Check the reservation record before checking its window. New reservations last three days. Reservations already made keep their original seven-day window. When a customer collects a reservation, check the reservation name and phone number. When a customer returns a damaged book, place it on the back-room cart before issuing a refund.";
  const source = beeSourceSchema.parse({ id: "654321", sourceKind: "bee", title: "Solo training", startedAt: timestamp, status: "processed", revision: "r1", transcript: quote, utterances: [{ id: "u1", startMs: 0, endMs: 30000, text: quote }] });
  const repository = new MemoryFirstDayRepository(true);
  const learnerId = randomUUID(), sourceConversationId = randomUUID();
  await repository.importSource({ learnerId, sourceConversationId, source, timestamp });
  const context = await repository.prepareExtraction({ learnerId, sourceConversationId, sourceRevision: "r1" });
  const provider = createBedrockProvider({ region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKsynthetic" }, {
    async fetchImplementation() {
      return new Response(JSON.stringify({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input: { instructions: rules, questions: [] } } }] } } }));
    },
  });
  return provider.extractor.extract({ ...context, excludedRanges: [], timestamp, idFactory: randomUUID });
}

it("binds a mixed solo utterance only to its reservation-window card, retaining other obligations and unrelated procedures", async () => {
  const result = await extractMixedReservationSource([
    { text: "Reservation windows", situation: "A customer asks if a reservation is active", expectedAction: "Check the reservation record before checking its window.", exceptions: [], utteranceIds: ["u1"] },
    { text: "Collection", situation: "A customer collects a reservation", expectedAction: "Check the reservation name and phone number.", exceptions: [], utteranceIds: ["u1"] },
    { text: "Damage", situation: "A customer returns a damaged book", expectedAction: "Place it on the back-room cart before issuing a refund.", exceptions: [], utteranceIds: ["u1"] },
  ]);
  expect(result.items).toHaveLength(3);
  expect(result.items[0]!.expectedAction).toContain("Check the reservation record");
  expect(result.items[0]!.expectedAction).toContain("New reservations last three days.");
  expect(result.items[0]!.exceptions).toEqual(["Reservations already made keep their original seven-day window."]);
  expect(result.items[1]!.expectedAction).toBe("Check the reservation name and phone number.");
  expect(result.items[1]!.exceptions).toEqual([]);
  expect(result.items[2]!.exceptions).toEqual([]);
  expect(result.openQuestions).toEqual([]);
});

it("withholds ambiguous reservation interpretations instead of promoting an exception-free policy", async () => {
  const result = await extractMixedReservationSource([
    { text: "Reservation", situation: "A customer has a reservation", expectedAction: "Handle the reservation.", exceptions: [], utteranceIds: ["u1"] },
    { text: "Collection", situation: "A customer collects a reservation", expectedAction: "Check the reservation name and phone number.", exceptions: [], utteranceIds: ["u1"] },
  ]);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.text).toBe("Collection");
  expect(result.openQuestions).toHaveLength(1);
  expect(result.openQuestions[0]!.shareConsent).toBe(false);
  expect(result.openQuestions[0]!.sourceEvidence).toEqual([result.sourceEvidence[0]!.id]);
});

it("withholds both competing window targets instead of assigning one shared clause to both", async () => {
  const result = await extractMixedReservationSource([
    { text: "Windows", situation: "A reservation is active", expectedAction: "Check the reservation window.", exceptions: [], utteranceIds: ["u1"] },
    { text: "Days", situation: "A reservation may have expired", expectedAction: "Count reservation days.", exceptions: [], utteranceIds: ["u1"] },
  ]);
  expect(result.items).toEqual([]);
  expect(result.openQuestions).toHaveLength(2);
});

it("binds a unique generic reservation-status card when its whole source is exclusively the exact two window clauses", async () => {
  const result = await extractMixedReservationSource([
    { text: "Reservation status", situation: "A customer asks about the status of their reservation.", expectedAction: "Check the reservation status based on the type of reservation.", exceptions: ["New reservations last three days.", "Reservations already made keep their original seven-day window."], utteranceIds: ["u1"] },
  ], "When a customer asks whether a reservation is active, New reservations last three days. Reservations already made keep their original seven-day window.");
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.expectedAction).toBe("New reservations last three days.");
  expect(result.items[0]!.exceptions).toEqual(["Reservations already made keep their original seven-day window."]);
});

it("does not bind an exclusively window source to a conflicting collection procedure", async () => {
  const result = await extractMixedReservationSource([
    { text: "Collection status", situation: "A customer collects a reservation", expectedAction: "Check the active reservation status and their ID.", exceptions: [], utteranceIds: ["u1"] },
  ], "New reservations last three days. Reservations already made keep their original seven-day window.");
  expect(result.items).toEqual([]);
  expect(result.openQuestions).toHaveLength(1);
});

it("withholds a source exception Nova cannot decompose rather than making it ready without context", async () => {
  const result = await extractMixedReservationSource([
    { text: "ID", situation: "A customer collects an order", expectedAction: "Check the customer ID.", exceptions: [], utteranceIds: ["u1"] },
  ], "When a customer collects an order, check the customer ID unless a manager has already verified it.");
  expect(result.items).toEqual([]);
  expect(result.openQuestions).toHaveLength(1);
  expect(result.openQuestions[0]!.sourceEvidence).toEqual([result.sourceEvidence[0]!.id]);
});

it("does not exempt an unrelated unless clause merely because a shared utterance contains canonical reservation windows", async () => {
  const result = await extractMixedReservationSource([
    { text: "Collection ID", situation: "A customer collects a reservation", expectedAction: "Check their ID.", exceptions: [], utteranceIds: ["u1"] },
  ], "New reservations last three days. Reservations already made keep their original seven-day window. When a customer collects a reservation, check their ID unless a manager already verified it.");
  expect(result.items).toEqual([]);
  expect(result.openQuestions).toHaveLength(1);
  expect(result.openQuestions[0]!.sourceEvidence).toEqual([result.sourceEvidence[0]!.id]);
});

it("normalizes omitted Nova exception fields without losing trusted reservation conditions", async () => {
  const result = await extractMixedReservationSource([
    { text: "Window", situation: "A reservation is active", expectedAction: "Check the reservation window.", utteranceIds: ["u1"] },
    { text: "Collection", situation: "A customer collects a reservation", expectedAction: "Check the reservation name and phone number.", utteranceIds: ["u1"] },
    { text: "Damage", situation: "A damaged book is returned", expectedAction: "Place it on the back-room cart before issuing a refund.", utteranceIds: ["u1"] },
  ]);
  expect(result.items).toHaveLength(3);
  expect(result.items[0]!.exceptions).toEqual(["Reservations already made keep their original seven-day window."]);
  expect(result.items[1]!.exceptions).toEqual([]);
  expect(result.items[2]!.exceptions).toEqual([]);
});

it.each([null, "not an array", {}])("rejects present malformed exception values (%j)", async exceptions => {
  await expect(extractMixedReservationSource([
    { text: "Window", situation: "A reservation is active", expectedAction: "Check the window.", exceptions, utteranceIds: ["u1"] },
  ])).rejects.toThrow();
});
