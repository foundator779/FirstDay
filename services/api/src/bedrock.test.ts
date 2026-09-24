import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { beeSourceSchema } from "@firstday/contracts";
import { extractSyntheticInstructions, generateSyntheticPractice } from "@firstday/scenario-engine";
import library from "../../../fixtures/transcripts/library-onboarding.json" with { type: "json" };
import libraryUpdate from "../../../fixtures/transcripts/library-policy-update.json" with { type: "json" };
import { createBedrockProvider, readBedrockConfig, DEFAULT_BEDROCK_MODEL } from "./bedrock.js";
import { createMemoryRepository } from "./memory-repository.js";
import { createDemoGateway } from "./demo-server.js";
import { createProductionApiServer } from "./index.js";
import { readApiRuntimeConfig } from "./config.js";

const source = beeSourceSchema.parse(library);
const config = { region: "us-east-1", modelId: DEFAULT_BEDROCK_MODEL, bearerToken: "ABSKdevelopmenttest" };
const timestamp = "2026-09-14T16:00:00.000Z";
function toolResponse(input: unknown) {
  return Response.json({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_result", input } }] } } });
}
function providerFor(input: unknown) {
  const request = vi.fn<typeof fetch>(async () => toolResponse(input));
  return { provider: createBedrockProvider(config, { fetchImplementation: request }), request };
}
async function extractionInput() {
  const sourceConversation = await createMemoryRepository().importSource({ learnerId: randomUUID(), sourceConversationId: randomUUID(), source, timestamp });
  return { source, sourceConversation, excludedRanges: [], previousConfirmedInstructions: [], timestamp, idFactory: randomUUID };
}
function practiceInput() {
  const extraction = extractSyntheticInstructions({ source, sourceConversationId: randomUUID(), excludedRanges: [], idFactory: randomUUID, timestamp });
  return { learnerId: randomUUID(), sourceConversationId: extraction.sourceConversationId, sourceRevision: source.revision, sourceKind: "fixture" as const, instructionRevision: extraction.instructionRevision, title: "Library practice", practiceSetId: randomUUID(), scenarioIds: [randomUUID(), randomUUID(), randomUUID()], instructions: extraction.items.map((rule) => ({ ...rule, status: "confirmed" as const })), sourceEvidence: extraction.sourceEvidence, timestamp };
}
const draftRule = { text: "Record the kit number in the blue ledger.", situation: "A visitor borrows a reading kit", expectedAction: "Record the kit number in the blue ledger.", exceptions: [], utteranceIds: ["library-onboarding-2"] };

describe("Bedrock boundary", () => {
  it("requires explicit configuration and rejects unsafe endpoint or token values", () => {
    expect(readBedrockConfig({ AWS_BEARER_TOKEN_BEDROCK: config.bearerToken })).toBeUndefined();
    expect(readBedrockConfig({ FIRSTDAY_AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: config.bearerToken })).toEqual(config);
    for (const override of [{ AWS_REGION: "us-east-1.evil.test" }, { AWS_BEARER_TOKEN_BEDROCK: "" }, { BEDROCK_MODEL_ID: "../../other?key=secret" }, { FIRSTDAY_AI_PROVIDER: "typo" }]) {
      expect(() => readBedrockConfig({ FIRSTDAY_AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: config.bearerToken, ...override })).toThrow();
    }
  });

  it("binds model references to exact included utterances and strips excluded text before sending", async () => {
    const input = await extractionInput();
    const excluded = source.utterances[4]!;
    const { provider, request } = providerFor({ instructions: [draftRule], questions: [] });
    const result = await provider.extractor.extract({ ...input, excludedRanges: [{ startMs: excluded.startMs, endMs: excluded.endMs }] });
    expect(result.items[0]).toMatchObject({ status: "needsReview", createdAt: timestamp, sourceConversationId: input.sourceConversation.id });
    expect(result.sourceEvidence[0]).toMatchObject({ quote: source.utterances[1]!.text, utteranceIds: ["library-onboarding-2"] });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(`https://bedrock-runtime.us-east-1.amazonaws.com/model/${encodeURIComponent(DEFAULT_BEDROCK_MODEL)}/converse`);
    expect(init?.redirect).toBe("error");
    expect(init?.body).not.toContain(excluded.text);
    expect(init?.body).not.toContain(config.bearerToken);
    expect(JSON.stringify(result)).not.toContain(config.bearerToken);
  });

  it("rejects unknown and excluded evidence IDs instead of persisting a model quote", async () => {
    const input = await extractionInput();
    for (const utteranceIds of [["invented-utterance"], ["library-onboarding-2"]]) {
      const { provider } = providerFor({ instructions: [{ ...draftRule, utteranceIds }], questions: [] });
      const u = source.utterances[1]!;
      await expect(provider.extractor.extract({ ...input, excludedRanges: [{ startMs: u.startMs, endMs: u.endMs }] })).rejects.toThrow();
    }
  });

  it("makes no model request when every utterance is excluded", async () => {
    const { provider, request } = providerFor(null);
    const result = await provider.extractor.extract({ ...await extractionInput(), excludedRanges: [{ startMs: 0, endMs: 999999 }] });
    expect(result.items).toEqual([]); expect(request).not.toHaveBeenCalled();
  });

  it("keeps uncertain source language out of model input and discards a proposed rule using it", async () => {
    const uncertain = source.utterances[4]!;
    const { provider, request } = providerFor({ instructions: [{ ...draftRule, utteranceIds: [uncertain.id] }], questions: [] });
    const result = await provider.extractor.extract(await extractionInput());
    expect(result.items).toEqual([]);
    expect(result.openQuestions).toHaveLength(1);
    expect(result.sourceEvidence[0]?.quote).toBe(uncertain.text);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content[0].text).not.toContain(uncertain.text);
    expect(result.openQuestions[0]?.shareConsent).toBe(false);
  });

  it.each(["http", "truncated", "wrong-tool", "invalid-json", "extra-field", "network"])("fails closed and sanitizes %s provider failures", async (mode) => {
    const request = vi.fn<typeof fetch>(async () => {
      if (mode === "network") throw new Error(config.bearerToken);
      if (mode === "http") return Response.json({ message: config.bearerToken }, { status: 403 });
      if (mode === "invalid-json") return new Response("not-json " + config.bearerToken);
      if (mode === "extra-field") return toolResponse({ instructions: [], questions: [], secret: config.bearerToken });
      return Response.json({ stopReason: mode === "truncated" ? "max_tokens" : "tool_use", output: { message: { content: [{ toolUse: { name: mode === "wrong-tool" ? "other" : "submit_result", input: { instructions: [], questions: [] } } }] } } });
    });
    const provider = createBedrockProvider(config, { fetchImplementation: request });
    await expect(provider.extractor.extract(await extractionInput())).rejects.toThrow("A dependency returned invalid output.");
  });

  it("keeps generated scenarios tied to server IDs, rule IDs, order and source evidence", async () => {
    const input = practiceInput();
    const { provider } = providerFor({ scenarios: [...input.instructions].reverse().map((r) => ({ ruleId: r.id, prompt: "A visitor needs your help. What do you do?", context: "At the library desk." })) });
    const result = await provider.generateStandardPracticeSet(input);
    expect(result.scenarios.map((s) => s.id)).toEqual(input.scenarioIds);
    expect(result.scenarios.map((s) => s.expectedRuleIds[0])).toEqual(input.instructions.map((r) => r.id));
    expect(result.scenarios[0]!.sourceEvidence).toEqual(input.instructions[0]!.sourceEvidence);
  });

  it("rejects duplicate or invented scenario rules and unconfirmed input", async () => {
    const input = practiceInput();
    for (const id of [randomUUID(), input.instructions[0]!.id]) {
      const { provider } = providerFor({ scenarios: Array.from({ length: 3 }, () => ({ ruleId: id, prompt: "What do you do?", context: "At the desk." })) });
      await expect(provider.generateStandardPracticeSet(input)).rejects.toThrow();
    }
    const { provider, request } = providerFor(null);
    await expect(provider.generateStandardPracticeSet({ ...input, instructions: input.instructions.map((r) => ({ ...r, status: "needsReview" })) })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("derives grade partitions and requires exact learner evidence for a covered answer", async () => {
    const input = practiceInput(); const scenario = generateSyntheticPractice(input).scenarios[0]!;
    const context = { scenario, responseText: "I would use the blue ledger.", instructions: input.instructions, sourceEvidence: input.sourceEvidence };
    for (const [status, expected] of [["covered", "covered"], ["partial", "partial"], ["missed", "missed"], ["needsReview", "needsReview"]] as const) {
      const { provider } = providerFor({ rules: [{ ruleId: scenario.expectedRuleIds[0], status, answerQuote: context.responseText }] });
      const grade = await provider.evaluateScenario(context);
      expect(grade.result).toBe(expected);
      expect(grade.matchedRuleIds).toEqual(status === "covered" ? scenario.expectedRuleIds : []);
      expect(grade.sourceEvidence).toEqual(scenario.sourceEvidence);
    }
    for (const rules of [[{ ruleId: scenario.expectedRuleIds[0], status: "covered", answerQuote: "An invented learner statement." }], [{ ruleId: randomUUID(), status: "covered", answerQuote: context.responseText }]]) {
      await expect(providerFor({ rules }).provider.evaluateScenario(context)).rejects.toThrow();
    }
  });

  it.each(["old", "new"])("runs practice and atomic Change Drill with %s source revocation through production API wiring", async (revokedSide) => {
    const extraction = extractSyntheticInstructions({ source, sourceConversationId: randomUUID(), excludedRanges: [], idFactory: randomUUID, timestamp });
    const model = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: { text: string }[] }[] };
      const data = JSON.parse(body.messages[0]!.content[0]!.text) as { utterances?: { id: string }[]; previousRules?: { id: string; expectedAction: string }[]; rules?: { ruleId: string }[]; learnerAnswer?: string };
      if (data.utterances?.[0]?.id === "library-policy-update-1") return toolResponse({ instructions: [{ ...draftRule, expectedAction: "Record the kit number in the orange ledger.", text: "Record the kit number in the orange ledger.", utteranceIds: ["library-policy-update-2"], supersedesId: data.previousRules!.find((r) => r.expectedAction.includes("blue ledger"))!.id }], questions: [] });
      if (data.utterances) return toolResponse({ instructions: extraction.items.map((r, i) => ({ text: r.text, situation: r.situation, expectedAction: r.expectedAction, exceptions: [], utteranceIds: [source.utterances[i + 1]!.id] })), questions: [] });
      if (data.learnerAnswer) return toolResponse({ rules: data.rules!.map((r) => ({ ruleId: r.ruleId, status: "covered", answerQuote: data.learnerAnswer })) });
      return toolResponse({ scenarios: data.rules!.map((r) => ({ ruleId: r.ruleId, prompt: "A visitor arrives. What do you do?", context: "At your library desk." })) });
    });
    const env = { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: config.bearerToken, FIRSTDAY_BEE_BRIDGE_TOKEN: "bridge-token-for-a-local-test-at-least-32-chars", FIRSTDAY_DEMO_SESSION_TOKEN: "test-token", FIRSTDAY_DEMO_LEARNER_ID: randomUUID() };
    const update = beeSourceSchema.parse(libraryUpdate);
    const server = createProductionApiServer(readApiRuntimeConfig(env), { beeGateway: createDemoGateway([source, update]), bedrockFetchImplementation: model });
    async function call(method: "POST" | "PATCH" | "GET", url: string, payload?: Record<string, unknown>) {
      const result = await server.inject({ method, url, headers: { authorization: "Bearer test-token" }, ...(payload ? { payload } : {}) });
      expect(result.statusCode).toBeLessThan(300); return result.json();
    }
    try {
      const imported = await call("POST", "/api/imports", { beeSourceId: source.id, sourceRevision: source.revision, sourceKind: "fixture", consent: { confirmed: true } });
      const extracted = await call("POST", `/api/source-conversations/${imported.sourceConversation.id}/extract`, { sourceRevision: source.revision, excludedRanges: [] });
      for (const rule of extracted.items) await call("PATCH", `/api/instructions/${rule.id}`, { sourceRevision: source.revision, status: "confirmed" });
      const practice = await call("POST", "/api/practice-sets", { sourceConversationId: imported.sourceConversation.id, sourceRevision: source.revision, instructionIds: extracted.items.map((r: { id: string }) => r.id), title: "Practice" });
      for (const scenario of practice.scenarios) await call("POST", `/api/scenarios/${scenario.id}/attempts`, { sourceRevision: source.revision, instructionRevision: extracted.instructionRevision, responseText: "A paraphrased learner action.", inputMode: "text" });
      const saved = await call("GET", `/api/practice-sets/${practice.practiceSet.id}`);
      expect(saved.practiceSet.status).toBe("complete"); expect(saved.progress).toEqual({ completed: 3, total: 3 });
      expect(model).toHaveBeenCalledTimes(5);
      const importedUpdate = await call("POST", "/api/imports", { beeSourceId: update.id, sourceKind: "fixture", sourceRevision: update.revision, consent: { confirmed: true } });
      const newId = importedUpdate.sourceConversation.id;
      await call("POST", `/api/source-conversations/${newId}/extract`, { sourceRevision: update.revision, excludedRanges: [] });
      const oldId = extracted.sourceConversationId;
      const compareBody = { newSourceConversationId: newId, previousInstructionRevision: extracted.instructionRevision };
      const compared = await call("POST", `/api/source-conversations/${oldId}/compare`, compareBody);
      const repeated = await call("POST", `/api/source-conversations/${oldId}/compare`, compareBody);
      expect(repeated).toEqual(compared);
      expect(compared.changes).toHaveLength(1);
      const confirmUrl = `/api/changes/${compared.changes[0].id}/confirm`;
      const wrong = await server.inject({ method: "POST", url: confirmUrl, headers: { authorization: "Bearer test-token" }, payload: { sourceRevision: "wrong-revision" } });
      expect(wrong.statusCode).toBe(409);
      expect((await call("GET", `/api/practice-sets/${practice.practiceSet.id}`)).practiceSet.status).toBe("complete");
      const change = await call("POST", confirmUrl, { sourceRevision: update.revision });
      expect(change.stalePracticeSetIds).toContain(practice.practiceSet.id);
      expect(new Set(change.sourceEvidence.map((e: { sourceConversationId: string }) => e.sourceConversationId)).size).toBe(2);
      const duplicate = await server.inject({ method: "POST", url: confirmUrl, headers: { authorization: "Bearer test-token" }, payload: { sourceRevision: update.revision } });
      expect(duplicate.statusCode).toBe(409);
      const drill = change.changeDrill;
      expect((await call("GET", `/api/practice-sets/${drill.practiceSet.id}`)).changeProposal.status).toBe("confirmed");
      await call("POST", `/api/source-conversations/${revokedSide === "old" ? oldId : newId}/consent/revoke`, { sourceRevision: revokedSide === "old" ? source.revision : update.revision });
      const callsBefore = model.mock.calls.length;
      const blocked = await server.inject({ method: "POST", url: `/api/scenarios/${drill.scenarios[0].id}/attempts`, headers: { authorization: "Bearer test-token" }, payload: { sourceRevision: update.revision, instructionRevision: drill.practiceSet.instructionRevision, responseText: "Use the orange ledger.", inputMode: "text" } });
      expect(blocked.statusCode).toBe(409);
      expect(model).toHaveBeenCalledTimes(callsBefore);
      const stale = await call("GET", `/api/practice-sets/${drill.practiceSet.id}`);
      expect(stale.practiceSet.status).toBe("stale"); expect(stale.progress.completed).toBe(0);
    } finally { await server.close(); }
  });
});
