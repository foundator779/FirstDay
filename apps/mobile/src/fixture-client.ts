import { excludedRangesMatchSource } from "@firstday/contracts";
import {
  revokeConsentRequestSchema, revokeConsentResponseSchema,
  listSavedSourcesRequestSchema, listSavedSourcesResponseSchema, sourceSessionResponseSchema,
  beeSourceSchema,
  createOpenQuestionRequestSchema,
  createOpenQuestionResponseSchema,
  extractInstructionsRequestSchema,
  extractInstructionsResponseSchema,
  getBeeConversationRequestSchema,
  getBeeConversationResponseSchema,
  healthResponseSchema,
  importConversationRequestSchema,
  importConversationResponseSchema,
  listBeeConversationsRequestSchema,
  listBeeConversationsResponseSchema,
  updateInstructionRequestSchema,
  updateInstructionResponseSchema,
  type BeeConversationSummary,
  type BeeSource,
  type ExtractInstructionsResponse,
  type SourceConversation,
} from "@firstday/contracts";

import goldenJson from "../../../fixtures/expected-scenarios/bookshop.json" with {
  type: "json",
};
import onboardingJson from "../../../fixtures/transcripts/bookshop-onboarding.json" with {
  type: "json",
};
import updateJson from "../../../fixtures/transcripts/bookshop-policy-update.json" with {
  type: "json",
};
import { FirstDayClientError, type FirstDayClient } from "./api";

const SOURCES: readonly BeeSource[] = [
  beeSourceSchema.parse(updateJson),
  beeSourceSchema.parse(onboardingJson),
];
const INITIAL_EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.initialExtraction);
const UPDATE_EXTRACTION = extractInstructionsResponseSchema.parse(goldenJson.updateExtraction);
const LEARNER_ID = "70000000-0000-4000-8000-000000000001";
const TRANSCRIPT_HASHES = {
  "fixture-bookshop-onboarding":
    "dfee89c91fa321314980bf085e216ff6941c4929709e7c2b6ffa11b79330c3bf",
  "fixture-bookshop-policy-update":
    "7101d4f5037445e9c3f1ffb08d65ae6d59d4756753e767bb7a6d5a69000a51f9",
} as const;

function sourceConversationFor(source: BeeSource): SourceConversation {
  const onboarding = source.id === "fixture-bookshop-onboarding";
  const timestamp = onboarding
    ? "2026-09-10T16:00:59.000Z"
    : "2026-09-17T16:00:59.000Z";
  return importConversationResponseSchema.parse({
    sourceConversation: {
      id: onboarding
        ? goldenJson.ids.onboardingSourceConversationId
        : goldenJson.ids.updateSourceConversationId,
      learnerId: LEARNER_ID,
      beeSourceId: source.id,
      sourceKind: source.sourceKind,
      title: source.title,
      startedAt: source.startedAt,
      ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
      transcriptHash: TRANSCRIPT_HASHES[source.id as keyof typeof TRANSCRIPT_HASHES],
      sourceRevision: source.revision,
      consentStatus: "confirmed",
      consentConfirmedAt: timestamp,
      status: "ready",
      importedAt: timestamp,
      updatedAt: timestamp,
    },
  }).sourceConversation;
}

function fixtureError(
  code: ConstructorParameters<typeof FirstDayClientError>[0],
  message: string,
): FirstDayClientError {
  return new FirstDayClientError(code, message);
}

function overlaps(
  evidence: { startMs: number; endMs: number },
  range: { startMs: number; endMs: number },
): boolean {
  return evidence.startMs < range.endMs && range.startMs < evidence.endMs;
}

function extractionWithoutExcludedEvidence(
  extraction: ExtractInstructionsResponse,
  excludedRanges: readonly { startMs: number; endMs: number }[],
): ExtractInstructionsResponse {
  const sourceEvidence = extraction.sourceEvidence.filter(
    (evidence) => !excludedRanges.some((range) => overlaps(evidence, range)),
  );
  const available = new Set(sourceEvidence.map(({ id }) => id));
  return extractInstructionsResponseSchema.parse({
    ...extraction,
    items: extraction.items.filter(({ sourceEvidence: references }) =>
      references.every((id) => available.has(id)),
    ),
    openQuestions: extraction.openQuestions.filter(({ sourceEvidence: references }) =>
      references.every((id) => available.has(id)),
    ),
    sourceEvidence,
  });
}

function toSummary(source: BeeSource): BeeConversationSummary {
  return {

    id: source.id,
    sourceKind: source.sourceKind,
    title: source.title,
    startedAt: source.startedAt,
    ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
    ...(source.endedAt === undefined
      ? {}
      : { durationMs: Date.parse(source.endedAt) - Date.parse(source.startedAt) }),
    status: source.status,
    revision: source.revision,
  };
}

export function createFixtureFirstDayClient(): FirstDayClient {
  const imports = new Map<string, SourceConversation>();
  const extractions = new Map<string, ExtractInstructionsResponse>();
  const exclusions = new Map<string, { startMs: number; endMs: number }[]>();
  let questionSequence = 1;
  let reviewSequence = 1;

  return {
    async revokeConsent(input) {
      const request = revokeConsentRequestSchema.parse(input);
      const source = [...imports.values()].find((s) => s.id === request.sourceConversationId);
      if (!source) throw fixtureError("RESOURCE_NOT_FOUND", "Source not found.");
      if (source.sourceRevision !== request.sourceRevision) throw fixtureError("REVISION_CONFLICT", "Source revision changed.");
      const timestamp = new Date().toISOString();
      const sourceConversation = source.consentStatus === "revoked" ? source : { ...source, consentStatus: "revoked" as const, consentRevokedAt: timestamp, updatedAt: timestamp };
      imports.set(source.beeSourceId, sourceConversation); exclusions.delete(source.id);
      return revokeConsentResponseSchema.parse({ sourceConversation, stalePracticeSetIds: [] });
    },
    async listSavedSources(input) {
      const query = listSavedSourcesRequestSchema.parse(input);
      if (query.sourceKind !== "fixture") throw fixtureError("FORBIDDEN", "Fixture sessions only.");
      const saved = [...imports.values()].filter((s) => s.consentStatus === "confirmed").sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id));
      const offset = query.cursor ? saved.findIndex((s) => s.id === query.cursor) + 1 : 0;
      if (query.cursor && !offset) throw fixtureError("REVISION_CONFLICT", "Reload saved sources.");
      const items = saved.slice(offset, offset + query.limit);
      return listSavedSourcesResponseSchema.parse({ items, nextCursor: offset + query.limit < saved.length ? items.at(-1)!.id : null });
    },
    async getSourceSession(id) {
      const sourceConversation = [...imports.values()].find((source) => source.id === id);
      if (!sourceConversation) throw fixtureError("RESOURCE_NOT_FOUND", "Import the source first.");
      if (sourceConversation.consentStatus !== "confirmed") throw fixtureError("CONSENT_REVOKED", "Permission to use this source was revoked.");
      return sourceSessionResponseSchema.parse({ sourceConversation, source: SOURCES.find((s) => s.id === sourceConversation.beeSourceId), excludedRanges: exclusions.get(id) ?? [], ...(extractions.has(id) ? { extraction: extractions.get(id) } : {}), practices: [], changes: [], sourceEvidence: [] });
    },
    async health() {
      return healthResponseSchema.parse({
        ok: true,
        service: "firstday-api",
        version: "0.2.0",
        beeBridge: "authenticated",
      });
    },
    async listConversations(input) {
      const request = listBeeConversationsRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") {
        throw new FirstDayClientError(
          "INVALID_STATE",
          "The public demo fixture cannot be used as a live Bee source.",
        );
      }
      if (request.cursor !== undefined) {
        throw new FirstDayClientError("VALIDATION_ERROR", "The demo fixture has one page.");
      }

      const normalizedQuery = request.query?.trim().toLocaleLowerCase();
      const items = SOURCES.map(toSummary).filter(
        ({ title }) =>
          normalizedQuery === undefined || title.toLocaleLowerCase().includes(normalizedQuery),
      );
      return listBeeConversationsResponseSchema.parse({
        items: items.slice(0, request.limit ?? 20),
        nextCursor: null,
      });
    },
    async getConversation(input) {
      const request = getBeeConversationRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") {
        throw fixtureError(
          "INVALID_STATE",
          "The public demo fixture cannot be used as a live Bee source.",
        );
      }
      const source = SOURCES.find(({ id }) => id === request.beeSourceId);
      if (source === undefined) {
        throw fixtureError("BEE_SOURCE_NOT_FOUND", "That demo source does not exist.");
      }
      return getBeeConversationResponseSchema.parse({ conversation: source });
    },
    async importConversation(input) {
      const consent = (input as { consent?: { confirmed?: unknown } } | null)?.consent;
      if (consent?.confirmed !== true) {
        throw fixtureError("CONSENT_REQUIRED", "Confirm consent before importing this source.");
      }
      const request = importConversationRequestSchema.parse(input);
      if (request.sourceKind !== "fixture") {
        throw fixtureError(
          "INVALID_STATE",
          "The public demo fixture cannot be used as a live Bee source.",
        );
      }
      const source = SOURCES.find(({ id }) => id === request.beeSourceId);
      if (source === undefined) {
        throw fixtureError("BEE_SOURCE_NOT_FOUND", "That demo source does not exist.");
      }
      if (source.revision !== request.sourceRevision) {
        throw fixtureError("REVISION_CONFLICT", "The demo source revision changed.");
      }
      const sourceConversation = imports.get(source.id) ?? sourceConversationFor(source);
      if (sourceConversation.consentStatus !== "confirmed") throw fixtureError("CONSENT_REVOKED", "Permission to use this source was revoked.");
      imports.set(source.id, sourceConversation);
      return importConversationResponseSchema.parse({ sourceConversation });
    },
    async extractInstructions(input) {
      const request = extractInstructionsRequestSchema.parse(input);
      const sourceConversation = [...imports.values()].find(
        ({ id }) => id === request.sourceConversationId,
      );
      if (sourceConversation === undefined) {
        throw fixtureError("RESOURCE_NOT_FOUND", "Import the demo source before extraction.");
      }
      if (sourceConversation.consentStatus !== "confirmed") throw fixtureError("CONSENT_REVOKED", "Permission to use this source was revoked.");
      if (sourceConversation.sourceRevision !== request.sourceRevision) {
        throw fixtureError("REVISION_CONFLICT", "The imported source revision changed.");
      }
      if (extractions.has(sourceConversation.id)) {
        throw fixtureError("INVALID_STATE", "This source snapshot was already extracted.");
      }
      const source = SOURCES.find(s => s.id === sourceConversation.beeSourceId);
      if (!source || !excludedRangesMatchSource(source, request.excludedRanges)) throw fixtureError("VALIDATION_ERROR", "Excluded selections do not match source timing.");
      const fixture = sourceConversation.beeSourceId === "fixture-bookshop-onboarding"
        ? INITIAL_EXTRACTION
        : UPDATE_EXTRACTION;
      const extraction = extractionWithoutExcludedEvidence(fixture, request.excludedRanges);
      extractions.set(sourceConversation.id, extraction);
      exclusions.set(sourceConversation.id, request.excludedRanges);
      return extractInstructionsResponseSchema.parse(extraction);
    },
    async updateInstruction(input) {
      const request = updateInstructionRequestSchema.parse(input);
      const extraction = [...extractions.values()].find(({ items }) =>
        items.some(({ id }) => id === request.instructionId),
      );
      const current = extraction?.items.find(({ id }) => id === request.instructionId);
      if (extraction === undefined || current === undefined) {
        throw fixtureError("RESOURCE_NOT_FOUND", "That demo instruction does not exist.");
      }
      if (![...imports.values()].some((s) => s.id === extraction.sourceConversationId && s.consentStatus === "confirmed")) throw fixtureError("CONSENT_REVOKED", "Permission to use this source was revoked.");
      if (extraction.sourceRevision !== request.sourceRevision) {
        throw fixtureError("REVISION_CONFLICT", "The instruction source revision changed.");
      }
      if (current.status !== "needsReview") {
        throw fixtureError("INVALID_STATE", "Reviewed instructions are terminal.");
      }
      const instruction = updateInstructionResponseSchema.parse({
        instruction: {
          ...current,
          ...(request.text === undefined ? {} : { text: request.text }),
          ...(request.situation === undefined ? {} : { situation: request.situation }),
          ...(request.expectedAction === undefined
            ? {}
            : { expectedAction: request.expectedAction }),
          ...(request.exceptions === undefined ? {} : { exceptions: request.exceptions }),
          ...(request.status === undefined ? {} : { status: request.status }),
          updatedAt: new Date(
            Date.parse(current.updatedAt) + reviewSequence++ * 1_000,
          ).toISOString(),
        },
      }).instruction;
      const index = extraction.items.findIndex(({ id }) => id === instruction.id);
      extraction.items[index] = instruction;
      return updateInstructionResponseSchema.parse({ instruction });
    },
    async createOpenQuestion(input) {
      const request = createOpenQuestionRequestSchema.parse(input);
      const extraction = extractions.get(request.sourceConversationId);
      if (![...imports.values()].some((s) => s.id === request.sourceConversationId && s.consentStatus === "confirmed")) throw fixtureError("CONSENT_REVOKED", "Permission to use this source was revoked.");
      if (extraction === undefined) {
        throw fixtureError("RESOURCE_NOT_FOUND", "Extract the demo source before asking a question.");
      }
      if (extraction.sourceRevision !== request.sourceRevision) {
        throw fixtureError("REVISION_CONFLICT", "The question source revision changed.");
      }
      const availableEvidence = new Set(extraction.sourceEvidence.map(({ id }) => id));
      if (request.sourceEvidence.some((id) => !availableEvidence.has(id))) {
        throw fixtureError("VALIDATION_ERROR", "Questions must use evidence from this source.");
      }
      if (
        request.instructionId !== undefined &&
        !extraction.items.some(({ id }) => id === request.instructionId)
      ) {
        throw fixtureError("RESOURCE_NOT_FOUND", "That demo instruction does not exist.");
      }
      const timestamp = new Date(
        Date.parse(extraction.items[0]?.createdAt ?? "2026-09-10T16:03:00.000Z") +
          questionSequence * 1_000,
      ).toISOString();
      const openQuestion = createOpenQuestionResponseSchema.parse({
        openQuestion: {
          id: `50000000-0000-4000-8000-${String(questionSequence++).padStart(12, "0")}`,
          ...request,
          status: "open",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }).openQuestion;
      extraction.openQuestions.push(openQuestion);
      return createOpenQuestionResponseSchema.parse({ openQuestion });
    },
  };
}
