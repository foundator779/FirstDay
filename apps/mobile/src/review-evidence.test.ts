import {
  beeSourceSchema,
  createOpenQuestionResponseSchema,
  extractInstructionsResponseSchema,
} from "@firstday/contracts";
import { describe, expect, it } from "vitest";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};

import {
  buildReviewSections,
  countIncludedUtterances,
  evidenceSourceIdentity,
  evidenceTranscriptRows,
  formatEvidenceSpan,
  halfOpenRangesOverlap,
  isUtteranceExcluded,
  resolveEvidence,
} from "./review-evidence.js";

const EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const SOURCE = beeSourceSchema.parse(onboardingJson);

describe("transcript exclusion overlap", () => {
  const utterances = [
    { id: "first", startMs: 0, endMs: 1_000, text: "First line" },
    { id: "second", startMs: 1_000, endMs: 2_000, text: "Second line" },
    { id: "third", startMs: 2_000, endMs: 3_000, text: "Third line" },
  ];

  it("uses canonical half-open intervals at shared boundaries", () => {
    expect(
      halfOpenRangesOverlap(
        { startMs: 0, endMs: 1_000 },
        { startMs: 1_000, endMs: 1_500 },
      ),
    ).toBe(false);
    expect(
      halfOpenRangesOverlap(
        { startMs: 1_000, endMs: 2_000 },
        { startMs: 999, endMs: 1_001 },
      ),
    ).toBe(true);
  });

  it("marks and counts every utterance overlapped by an exclusion", () => {
    const exclusions = [{ startMs: 900, endMs: 1_100 }];

    expect(isUtteranceExcluded(utterances[0]!, exclusions)).toBe(true);
    expect(isUtteranceExcluded(utterances[1]!, exclusions)).toBe(true);
    expect(isUtteranceExcluded(utterances[2]!, exclusions)).toBe(false);
    expect(countIncludedUtterances(utterances, exclusions)).toBe(1);
  });
});

describe("review question sections", () => {
  it("keeps instruction-linked questions with their card and exposes unlinked questions", () => {
    const instruction = EXTRACTION.items[0]!;
    const base = {
      sourceConversationId: EXTRACTION.sourceConversationId,
      sourceRevision: EXTRACTION.sourceRevision,
      question: "Which calendar should I check?",
      sourceEvidence: instruction.sourceEvidence,
      status: "open" as const,
      shareConsent: false,
      createdAt: "2026-09-10T16:03:00.000Z",
      updatedAt: "2026-09-10T16:03:00.000Z",
    };
    const linked = createOpenQuestionResponseSchema.parse({
      openQuestion: {
        ...base,
        id: "50000000-0000-4000-8000-000000000001",
        instructionId: instruction.id,
      },
    }).openQuestion;
    const unlinked = createOpenQuestionResponseSchema.parse({
      openQuestion: {
        ...base,
        id: "50000000-0000-4000-8000-000000000002",
      },
    }).openQuestion;

    const sections = buildReviewSections(EXTRACTION.items, [linked, unlinked]);

    expect(sections.cards[0]).toMatchObject({
      instruction,
      questions: [linked],
    });
    expect(sections.standaloneQuestions).toEqual([unlinked]);
  });
});

describe("review evidence detail", () => {
  it("resolves exact source identity and a millisecond-precise start-end span", () => {
    const evidence = EXTRACTION.sourceEvidence[0]!;

    expect(evidenceSourceIdentity(SOURCE, evidence)).toEqual({
      title: SOURCE.title,
      sourceKind: "fixture",
      beeSourceId: "fixture-bookshop-onboarding",
      sourceConversationId: "10000000-0000-4000-8000-000000000001",
      sourceRevision: "fixture-bookshop-onboarding-r1",
    });
    expect(formatEvidenceSpan(evidence)).toBe("0:10.800–0:17.400");
  });

  it("builds a full transcript view with only half-open matching rows highlighted", () => {
    const evidence = EXTRACTION.sourceEvidence[0]!;
    const rows = evidenceTranscriptRows(SOURCE.utterances, [
      evidence,
      {
        ...evidence,
        startMs: SOURCE.utterances[3]!.endMs,
        endMs: SOURCE.utterances[3]!.endMs + 1,
        utteranceIds: [SOURCE.utterances[4]!.id],
      },
    ]);

    expect(rows).toHaveLength(SOURCE.utterances.length);
    expect(rows.filter(({ highlighted }) => highlighted).map(({ utterance }) => utterance.id)).toEqual([
      "onboarding-003",
    ]);
  });

  it("resolves evidence references in the card or question order", () => {
    const references = [
      EXTRACTION.sourceEvidence[2]!.id,
      EXTRACTION.sourceEvidence[0]!.id,
    ];

    expect(resolveEvidence(references, EXTRACTION.sourceEvidence).map(({ id }) => id)).toEqual(
      references,
    );
  });
});
