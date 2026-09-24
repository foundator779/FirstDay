import { describe, expect, it } from "vitest";
import { beeSourceSchema, createTranscriptHash, type BeeSource } from "@firstday/contracts";
import { createSyntheticFirstDayClient, SYNTHETIC_UPDATES, type PracticeClient } from "./synthetic-client.js";

async function review(client: PracticeClient, sourceId: string) {
  const { conversation } = await client.getConversation({ beeSourceId: sourceId, sourceKind: "fixture" });
  const { sourceConversation } = await client.importConversation({ beeSourceId: sourceId, sourceKind: "fixture", sourceRevision: conversation.revision, consent: { confirmed: true } });
  const extraction = await client.extractInstructions({ sourceConversationId: sourceConversation.id, sourceRevision: sourceConversation.sourceRevision, excludedRanges: [] });
  return { conversation, sourceConversation, extraction };
}

async function start(client: PracticeClient, sourceId: string) {
  const training = await review(client, sourceId);
  for (const item of training.extraction.items) {
    await client.updateInstruction({ instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed" });
  }
  const practice = await client.createPractice({ sourceConversationId: training.sourceConversation.id, sourceRevision: training.sourceConversation.sourceRevision, instructionIds: training.extraction.items.map((item) => item.id), title: "Synthetic training" });
  return { ...training, practice };
}

describe("complete synthetic development loop", () => {
  it.each(["text", "voice"] as const)("preserves %s provenance and source-backed grading", async (inputMode) => {
    const client = createSyntheticFirstDayClient();
    const training = await start(client, "fixture-library-onboarding");
    const scenario = training.practice.scenarios[0]!;
    const rule = training.extraction.items.find((item) => item.id === scenario.expectedRuleIds[0])!;
    const response = await client.submitAttempt({ scenarioId: scenario.id, sourceRevision: training.practice.practiceSet.sourceRevision, instructionRevision: training.practice.practiceSet.instructionRevision, responseText: rule.expectedAction, inputMode });
    expect(response.attempt.inputMode).toBe(inputMode);
    expect(response.attempt.result).toBe("covered");
    expect(response.sourceEvidence.map((item) => item.id)).toEqual(scenario.sourceEvidence);
  });
  it.each(Object.keys(SYNTHETIC_UPDATES))("imports, reviews, retries, completes and changes %s", async (sourceId) => {
    const client = createSyntheticFirstDayClient();
    const training = await start(client, sourceId);
    const set = training.practice.practiceSet;
    expect(set.sourceKind).toBe("fixture");
    expect(training.sourceConversation.transcriptHash).toBe(createTranscriptHash(training.conversation.transcript));
    for (const [index, scenario] of training.practice.scenarios.entries()) {
      const input = { scenarioId: scenario.id, sourceRevision: set.sourceRevision, instructionRevision: set.instructionRevision, inputMode: "text" as const };
      const failed = await client.submitAttempt({ ...input, responseText: "I don't know" });
      expect(failed.nextAction).toBe("retry");
      expect(failed.attempt.result).toBe("missed");
      const rule = training.extraction.items.find((item) => item.id === scenario.expectedRuleIds[0])!;
      const passed = await client.submitAttempt({ ...input, responseText: `I will ${rule.expectedAction}` });
      expect(passed.attempt.result).toBe("covered");
      expect(passed.nextAction).toBe(index === 2 ? "complete" : "continue");
      expect(passed.sourceEvidence.map((item) => item.id)).toEqual(scenario.sourceEvidence);
    }
    expect((await client.getPractice(set.id)).progress).toEqual({ completed: 3, total: 3 });
    const update = await review(client, SYNTHETIC_UPDATES[sourceId]!);
    await expect(client.updateInstruction({ instructionId: update.extraction.items[0]!.id, sourceRevision: update.extraction.sourceRevision, status: "confirmed" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const comparison = await client.compareSources({ sourceConversationId: training.sourceConversation.id, newSourceConversationId: update.sourceConversation.id, previousInstructionRevision: training.extraction.instructionRevision });
    expect(comparison.changes).toHaveLength(1);
    const change = comparison.changes[0]!;
    const confirmed = await client.confirmChange({ changeId: change.id, sourceRevision: change.sourceRevision });
    expect(confirmed.stalePracticeSetIds).toContain(set.id);
    expect((await client.getPractice(set.id)).practiceSet.status).toBe("stale");
    expect(confirmed.sourceEvidence).toHaveLength(2);
    const drill = confirmed.changeDrill;
    await expect(client.submitAttempt({ scenarioId: set.scenarioIds[0]!, sourceRevision: set.sourceRevision, instructionRevision: set.instructionRevision, responseText: "old action", inputMode: "text" })).rejects.toMatchObject({ code: "STALE_PRACTICE_SET" });
    const drillInput = { scenarioId: drill.scenarios[0]!.id, sourceRevision: drill.practiceSet.sourceRevision, instructionRevision: drill.practiceSet.instructionRevision, inputMode: "text" as const };
    expect((await client.submitAttempt({ ...drillInput, responseText: confirmed.previousInstruction.expectedAction })).attempt.result).not.toBe("covered");
    const completed = await client.submitAttempt({ ...drillInput, responseText: confirmed.replacementInstruction.expectedAction });
    expect(completed.nextAction).toBe("complete");
    expect((await client.getPractice(drill.practiceSet.id)).progress.completed).toBe(1);
    expect(completed.instructions.map((item) => item.status)).toEqual(["changed", "confirmed"]);
    await expect(client.confirmChange({ changeId: change.id, sourceRevision: change.sourceRevision })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("uses unfamiliar transcript content, IDs, wording and values instead of memorized fixtures", async () => {
    for (const color of ["purple", "teal", "silver"]) {
      const lines = [`Whenever a guest returns a card, put it in the ${color} tray.`, "If a guest needs a pencil, ask for the desk number.", "When a guest collects a booklet, check the receipt code."];
      const source: BeeSource = beeSourceSchema.parse({ id: `fixture-unseen-${color}`, sourceKind: "fixture", title: "Unseen synthetic training", revision: `unseen-${color}`, startedAt: "2026-09-14T16:00:00.000Z", status: "processed", transcript: lines.join("\n"), utterances: lines.map((text, index) => ({ id: `utterance-${index}`, text, startMs: index * 1000, endMs: (index + 1) * 1000 })) });
      const client = createSyntheticFirstDayClient({ sources: [source], updates: {} });
      const training = await start(client, source.id);
      expect(training.extraction.items[0]!.expectedAction).toBe(`put it in the ${color} tray`);
      const set = training.practice.practiceSet;
      const input = { scenarioId: set.scenarioIds[0]!, sourceRevision: set.sourceRevision, instructionRevision: set.instructionRevision, inputMode: "text" as const };
      expect((await client.submitAttempt({ ...input, responseText: "put it in the blue tray" })).attempt.result).not.toBe("covered");
      expect((await client.submitAttempt({ ...input, responseText: `do not put it in the ${color} tray` })).attempt.result).not.toBe("covered");
      expect((await client.submitAttempt({ ...input, responseText: `Put it in the ${color} tray.` })).attempt.result).toBe("covered");
    }
  });

  it("excludes source spans, turns uncertain statements into questions, and gates practice on confirmation", async () => {
    const client = createSyntheticFirstDayClient();
    const { conversation } = await client.getConversation({ sourceKind: "fixture", beeSourceId: "fixture-library-onboarding" });
    const { sourceConversation } = await client.importConversation({ beeSourceId: conversation.id, sourceKind: "fixture", sourceRevision: conversation.revision, consent: { confirmed: true } });
    const extraction = await client.extractInstructions({ sourceConversationId: sourceConversation.id, sourceRevision: conversation.revision, excludedRanges: [{ startMs: 8000, endMs: 16000 }] });
    expect(extraction.items).toHaveLength(2);
    expect(extraction.openQuestions).toHaveLength(1);
    expect(extraction.openQuestions[0]!.shareConsent).toBe(false);
    expect(extraction.sourceEvidence.some((item) => item.quote.includes("blue ledger"))).toBe(false);
    await expect(client.createPractice({ sourceConversationId: sourceConversation.id, sourceRevision: conversation.revision, instructionIds: extraction.items.map((item) => item.id), title: "Too few confirmed cards" })).rejects.toBeDefined();
  });

  it("keeps fixture/live provenance separate and prevents callers from mutating stored state", async () => {
    const client = createSyntheticFirstDayClient();
    expect((await client.health()).beeBridge).toBe("unavailable");
    await expect(client.listConversations({ sourceKind: "bee" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const training = await start(client, "fixture-library-onboarding");
    training.practice.practiceSet.status = "complete";
    expect((await client.getPractice(training.practice.practiceSet.id)).practiceSet.status).toBe("ready");
    await expect(client.compareSources({ sourceConversationId: training.sourceConversation.id, newSourceConversationId: training.sourceConversation.id, previousInstructionRevision: training.extraction.instructionRevision })).rejects.toBeDefined();
  });
});
