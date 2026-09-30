import { describe, expect, it, vi } from "vitest";
import type { BeeSource, InstructionCard } from "@firstday/contracts";
import library from "../../../fixtures/transcripts/library-onboarding.json";
import update from "../../../fixtures/transcripts/library-policy-update.json";
import { createSyntheticFirstDayClient } from "./synthetic-client";
import { compareTrainingUpdate, practiceSelection, rehearsedInstructions, updateCandidates, type UpdateCheckpoint } from "./practice-workflow";

async function training() {
  const client = createSyntheticFirstDayClient();
  const { sourceConversation: source } = await client.importConversation({ beeSourceId: library.id, sourceKind: "fixture", sourceRevision: library.revision, consent: { confirmed: true } });
  const extraction = await client.extractInstructions({ sourceConversationId: source.id, sourceRevision: source.sourceRevision, excludedRanges: [] });
  for (const rule of extraction.items) await client.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" });
  return { client, source, extraction, rules: extraction.items.map((rule) => ({ ...rule, status: "confirmed" as const })) };
}

describe("supported practice selection", () => {
  it("requires three confirmed rules and explains the remaining number", async () => {
    const { rules } = await training();
    expect(practiceSelection([], null)).toMatchObject({ ready: false, remaining: 3 });
    expect(practiceSelection(rules.slice(0, 2), null)).toMatchObject({ ready: false, remaining: 1 });
    expect(practiceSelection(rules, null)).toMatchObject({ ready: true, ids: rules.map((r) => r.id) });
  });

  it("requires an explicit selection when more than three are confirmed and excludes unconfirmed IDs", async () => {
    const { rules } = await training();
    const fourth: InstructionCard = { ...rules[0]!, id: "90000000-0000-4000-8000-000000000050" };
    expect(practiceSelection([...rules, fourth], null).ready).toBe(false);
    expect(practiceSelection([...rules, fourth], [rules[0]!.id, rules[1]!.id, fourth.id]).ready).toBe(true);
    expect(practiceSelection([...rules, { ...fourth, status: "rejected" }], [rules[0]!.id, rules[1]!.id, fourth.id])).toMatchObject({ ready: false, remaining: 1 });
    expect(practiceSelection(rules, [rules[0]!.id, rules[0]!.id, rules[1]!.id]).ready).toBe(false);
  });

  it("recaps only the instructions referenced by generated scenarios", async () => {
    const { rules } = await training();
    expect(rehearsedInstructions(rules, [{ expectedRuleIds: [rules[1]!.id] }])).toEqual([rules[1]]);
  });
});

describe("second conversation review", () => {
  it("keeps only distinct processed candidates of the current source kind", () => {
    const candidates = [
      { id: "original", sourceKind: "bee", status: "processed" },
      { id: "update", sourceKind: "bee", status: "processed" },
      { id: "pending", sourceKind: "bee", status: "processing" },
      { id: "fixture", sourceKind: "fixture", status: "processed" },
    ] as const;
    expect(updateCandidates(candidates, { beeSourceId: "original", sourceKind: "bee" })).toEqual([candidates[1]]);
  });

  it("does not import without explicit consent, an included passage and matching provenance", async () => {
    const { client, source, extraction } = await training();
    const importSpy = vi.spyOn(client, "importConversation");
    const input = { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: update as BeeSource, excludedRanges: [], consentConfirmed: false };
    await expect(compareTrainingUpdate(client, input, {})).rejects.toThrow("permission");
    await expect(compareTrainingUpdate(client, { ...input, consentConfirmed: true, excludedRanges: update.utterances.map(({ startMs, endMs }) => ({ startMs, endMs })) }, {})).rejects.toThrow("passage");
    await expect(compareTrainingUpdate(client, { ...input, consentConfirmed: true, update: { ...update, sourceKind: "bee" } as BeeSource }, {})).rejects.toThrow("different");
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("retains successful import and extraction when comparison fails, then retries without repeating them", async () => {
    const { client, source, extraction } = await training();
    const checkpoint: UpdateCheckpoint = {};
    const getSource = await client.getConversation({ beeSourceId: update.id, sourceKind: "fixture" });
    const input = { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: getSource.conversation, consentConfirmed: true, excludedRanges: [] };
    const importSpy = vi.spyOn(client, "importConversation");
    const extractSpy = vi.spyOn(client, "extractInstructions");
    vi.spyOn(client, "compareSources").mockRejectedValueOnce(new Error("connection lost"));
    await expect(compareTrainingUpdate(client, input, checkpoint)).rejects.toThrow("connection lost");
    expect(checkpoint.extracted).toBe(true);
    const comparison = await compareTrainingUpdate(client, input, checkpoint);
    expect(comparison.changes).toHaveLength(1);
    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it("validates exclusions before importing a conversation", async () => {
    const { client, source, extraction } = await training();
    const importSpy = vi.spyOn(client, "importConversation");
    await expect(compareTrainingUpdate(client, { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: update as BeeSource, consentConfirmed: true, excludedRanges: [{ startMs: 4, endMs: 2 }] }, {})).rejects.toThrow();
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("recovers a persisted extraction and pending proposal with a fresh checkpoint", async () => {
    const { client, source, extraction } = await training();
    const input = { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: update as BeeSource, consentConfirmed: true, excludedRanges: [] };
    const initial = await compareTrainingUpdate(client, input, {});
    const extractSpy = vi.spyOn(client, "extractInstructions");
    const comparisonSpy = vi.spyOn(client, "compareSources");
    const resumed = await compareTrainingUpdate(client, input, {});
    expect(resumed).toEqual(initial);
    expect(extractSpy).not.toHaveBeenCalled();
    expect(comparisonSpy).not.toHaveBeenCalled();
  });

  it("restores the committed exclusions before a resumed comparison", async () => {
    const { client, source, extraction } = await training();
    const input = { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: update as BeeSource, consentConfirmed: true, excludedRanges: [] };
    await compareTrainingUpdate(client, input, {});
    const checkpoint: UpdateCheckpoint = {};
    await expect(compareTrainingUpdate(client, { ...input, excludedRanges: [{ startMs: 0, endMs: 1 }] }, checkpoint)).rejects.toThrow("saved review");
    expect(checkpoint.excludedRanges).toEqual([]);
  });

  it("passes exact exclusions to extraction and refuses to reuse a checkpoint for different review choices", async () => {
    const { client, source, extraction } = await training();
    const checkpoint: UpdateCheckpoint = {};
    const input = { previousSource: source, previousInstructionRevision: extraction.instructionRevision, update: update as BeeSource, consentConfirmed: true, excludedRanges: [] };
    const extractSpy = vi.spyOn(client, "extractInstructions");
    await compareTrainingUpdate(client, input, checkpoint);
    expect(extractSpy.mock.calls[0]?.[0].excludedRanges).toEqual([]);
    await expect(compareTrainingUpdate(client, { ...input, excludedRanges: [{ startMs: 0, endMs: 1 }] }, checkpoint)).rejects.toThrow("review changed");
  });
});
