import { describe, expect, it, vi } from "vitest";
import { createSyntheticFirstDayClient, SYNTHETIC_UPDATES } from "./synthetic-client";
import { FirstDayClientError } from "./api";
import { revokeConfirmedSource } from "./source-permission-workflow";

async function training() {
  const client = createSyntheticFirstDayClient();
  const id = Object.keys(SYNTHETIC_UPDATES)[0]!;
  const source = (await client.getConversation({ beeSourceId: id, sourceKind: "fixture" })).conversation;
  const imported = (await client.importConversation({ beeSourceId: id, sourceKind: "fixture", sourceRevision: source.revision, consent: { confirmed: true } })).sourceConversation;
  const extraction = await client.extractInstructions({ sourceConversationId: imported.id, sourceRevision: imported.sourceRevision, excludedRanges: [] });
  for (const rule of extraction.items) await client.updateInstruction({ instructionId: rule.id, sourceRevision: rule.sourceRevision, status: "confirmed" });
  const practice = await client.createPractice({ sourceConversationId: imported.id, sourceRevision: imported.sourceRevision, instructionIds: extraction.items.map((r) => r.id), title: "Permission test" });
  return { client, imported, practice, extraction };
}
describe("source permission recovery", () => {
  it("revokes access, hides the saved source and blocks dependent grading", async () => {
    const { client, imported, practice } = await training();
    await revokeConfirmedSource(client, imported);
    expect((await client.listSavedSources({ sourceKind: "fixture" })).items).toEqual([]);
    await expect(client.getSourceSession(imported.id)).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
    await expect(client.submitAttempt({ scenarioId: practice.scenarios[0]!.id, sourceRevision: practice.practiceSet.sourceRevision, instructionRevision: practice.practiceSet.instructionRevision, inputMode: "text", responseText: "skip" })).rejects.toMatchObject({ code: "STALE_PRACTICE_SET" });
  });
  it("recovers a committed revocation when its response was lost", async () => {
    const { client, imported } = await training();
    const actual = client.revokeConsent.bind(client);
    const spy = vi.spyOn(client, "revokeConsent").mockImplementation(async (input) => { await actual(input); throw new FirstDayClientError("NETWORK_ERROR", "Response lost"); });
    await expect(revokeConfirmedSource(client, imported)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge a failure before the transaction committed", async () => {
    const { client, imported } = await training();
    vi.spyOn(client, "revokeConsent").mockRejectedValue(new FirstDayClientError("NETWORK_ERROR", "Connection lost"));
    await expect(revokeConfirmedSource(client, imported)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect((await client.getSourceSession(imported.id)).sourceConversation.consentStatus).toBe("confirmed");
  });
  it("rejects a permission response for another source", async () => {
    const { client, imported } = await training();
    vi.spyOn(client, "revokeConsent").mockResolvedValue({ sourceConversation: { ...imported, id: "90000000-0000-4000-8000-000000000099", consentStatus: "revoked", consentRevokedAt: imported.updatedAt }, stalePracticeSetIds: [] });
    await expect(revokeConfirmedSource(client, imported)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
