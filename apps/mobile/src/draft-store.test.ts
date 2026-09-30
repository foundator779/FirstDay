import { describe, expect, it } from "vitest";
import { createDraftStore, type DraftContext } from "./draft-store";

const context: DraftContext = { learnerId: "70000000-0000-4000-8000-000000000001", sourceConversationId: "90000000-0000-4000-8000-000000000001", practiceSetId: "90000000-0000-4000-8000-000000000002", scenarioId: "90000000-0000-4000-8000-000000000003", sourceRevision: "source-1", instructionRevision: "instructions-1" };
function storage() {
  const values = new Map<number, string>();
  return { values, slots: { async read(slot: 0 | 1) { return values.get(slot) ?? null; }, async write(slot: 0 | 1, value: string) { values.set(slot, value); }, async remove(slot: 0 | 1) { values.delete(slot); } } };
}
describe("local answer drafts", () => {
  it("restores typed and spoken drafts after store restart with exact learner and revision matching", async () => {
    const { slots, values } = storage();
    await createDraftStore(slots).save(context, "I will ask about the existing reservation.", "voice");
    const restarted = createDraftStore(slots);
    expect(await restarted.load(context)).toMatchObject({ text: "I will ask about the existing reservation.", inputMode: "voice" });
    expect(await restarted.load({ ...context, learnerId: "70000000-0000-4000-8000-000000000002" })).toBeNull();
    expect(await restarted.load({ ...context, instructionRevision: "instructions-2" })).toBeNull();
    expect([...values.values()].join()).not.toContain("authorization");
  });
  it("keeps the previous verified generation after an interrupted write", async () => {
    const { slots, values } = storage();
    const store = createDraftStore(slots);
    await store.save(context, "First draft", "text");
    await store.save(context, "Second draft", "text");
    values.set(1, '{"partial":');
    expect((await createDraftStore(slots).load(context))?.text).toBe("First draft");
  });
  it("serializes writes and clears both generations on sign-out/reset", async () => {
    const { slots, values } = storage();
    const store = createDraftStore(slots);
    await Promise.all([store.save(context, "One", "text"), store.save(context, "Two", "voice")]);
    expect((await store.load(context))?.text).toBe("Two");
    await store.clearOwner(context.learnerId);
    expect(await createDraftStore(slots).load(context)).toBeNull();
    expect([...values.values()].join()).not.toContain('"Two"');
    await store.save(context, "Submitted draft", "text");
    await store.save(context, "", "text");
    expect([...values.values()].join()).not.toContain("Submitted draft");
    await store.clearAll(); expect(values.size).toBe(0);
  });
  it("reports corruption and write failures without discarding the valid draft", async () => {
    const { slots, values } = storage();
    await createDraftStore(slots).save(context, "Retained", "text");
    const failing = createDraftStore({ ...slots, async write() { throw new Error("Disk full"); } });
    await expect(failing.save(context, "New text", "text")).rejects.toThrow("Disk full");
    expect((await createDraftStore(slots).load(context))?.text).toBe("Retained");
    values.set(0, "invalid");
    await expect(createDraftStore(slots).load(context)).rejects.toThrow("damaged");
  });
});

describe("understanding explanation drafts",()=>{
  it("restores an explanation only for its exact source/instruction/revision/phase and clears it with owner drafts",async()=>{
    const {slots,values}=storage(),store=createDraftStore(slots);
    const explanation={kind:"understanding" as const,learnerId:context.learnerId,sourceConversationId:context.sourceConversationId,instructionId:context.scenarioId,sourceRevision:context.sourceRevision,instructionRevision:context.instructionRevision,phase:"explanation" as const};
    await store.save(explanation,"I would cancel this reservation.","voice");
    expect((await createDraftStore(slots).load(explanation))?.text).toBe("I would cancel this reservation.");
    expect(await store.load({...explanation,phase:"rehearsal"})).toBeNull();
    expect(await store.load({...explanation,instructionRevision:"different"})).toBeNull();
    await store.clearOwner(explanation.learnerId);expect([...values.values()].join()).not.toContain("cancel this reservation");
  });
});
