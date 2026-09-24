import {
  beeSourceSchema,
  createOpenQuestionResponseSchema,
  extractInstructionsResponseSchema,
  importConversationResponseSchema,
} from "@firstday/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};

vi.mock("react-native", async () => await import("react-native-web"));

import { ReviewPanel } from "./review-panel.js";

const SOURCE = beeSourceSchema.parse(onboardingJson);
const EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const SOURCE_CONVERSATION = importConversationResponseSchema.parse({
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
}).sourceConversation;

function renderReview() {
  const evidence = EXTRACTION.sourceEvidence[0]!;
  const unlinkedQuestion = createOpenQuestionResponseSchema.parse({
    openQuestion: {
      id: "50000000-0000-4000-8000-000000000002",
      sourceConversationId: EXTRACTION.sourceConversationId,
      sourceRevision: EXTRACTION.sourceRevision,
      question: "Does the five-day window include public holidays?",
      sourceEvidence: [evidence.id],
      status: "open",
      shareConsent: false,
      createdAt: "2026-09-10T16:03:00.000Z",
      updatedAt: "2026-09-10T16:03:00.000Z",
    },
  }).openQuestion;
  const props = {
    review: {
      phase: "ready" as const,
      sourceConversation: SOURCE_CONVERSATION,
      extraction: { ...EXTRACTION, openQuestions: [unlinkedQuestion] },
      message: null,
    },
    source: SOURCE,
    busyInstructionId: null,
    actionError: null,
    onChooseAnotherSource() {},
    async onCreateQuestion() {},
    async onUpdateInstruction() {},
  } satisfies Parameters<typeof ReviewPanel>[0];

  return renderToStaticMarkup(<ReviewPanel {...props} />);
}

describe("instruction review evidence UI", () => {
  it("renders an unlinked extracted question in a private standalone section", () => {
    const markup = renderReview();

    expect(markup).toContain("PRIVATE SOURCE QUESTIONS");
    expect(markup).toContain("Does the five-day window include public holidays?");
  });

  it("shows exact source identity, full spans, and a transcript reveal action", () => {
    const markup = renderReview();

    expect(markup).toContain(SOURCE.id);
    expect(markup).toContain(EXTRACTION.sourceConversationId);
    expect(markup).toContain(EXTRACTION.sourceRevision);
    expect(markup).toContain("0:10.800–0:17.400");
    expect(markup).toContain("0:21.400–0:27.700");
    expect(markup).toContain("0:31.400–0:38.800");
    expect(markup.match(/Reveal in transcript/g)).toHaveLength(4);
  });
});
