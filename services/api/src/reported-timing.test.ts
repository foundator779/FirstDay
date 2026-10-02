import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beeSourceSchema, createSourceEvidenceId, type SourceEvidence } from "@firstday/contracts";
import { extractSyntheticInstructions } from "@firstday/scenario-engine";
import library from "../../../fixtures/transcripts/library-onboarding.json" with { type: "json" };
import { createMemoryRepository } from "./memory-repository.js";

const timestamp = "2026-09-29T12:00:00.000Z";
const original = beeSourceSchema.parse(library);
const points = original.utterances.map((u, i) => ({ ...u, id: `p-${i}`, startMs: 1780000000000, endMs: 1780000000000, timing: { basis: "reportedTimestamp" as const } }));
const source = beeSourceSchema.parse({ ...original, revision: "fictional-points-r1", utterances: points });
describe("reported source repository boundary", () => {
  it("rejects forged point selection, bounds, quote, speaker and exclusions before accepting exact evidence", async () => {
    const learnerId = randomUUID(), sourceConversationId = randomUUID();
    const repository = createMemoryRepository({ groundedExtraction: true });
    await repository.importSource({ learnerId, sourceConversationId, source, timestamp });
    const extraction = extractSyntheticInstructions({ source, sourceConversationId, excludedRanges: [], timestamp, idFactory: randomUUID });
    const input = { learnerId, sourceConversationId, sourceRevision: source.revision, excludedRanges: [], extraction, allocation: { recordIds: [...extraction.items, ...extraction.openQuestions].map(r => r.id), timestamp } };
    const initial = extraction.sourceEvidence[0]!;
    for (const edit of [{ quote: initial.quote.trim() + " fabricated" }, { speakerLabel: "counterfeit" }, { utteranceIds: [points[0]!.id] }, { endMs: initial.endMs + 1 }, { startMs: initial.startMs + 1, endMs: initial.endMs + 2, timing: undefined }]) {
      const forged: SourceEvidence = { ...initial, ...edit };
      forged.id = createSourceEvidenceId(forged);
      const changed = structuredClone(extraction);
      changed.sourceEvidence[0] = forged;
      for (const item of [...changed.items, ...changed.openQuestions]) item.sourceEvidence = item.sourceEvidence.map(id => id === initial.id ? forged.id : id);
      await expect(repository.saveExtraction({ ...input, extraction: changed })).rejects.toThrow();
    }
    for (const excludedRanges of [
      [{ startMs: 0, endMs: 1 }],
      [{ startMs: points[0]!.startMs, endMs: points[0]!.endMs, timing: { basis: "reportedTimestamps" as const }, utteranceIds: ["counterfeit"] }],
      [{ startMs: points[0]!.startMs, endMs: points[0]!.endMs + 1, timing: { basis: "reportedTimestamps" as const }, utteranceIds: [points[0]!.id] }],
      [{ startMs: points[0]!.startMs, endMs: points[0]!.endMs, timing: { basis: "reportedTimestamps" as const }, utteranceIds: [initial.utteranceIds[0]!] }],
    ]) await expect(repository.saveExtraction({ ...input, excludedRanges })).rejects.toThrow();
    const saved = await repository.saveExtraction(input);
    expect(saved.sourceEvidence).toEqual(extraction.sourceEvidence);
  });
});
