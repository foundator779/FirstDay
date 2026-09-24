import { describe, expect, it } from "vitest";

import { createFixtureFirstDayClient } from "./fixture-client.js";

describe("public demo fixture client", () => {
  it("exposes only compact processed summaries from the checked-in bookshop fixtures", async () => {
    const client = createFixtureFirstDayClient();

    await expect(client.health()).resolves.toMatchObject({
      ok: true,
      beeBridge: "authenticated",
    });
    const result = await client.listConversations({ sourceKind: "fixture" });

    expect(result.nextCursor).toBeNull();
    expect(result.items.map(({ id }) => id)).toEqual([
      "fixture-bookshop-policy-update",
      "fixture-bookshop-onboarding",
    ]);
    expect(result.items.every(({ status, revision }) => status === "processed" && revision)).toBe(true);
    expect(result.items[0]).not.toHaveProperty("transcript");
    expect(result.items[0]).not.toHaveProperty("utterances");
  });

  it("filters fixture summaries without pretending to be a live Bee source", async () => {
    const client = createFixtureFirstDayClient();

    await expect(
      client.listConversations({ sourceKind: "fixture", query: "policy update" }),
    ).resolves.toMatchObject({
      items: [{ id: "fixture-bookshop-policy-update", sourceKind: "fixture" }],
    });
    await expect(client.listConversations({ sourceKind: "bee" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("runs the consented source-to-review flow against immutable checked-in evidence", async () => {
    const client = createFixtureFirstDayClient();
    const { conversation } = await client.getConversation({
      beeSourceId: "fixture-bookshop-onboarding",
      sourceKind: "fixture",
    });

    expect(conversation.transcript).toContain("five calendar days");
    await expect(
      client.importConversation({
        beeSourceId: conversation.id,
        sourceKind: "fixture",
        sourceRevision: conversation.revision,
      } as never),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });

    const { sourceConversation } = await client.importConversation({
      beeSourceId: conversation.id,
      sourceKind: "fixture",
      sourceRevision: conversation.revision,
      consent: { confirmed: true },
    });
    const extraction = await client.extractInstructions({
      sourceConversationId: sourceConversation.id,
      sourceRevision: sourceConversation.sourceRevision,
      excludedRanges: [{ startMs: 10_800, endMs: 17_400, reason: "Not part of my training" }],
    });

    expect(extraction.items).toHaveLength(2);
    expect(extraction.sourceEvidence.map(({ quote }) => quote)).toContain(
      "Before you hand over a reserved book, ask for both the reservation name and the phone number on the reservation.",
    );
    expect(extraction.sourceEvidence.map(({ startMs }) => startMs)).not.toContain(10_800);
  });

  it("supports confirm, edit-and-confirm, reject, and a grounded open question", async () => {
    const client = createFixtureFirstDayClient();
    const { conversation } = await client.getConversation({
      beeSourceId: "fixture-bookshop-onboarding",
      sourceKind: "fixture",
    });
    const { sourceConversation } = await client.importConversation({
      beeSourceId: conversation.id,
      sourceKind: "fixture",
      sourceRevision: conversation.revision,
      consent: { confirmed: true },
    });
    const extraction = await client.extractInstructions({
      sourceConversationId: sourceConversation.id,
      sourceRevision: sourceConversation.sourceRevision,
      excludedRanges: [],
    });
    const [first, second, third] = extraction.items;
    expect(first && second && third).toBeTruthy();

    await expect(
      client.updateInstruction({
        instructionId: first!.id,
        sourceRevision: extraction.sourceRevision,
        status: "confirmed",
      }),
    ).resolves.toMatchObject({ instruction: { status: "confirmed" } });
    await expect(
      client.updateInstruction({
        instructionId: second!.id,
        sourceRevision: extraction.sourceRevision,
        text: "Check both the reservation name and phone number before handover.",
        expectedAction: "Ask for both details before handing over the reserved book.",
        status: "confirmed",
      }),
    ).resolves.toMatchObject({
      instruction: {
        text: "Check both the reservation name and phone number before handover.",
        status: "confirmed",
      },
    });
    await expect(
      client.updateInstruction({
        instructionId: third!.id,
        sourceRevision: extraction.sourceRevision,
        status: "rejected",
      }),
    ).resolves.toMatchObject({ instruction: { status: "rejected" } });
    await expect(
      client.updateInstruction({
        instructionId: first!.id,
        sourceRevision: extraction.sourceRevision,
        status: "rejected",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    await expect(
      client.createOpenQuestion({
        sourceConversationId: extraction.sourceConversationId,
        sourceRevision: extraction.sourceRevision,
        instructionId: second!.id,
        question: "Should I use another detail if the phone number has changed?",
        sourceEvidence: second!.sourceEvidence,
        shareConsent: false,
      }),
    ).resolves.toMatchObject({
      openQuestion: {
        status: "open",
        shareConsent: false,
        sourceEvidence: second!.sourceEvidence,
      },
    });
  });
});
