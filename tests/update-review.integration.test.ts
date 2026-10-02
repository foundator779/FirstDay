import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beeSourceSchema, type BeeSource } from "@firstday/contracts";
import { extractSyntheticInstructions } from "@firstday/scenario-engine";
import { createFirstDayApiClient } from "../apps/mobile/src/api.js";
import { compareTrainingUpdate } from "../apps/mobile/src/practice-workflow.js";
import { createMemoryRepository } from "../services/api/src/memory-repository.js";
import { buildApiServer, deterministicScenarioEngine } from "../services/api/src/server.js";

// Fictional transport simulation, not evidence of a real Bee recording or model call.
function source(id: string, updated = false): BeeSource {
  const lines = ["Unrelated personal conversation.", `When a kit is borrowed, use the ${updated ? "orange" : "blue"} ledger.`, `When a poster is torn, use the ${updated ? "yellow" : "green"} tray.`];
  return beeSourceSchema.parse({ id, sourceKind: "bee", title: "Simulated Bee transport", startedAt: "2026-09-29T12:00:00.000Z", status: "processed", revision: `${id}-r1`, transcript: lines.join("\n"), utterances: lines.map((text, i) => ({ id: `${id}-${i}`, text, startMs: i * 1000, endMs: (i + 1) * 1000 })) });
}

describe("review workflow through the authenticated API", () => {
  it("supports a second Bee source, exact exclusions and separately confirmed proposals", async () => {
    const learnerId = randomUUID();
    const sources = [source("simulated-original"), source("simulated-update", true)];
    const repository = createMemoryRepository({ groundedExtraction: true });
    const server = buildApiServer({
      repository, sessionVerifier: { async verify() { return { learnerId, access: "all" }; } },
      beeGateway: { async health() { return { authenticated: true }; }, async listConversations() { return { items: sources.map(({ id, sourceKind, title, startedAt, status, revision }) => ({ id, sourceKind, title, startedAt, status, revision })), nextCursor: null }; }, async getConversation(input) { return { conversation: sources.find((s) => s.id === input.beeSourceId)! }; } },
      extractor: { async extract(input) {
        const extracted = extractSyntheticInstructions({ ...input, source: { ...input.source, sourceKind: "fixture" }, sourceConversationId: input.sourceConversation.id });
        if (input.source.id === "simulated-update") for (const rule of extracted.items) rule.supersedesId = input.previousConfirmedInstructions.find((old) => old.situation === rule.situation)!.id;
        return extracted;
      } }, scenarioEngine: { ...deterministicScenarioEngine, evaluateScenario(input) {
        // Explicit grading simulation for this fictional transport test.
        const rule = input.instructions.find((r) => input.scenario.expectedRuleIds.includes(r.id))!;
        const covered = input.responseText === rule.expectedAction;
        return { result: covered ? "covered" : "missed", feedback: "Simulated grading against the confirmed action.", matchedRuleIds: covered ? [rule.id] : [], missedRuleIds: covered ? [] : [rule.id], sourceEvidence: input.scenario.sourceEvidence };
      } }, clock: () => "2026-09-29T12:00:00.000Z", idFactory: randomUUID,
    });
    const client = createFirstDayApiClient({ baseUrl: "http://firstday.test", sessionToken: "test", async fetchImplementation(url, init) {
      const response = await server.inject({ method: init?.method as "GET" | "POST" | "PATCH", url: new URL(url).pathname + new URL(url).search, headers: init?.headers as Record<string, string>, ...(typeof init?.body === "string" ? { payload: init.body } : {}) });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
    } });
    try {
      const original = sources[0]!, update = sources[1]!;
      const imported = await client.importConversation({ beeSourceId: original.id, sourceKind: "bee", sourceRevision: original.revision, consent: { confirmed: true } });
      const extracted = await client.extractInstructions({ sourceConversationId: imported.sourceConversation.id, sourceRevision: original.revision, excludedRanges: [] });
      for (const item of extracted.items) await client.updateInstruction({ instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed" });
      const reviewed = await client.getConversation({ beeSourceId: update.id, sourceKind: "bee" });
      const checkpoint = {};
      const comparison = await compareTrainingUpdate(client, { previousSource: imported.sourceConversation, previousInstructionRevision: extracted.instructionRevision, update: reviewed.conversation, excludedRanges: [{ startMs: 0, endMs: 1000 }], consentConfirmed: true }, checkpoint);
      expect(comparison.changes).toHaveLength(2);
      expect(comparison.sourceEvidence.every((e) => e.startMs >= 1000)).toBe(true);
      for (const proposal of comparison.changes) {
        const result = await client.confirmChange({ changeId: proposal.id, sourceRevision: proposal.sourceRevision });
        expect(result.changeDrill.practiceSet.sourceKind).toBe("bee");
        expect(result.sourceEvidence.map((e) => e.sourceConversationId)).toContain(imported.sourceConversation.id);
        expect(result.previousInstruction.status).toBe("changed");
        expect(result.replacementInstruction.status).toBe("confirmed");
        expect(result.changeDrill.scenarios[0]!.criticalMisses).toContain(result.previousInstruction.expectedAction);
        const scenario = result.changeDrill.scenarios[0]!;
        const attempt = { scenarioId: scenario.id, sourceRevision: scenario.sourceRevision, instructionRevision: result.changeDrill.practiceSet.instructionRevision, inputMode: "text" as const };
        expect((await client.submitAttempt({ ...attempt, responseText: result.previousInstruction.expectedAction })).attempt.result).toBe("missed");
        expect((await client.submitAttempt({ ...attempt, responseText: result.replacementInstruction.expectedAction })).attempt.result).toBe("covered");
      }
      const session = await client.getSourceSession(imported.sourceConversation.id);
      expect(session.practices).toHaveLength(2);
      expect(session.changes.every((c) => c.status === "confirmed")).toBe(true);
      expect(session.extraction?.items.every((r) => r.status === "changed")).toBe(true);
      expect((await client.listSavedSources({ sourceKind: "bee", limit: 20 })).items).toHaveLength(2);
    } finally { await server.close(); }
  });
});
