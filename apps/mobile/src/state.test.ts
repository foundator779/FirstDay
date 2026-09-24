import {
  beeSourceSchema,
  createOpenQuestionResponseSchema,
  extractInstructionsResponseSchema,
  importConversationResponseSchema,
  type BeeConversationSummary,
  type HealthResponse,
} from "@firstday/contracts";
import { describe, expect, it } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};

import {
  initialFirstDayState,
  isConversationSelectable,
  reduceFirstDayState,
} from "./state.js";
import { isUtteranceExcluded } from "./review-evidence.js";

const AUTHENTICATED_HEALTH: HealthResponse = {
  ok: true,
  service: "firstday-api",
  version: "0.2.0",
  beeBridge: "authenticated",
};
const SOURCE = beeSourceSchema.parse(onboardingJson);
const EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const IMPORT = importConversationResponseSchema.parse({
  sourceConversation: {
    id: EXTRACTION.sourceConversationId,
    learnerId: "70000000-0000-4000-8000-000000000001",
    beeSourceId: SOURCE.id,
    sourceKind: SOURCE.sourceKind,
    title: SOURCE.title,
    startedAt: SOURCE.startedAt,
    endedAt: SOURCE.endedAt,
    transcriptHash: "a".repeat(64),
    sourceRevision: SOURCE.revision,
    consentStatus: "confirmed",
    consentConfirmedAt: "2026-09-10T16:00:59.000Z",
    status: "ready",
    importedAt: "2026-09-10T16:00:59.000Z",
    updatedAt: "2026-09-10T16:00:59.000Z",
  },
});

function conversation(
  overrides: Partial<BeeConversationSummary> = {},
): BeeConversationSummary {
  return {
    id: "bee-bookshop-onboarding",
    sourceKind: "bee",
    title: "Bookshop onboarding",
    startedAt: "2026-09-10T16:00:00.000Z",
    endedAt: "2026-09-10T16:32:00.000Z",
    durationMs: 1_920_000,
    status: "processed",
    revision: "bee-bookshop-onboarding-r1",
    ...overrides,
  };
}

describe("FirstDay conversation picker state", () => {
  it("moves from checking to an authenticated, selectable conversation list", () => {
    const loading = reduceFirstDayState(initialFirstDayState, {
      type: "picker/loadStarted",
      sourceKind: "bee",
    });
    const ready = reduceFirstDayState(loading, {
      type: "picker/loadSucceeded",
      health: AUTHENTICATED_HEALTH,
      conversations: [conversation()],
    });
    const selected = reduceFirstDayState(ready, {
      type: "picker/conversationSelected",
      conversationId: "bee-bookshop-onboarding",
    });

    expect(ready.picker).toMatchObject({
      phase: "ready",
      sourceKind: "bee",
      bridgeStatus: "authenticated",
    });
    expect(selected.picker.selectedConversationId).toBe("bee-bookshop-onboarding");
  });

  it("presents an intentional empty state when Bee has no processed conversations", () => {
    const state = reduceFirstDayState(
      reduceFirstDayState(initialFirstDayState, {
        type: "picker/loadStarted",
        sourceKind: "bee",
      }),
      {
        type: "picker/loadSucceeded",
        health: AUTHENTICATED_HEALTH,
        conversations: [],
      },
    );

    expect(state.picker).toMatchObject({
      phase: "empty",
      bridgeStatus: "authenticated",
      conversations: [],
      selectedConversationId: null,
    });
  });

  it.each(["unauthenticated", "unavailable"] as const)(
    "keeps the picker usable when the Bee bridge is %s",
    (bridgeStatus) => {
      const state = reduceFirstDayState(
        reduceFirstDayState(initialFirstDayState, {
          type: "picker/loadStarted",
          sourceKind: "bee",
        }),
        {
          type: "picker/loadSucceeded",
          health: { ...AUTHENTICATED_HEALTH, beeBridge: bridgeStatus },
          conversations: [],
        },
      );

      expect(state.picker).toMatchObject({
        phase: "unavailable",
        bridgeStatus,
        selectedConversationId: null,
      });
    },
  );

  it("maps transport failures to the unavailable state without retaining a stale selection", () => {
    const state = reduceFirstDayState(
      {
        ...initialFirstDayState,
        picker: {
          ...initialFirstDayState.picker,
          phase: "ready",
          selectedConversationId: "old-source",
        },
      },
      {
        type: "picker/loadFailed",
        message: "FirstDay could not reach the local API.",
      },
    );

    expect(state.picker).toMatchObject({
      phase: "unavailable",
      selectedConversationId: null,
      message: "FirstDay could not reach the local API.",
    });
  });

  it("only selects processed conversations with immutable revisions", () => {
    expect(isConversationSelectable(conversation())).toBe(true);
    expect(isConversationSelectable(conversation({ status: "processing", revision: undefined }))).toBe(false);
    expect(isConversationSelectable(conversation({ status: "failed", revision: undefined }))).toBe(false);
  });
});

describe("FirstDay transcript and instruction review state", () => {
  function selectedFixtureState() {
    const loaded = reduceFirstDayState(
      reduceFirstDayState(initialFirstDayState, {
        type: "picker/loadStarted",
        sourceKind: "fixture",
      }),
      {
        type: "picker/loadSucceeded",
        health: AUTHENTICATED_HEALTH,
        conversations: [
          conversation({
            id: SOURCE.id,
            sourceKind: "fixture",
            title: SOURCE.title,
            startedAt: SOURCE.startedAt,
            endedAt: SOURCE.endedAt,
            durationMs: SOURCE.endedAt === undefined
              ? undefined
              : Date.parse(SOURCE.endedAt) - Date.parse(SOURCE.startedAt),
            revision: SOURCE.revision,
          }),
        ],
      },
    );
    return reduceFirstDayState(loaded, {
      type: "picker/conversationSelected",
      conversationId: SOURCE.id,
    });
  }

  it("loads a transcript, toggles exact excluded ranges, and records explicit consent", () => {
    const loading = reduceFirstDayState(selectedFixtureState(), {
      type: "preview/loadStarted",
    });
    const ready = reduceFirstDayState(loading, {
      type: "preview/loadSucceeded",
      source: SOURCE,
    });
    const excluded = reduceFirstDayState(ready, {
      type: "preview/utteranceToggled",
      utterance: SOURCE.utterances[8]!,
    });
    const consented = reduceFirstDayState(excluded, {
      type: "preview/consentChanged",
      confirmed: true,
    });

    expect(ready).toMatchObject({
      stage: "transcript",
      preview: { phase: "ready", consentConfirmed: false, excludedRanges: [] },
    });
    expect(consented.preview).toMatchObject({
      consentConfirmed: true,
      excludedRanges: [
        { startMs: 44_100, endMs: 48_900, reason: "Excluded by learner before extraction" },
      ],
    });
    expect(
      reduceFirstDayState(consented, {
        type: "preview/utteranceToggled",
        utterance: SOURCE.utterances[8]!,
      }).preview.excludedRanges,
    ).toEqual([]);
  });

  it("includes a row by removing every stored exclusion that overlaps its half-open range", () => {
    const utterance = SOURCE.utterances[8]!;
    const ready = reduceFirstDayState(
      reduceFirstDayState(selectedFixtureState(), { type: "preview/loadStarted" }),
      { type: "preview/loadSucceeded", source: SOURCE },
    );
    const overlappingRanges = [
      {
        startMs: 43_900,
        endMs: 44_200,
        reason: "Overlaps the start of the row",
      },
      {
        startMs: 48_800,
        endMs: 49_100,
        reason: "Overlaps the end of the row",
      },
      {
        startMs: 0,
        endMs: 5_200,
        reason: "A different excluded row",
      },
    ];
    const shownExcluded = {
      ...ready,
      preview: { ...ready.preview, excludedRanges: overlappingRanges },
    };

    expect(isUtteranceExcluded(utterance, shownExcluded.preview.excludedRanges)).toBe(true);

    const toggled = reduceFirstDayState(shownExcluded, {
      type: "preview/utteranceToggled",
      utterance,
    });

    expect(toggled.preview.excludedRanges).toEqual([overlappingRanges[2]]);
    expect(isUtteranceExcluded(utterance, toggled.preview.excludedRanges)).toBe(false);
  });

  it("applies server-returned confirm, edit, reject, and question records without optimistic drift", () => {
    const preview = reduceFirstDayState(
      reduceFirstDayState(selectedFixtureState(), { type: "preview/loadStarted" }),
      { type: "preview/loadSucceeded", source: SOURCE },
    );
    const review = reduceFirstDayState(
      reduceFirstDayState(preview, { type: "review/extractionStarted" }),
      {
        type: "review/extractionSucceeded",
        sourceConversation: IMPORT.sourceConversation,
        extraction: EXTRACTION,
      },
    );
    const first = EXTRACTION.items[0]!;
    const second = EXTRACTION.items[1]!;
    const third = EXTRACTION.items[2]!;
    const confirmed = reduceFirstDayState(review, {
      type: "review/instructionUpdated",
      instruction: { ...first, status: "confirmed", updatedAt: "2026-09-10T16:02:00.000Z" },
    });
    const edited = reduceFirstDayState(confirmed, {
      type: "review/instructionUpdated",
      instruction: {
        ...second,
        text: "Check the reservation name and phone number before handover.",
        status: "confirmed",
        updatedAt: "2026-09-10T16:02:10.000Z",
      },
    });
    const rejected = reduceFirstDayState(edited, {
      type: "review/instructionUpdated",
      instruction: { ...third, status: "rejected", updatedAt: "2026-09-10T16:02:20.000Z" },
    });
    const question = createOpenQuestionResponseSchema.parse({
      openQuestion: {
        id: "50000000-0000-4000-8000-000000000001",
        sourceConversationId: EXTRACTION.sourceConversationId,
        sourceRevision: EXTRACTION.sourceRevision,
        instructionId: second.id,
        question: "What if the reservation phone number changed?",
        sourceEvidence: second.sourceEvidence,
        status: "open",
        shareConsent: false,
        createdAt: "2026-09-10T16:03:00.000Z",
        updatedAt: "2026-09-10T16:03:00.000Z",
      },
    }).openQuestion;
    const asked = reduceFirstDayState(rejected, {
      type: "review/questionCreated",
      openQuestion: question,
    });

    expect(review).toMatchObject({
      stage: "review",
      review: { phase: "ready", sourceConversation: IMPORT.sourceConversation },
    });
    expect(asked.review.extraction?.items.map(({ status, text }) => ({ status, text }))).toEqual([
      { status: "confirmed", text: first.text },
      {
        status: "confirmed",
        text: "Check the reservation name and phone number before handover.",
      },
      { status: "rejected", text: third.text },
    ]);
    expect(asked.review.extraction?.openQuestions).toContainEqual(question);
  });
});
