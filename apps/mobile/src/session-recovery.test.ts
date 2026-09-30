import { describe, expect, it } from "vitest";
import { createSyntheticFirstDayClient, SYNTHETIC_UPDATES } from "./synthetic-client";
import { restorePractice } from "./session-recovery";

async function training() {
  const client = createSyntheticFirstDayClient();
  const id = Object.keys(SYNTHETIC_UPDATES)[0]!;
  const source = (await client.getConversation({ beeSourceId: id, sourceKind: "fixture" })).conversation;
  const imported = (await client.importConversation({ beeSourceId: id, sourceKind: "fixture", sourceRevision: source.revision, consent: { confirmed: true } })).sourceConversation;
  const extraction = await client.extractInstructions({ sourceConversationId: imported.id, sourceRevision: source.revision, excludedRanges: [] });
  for (const item of extraction.items) await client.updateInstruction({ instructionId: item.id, sourceRevision: item.sourceRevision, status: "confirmed" });
  const practice = await client.createPractice({ sourceConversationId: imported.id, sourceRevision: source.revision, instructionIds: extraction.items.map((r) => r.id), title: "Restore check" });
  return { client, imported, extraction, practice };
}
describe("learner session recovery", () => {
  it("restores failed feedback, then advances to the next uncovered situation", async () => {
    const { client, imported, practice } = await training();
    const scenario = practice.scenarios[0]!;
    const input = { scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, inputMode: "text" as const };
    await client.submitAttempt({ ...input, responseText: "skip" });
    const recovered = restorePractice(await client.getSourceSession(imported.id));
    expect(recovered?.index).toBe(0);
    expect(recovered?.feedback?.attempt.responseText).toBe("skip");
    expect(recovered?.feedback?.attempt.result).toBe("missed");
    await client.submitAttempt({ ...input, responseText: scenario.acceptableSignals[0]! });
    expect(restorePractice(await client.getSourceSession(imported.id))).toMatchObject({ index: 1, feedback: null, showRecap: false });
  });
  it("restores completed and stale history without reopening its composer", async () => {
    const { client, imported, practice } = await training();
    for (const scenario of practice.scenarios) await client.submitAttempt({ scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, inputMode: "text", responseText: scenario.acceptableSignals[0]! });
    const session = await client.getSourceSession(imported.id);
    expect(restorePractice(session)).toMatchObject({ showRecap: true, feedback: null, stale: false });
    session.practices[0]!.practice.practiceSet.status = "stale";
    expect(restorePractice(session)).toMatchObject({ showRecap: true, feedback: null, stale: true });
    session.practices = [];
    expect(restorePractice(session)).toBeNull();
  });
  it("keeps earlier covered progress when retry history exceeds 500 attempts", async () => {
    const { client, imported, practice } = await training();
    const scenario = practice.scenarios[0]!;
    const covered = await client.submitAttempt({ scenarioId: scenario.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, inputMode: "text", responseText: scenario.acceptableSignals[0]! });
    const session = await client.getSourceSession(imported.id);
    const next = practice.scenarios[1]!;
    session.practices[0]!.attempts.push(...Array.from({ length: 501 }, (_, index) => ({ ...covered.attempt, id: `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`, scenarioId: next.id, responseText: "skip", result: "missed" as const, matchedRuleIds: [], missedRuleIds: next.expectedRuleIds, sourceEvidence: next.sourceEvidence })));
    expect(restorePractice(session)).toMatchObject({ index: 1, feedback: { attempt: { result: "missed" } } });
    expect(restorePractice(session)?.attempts).toHaveLength(502);
  });
});
