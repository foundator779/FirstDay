import type {
  BeeSource,
  ExcludedRange,
  ExtractInstructionsResponse,
  InstructionCard,
  SourceConversation,
} from "@firstday/contracts";
import { createSourceEvidenceId } from "@firstday/contracts";
import {
  BOOKSHOP_FIXTURE_IDS,
  extractFixtureInstructions,
  ScenarioEngineError,
} from "@firstday/scenario-engine";

import { ApiError } from "./errors.js";

export type InstructionExtractionInput = {
  source: BeeSource;
  sourceConversation: SourceConversation;
  excludedRanges: ExcludedRange[];
  previousConfirmedInstructions: InstructionCard[];
  previousInstructionRevision?: string;
  previousInstructionRevisionsById?: Readonly<Record<string, string>>;
  previousInstructionContextsById?: Readonly<Record<string, {
    instructionRevision: string;
    sourceIdentity: Pick<
      SourceConversation,
      "id" | "beeSourceId" | "sourceKind" | "sourceRevision"
    >;
    sourceEvidence: ExtractInstructionsResponse["sourceEvidence"];
  }>>;
  timestamp: string;
  idFactory: () => string;
};

export interface InstructionExtractor {
  extract(input: InstructionExtractionInput): Promise<ExtractInstructionsResponse>;
}

function fixtureInstructionPlan(input: InstructionExtractionInput): {
  instructionRevision: string;
  instructionCount: number;
  supersedesInstructionId?: string;
} {
  if (
    input.sourceConversation.beeSourceId !== input.source.id ||
    input.sourceConversation.sourceKind !== input.source.sourceKind ||
    input.sourceConversation.sourceRevision !== input.source.revision
  ) {
    throw new ApiError("REVISION_CONFLICT");
  }

  if (input.source.id === BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId) {
    return {
      instructionRevision: BOOKSHOP_FIXTURE_IDS.initialInstructionRevision,
      instructionCount: 3,
    };
  }

  if (input.source.id === BOOKSHOP_FIXTURE_IDS.updateBeeSourceId) {
    const candidates = input.previousConfirmedInstructions.filter(
      (instruction) => {
        const context = input.previousInstructionContextsById?.[instruction.id];
        const expectedEvidenceId = createSourceEvidenceId({
          sourceConversationId: instruction.sourceConversationId,
          sourceRevision: instruction.sourceRevision,
          startMs: 10_800,
          endMs: 17_400,
        });
        return (
          context !== undefined &&
          context.instructionRevision === BOOKSHOP_FIXTURE_IDS.initialInstructionRevision &&
          context.sourceIdentity.id === instruction.sourceConversationId &&
          context.sourceIdentity.sourceKind === "fixture" &&
          context.sourceIdentity.beeSourceId ===
            BOOKSHOP_FIXTURE_IDS.onboardingBeeSourceId &&
          context.sourceIdentity.sourceRevision ===
            BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision &&
          instruction.status === "confirmed" &&
          instruction.sourceRevision === BOOKSHOP_FIXTURE_IDS.onboardingSourceRevision &&
          instruction.sourceEvidence.length === 1 &&
          instruction.sourceEvidence[0] === expectedEvidenceId &&
          context.sourceEvidence.length === 1 &&
          context.sourceEvidence[0]?.id === expectedEvidenceId &&
          context.sourceEvidence[0]?.sourceConversationId === instruction.sourceConversationId &&
          context.sourceEvidence[0]?.sourceRevision === instruction.sourceRevision
        );
      },
    );
    if (candidates.length !== 1 || candidates[0] === undefined) {
      throw new ApiError("INVALID_STATE");
    }
    const previousInstructionRevision =
      input.previousInstructionContextsById?.[candidates[0].id]?.instructionRevision;
    if (previousInstructionRevision !== BOOKSHOP_FIXTURE_IDS.initialInstructionRevision) {
      throw new ApiError("INVALID_STATE");
    }
    return {
      instructionRevision: BOOKSHOP_FIXTURE_IDS.updateInstructionRevision,
      instructionCount: 1,
      supersedesInstructionId: candidates[0].id,
    };
  }

  throw new ApiError("INVALID_STATE");
}

/** Deterministic fixture implementation behind the future live-provider boundary. */
export function createFixtureInstructionExtractor(): InstructionExtractor {
  return {
    async extract(input) {
      if (input.source.sourceKind !== "fixture") {
        throw new ApiError("INVALID_STATE", "Live instruction extraction is not configured.");
      }
      const plan = fixtureInstructionPlan(input);
      try {
        return extractFixtureInstructions(input.source, {
          sourceConversationId: input.sourceConversation.id,
          sourceRevision: input.sourceConversation.sourceRevision,
          excludedRanges: input.excludedRanges,
          instructionRevision: plan.instructionRevision,
          instructionIds: Array.from(
            { length: plan.instructionCount },
            () => input.idFactory(),
          ),
          ...(plan.supersedesInstructionId === undefined
            ? {}
            : { supersedesInstructionId: plan.supersedesInstructionId }),
          timestamp: input.timestamp,
        });
      } catch (error) {
        if (error instanceof ScenarioEngineError) throw new ApiError(error.code);
        throw error;
      }
    },
  };
}
