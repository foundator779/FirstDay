import { describe, expect, it } from "vitest";
import { beeSourceSchema, beeUtteranceSchema, createSourceEvidenceId, sourceEvidenceSchema, excludedRangeSchema } from "./index.js";
const timestamp = 1780000000000;
const identity = { sourceConversationId: "00000000-0000-4000-8000-000000000001", sourceRevision: "reported-r1", startMs: timestamp, endMs: timestamp, timing: { basis: "reportedTimestamps" as const }, utteranceIds: ["a"] };
describe("reported timestamp contracts", () => {
  it("accepts only typed point utterances and selections with exact point identities", () => {
    expect(beeUtteranceSchema.safeParse({ id: "a", startMs: timestamp, endMs: timestamp, text: " Exact quote. ", timing: { basis: "reportedTimestamp", rawStart: 1, rawEnd: 1 } }).success).toBe(true);
    expect(excludedRangeSchema.safeParse({ startMs: timestamp, endMs: timestamp, timing: identity.timing, utteranceIds: ["a"] }).success).toBe(true);
    expect(sourceEvidenceSchema.safeParse({ ...identity, id: createSourceEvidenceId(identity), quote: " Exact quote. " }).success).toBe(true);
    expect(createSourceEvidenceId(identity)).not.toBe(createSourceEvidenceId({ ...identity, utteranceIds: ["b"] }));
    expect(createSourceEvidenceId({ ...identity, utteranceIds: ["a", "b"] })).not.toBe(createSourceEvidenceId({ ...identity, utteranceIds: ["b", "a"] }));
  });
  it("rejects counterfeit point durations, malformed metadata and untyped zero spans", () => {
    for (const value of [{ ...identity, timing: undefined }, { ...identity, utteranceIds: undefined }, { ...identity, utteranceIds: [] }, { ...identity, timing: { basis: "reportedTimestamps", invented: true } }]) expect(excludedRangeSchema.safeParse(value).success).toBe(false);
    expect(beeUtteranceSchema.safeParse({ id: "a", startMs: timestamp, endMs: timestamp + 1, text: "Quote", timing: { basis: "reportedTimestamp" } }).success).toBe(false);
    const duration = { ...identity, endMs: timestamp + 1 };
    expect(sourceEvidenceSchema.safeParse({ ...duration, id: createSourceEvidenceId(duration), quote: "Quote" }).success).toBe(false);
    expect(excludedRangeSchema.safeParse({ startMs: timestamp, endMs: timestamp + 1, timing: identity.timing, utteranceIds: ["a"] }).success).toBe(false);
    const u = { id: "a", startMs: timestamp, endMs: timestamp, text: "Quote", timing: { basis: "reportedTimestamp" } };
    expect(beeSourceSchema.safeParse({ id: "a", sourceKind: "bee", startedAt: new Date(timestamp).toISOString(), title: "Fictional", status: "processed", revision: "r1", utterances: [u, { id: "b", startMs: 0, endMs: 1, text: "Interval" }], transcript: "Quote\nInterval" }).success).toBe(false);
  });
});
