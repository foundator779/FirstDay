import type {
  CompareSourceRequest, CompareSourceResponse, ConfirmChangeRequest, ConfirmChangeResponse,
  Attempt,
  BeeSource,
  ChangeProposal,
  CreateAttemptRequest,
  CreateAttemptResponse,
  CreateOpenQuestionRequest,
  CreatePracticeSetRequest,
  CreatePracticeSetResponse,
  ExcludedRange,
  ExtractInstructionsResponse,
  GetPracticeSetResponse,
  InstructionCard,
  OpenQuestion,
  RevokeConsentResponse,
  SourceEvidence,
  SourceConversation,
  UpdateInstructionRequest,
  UpdateOpenQuestionRequest,
} from "@firstday/contracts";

export type ImportSourceInput = {
  learnerId: string;
  sourceConversationId: string;
  source: BeeSource;
  timestamp: string;
};

export type SourceLookup = {
  learnerId: string;
  sourceConversationId: string;
};

export type SourceRevisionLookup = SourceLookup & {
  sourceRevision: string;
};

export type RevokeConsentInput = SourceRevisionLookup & {
  reason?: string;
  timestamp: string;
};

export type SourceProcessingContext = {
  sourceConversation: SourceConversation;
  source: BeeSource;
};

export type ExtractionInstructionContext = {
  instructionRevision: string;
  sourceIdentity: Pick<
    SourceConversation,
    "id" | "beeSourceId" | "sourceKind" | "sourceRevision"
  >;
  sourceEvidence: SourceEvidence[];
};

export type ExtractionContext = SourceProcessingContext & {
  previousConfirmedInstructions: InstructionCard[];
  previousInstructionRevision?: string;
  previousInstructionRevisionsById: Record<string, string>;
  previousInstructionContextsById: Record<string, ExtractionInstructionContext>;
};

export type SaveExtractionInput = SourceRevisionLookup & {
  excludedRanges: ExcludedRange[];
  extraction: ExtractInstructionsResponse;
  allocation: {
    recordIds: string[];
    timestamp: string;
  };
  lineage?: {
    previousInstructionContextsById: Record<string, ExtractionInstructionContext>;
  };
};

export type UpdateInstructionInput = Omit<UpdateInstructionRequest, "instructionId"> & {
  learnerId: string;
  instructionId: string;
  timestamp: string;
};

export type CreateOpenQuestionInput = CreateOpenQuestionRequest & {
  learnerId: string;
  openQuestionId: string;
  timestamp: string;
};

export type UpdateOpenQuestionInput = Omit<UpdateOpenQuestionRequest, "openQuestionId"> & {
  learnerId: string;
  openQuestionId: string;
  timestamp: string;
};

export type PrepareStandardPracticeInput = CreatePracticeSetRequest & {
  learnerId: string;
};

export type StandardPracticeContext = {
  learnerId: string;
  sourceConversationId: string;
  sourceRevision: string;
  sourceKind: SourceConversation["sourceKind"];
  instructionRevision: string;
  instructions: InstructionCard[];
  sourceEvidence: ExtractInstructionsResponse["sourceEvidence"];
};

export type SaveStandardPracticeInput = {
  learnerId: string;
  request: CreatePracticeSetRequest;
  generation: CreatePracticeSetResponse;
  allocation: {
    practiceSetId: string;
    scenarioIds: string[];
    timestamp: string;
  };
};

export type PracticeSetLookup = {
  learnerId: string;
  practiceSetId: string;
};

export type PrepareAttemptInput = CreateAttemptRequest & {
  learnerId: string;
};

export type AttemptContext = {
  practiceSet: CreateAttemptResponse["practiceSet"];
  scenario: CreateAttemptResponse["scenario"];
  instructions: InstructionCard[];
  sourceEvidence: SourceEvidence[];
  changeProposal?: ChangeProposal;
};

export type AttemptEvaluation = Pick<
  Attempt,
  "feedback" | "matchedRuleIds" | "missedRuleIds" | "result" | "sourceEvidence"
>;

export type SaveAttemptInput = PrepareAttemptInput & {
  attemptId: string;
  timestamp: string;
  evaluation: AttemptEvaluation;
};

/**
 * Learner-scoped persistence contract. A durable adapter can implement this
 * interface with the checked-in Supabase schema without changing HTTP handlers.
 */
export interface FirstDayRepository {
  compareSources(input: CompareSourceRequest & { learnerId: string; timestamp: string; idFactory: () => string }): Promise<CompareSourceResponse>;
  confirmChange(input: ConfirmChangeRequest & { learnerId: string; timestamp: string; practiceSetId: string; scenarioId: string }): Promise<ConfirmChangeResponse>;
  importSource(input: ImportSourceInput): Promise<SourceConversation>;
  getSource(input: SourceLookup): Promise<SourceConversation>;
  getSourceForProcessing(input: SourceRevisionLookup): Promise<SourceProcessingContext>;
  prepareExtraction(input: SourceRevisionLookup): Promise<ExtractionContext>;
  saveExtraction(input: SaveExtractionInput): Promise<ExtractInstructionsResponse>;
  updateInstruction(input: UpdateInstructionInput): Promise<InstructionCard>;
  createOpenQuestion(input: CreateOpenQuestionInput): Promise<OpenQuestion>;
  updateOpenQuestion(input: UpdateOpenQuestionInput): Promise<OpenQuestion>;
  prepareStandardPractice(input: PrepareStandardPracticeInput): Promise<StandardPracticeContext>;
  saveStandardPractice(input: SaveStandardPracticeInput): Promise<CreatePracticeSetResponse>;
  getPracticeSet(input: PracticeSetLookup): Promise<GetPracticeSetResponse>;
  prepareAttempt(input: PrepareAttemptInput): Promise<AttemptContext>;
  saveAttempt(input: SaveAttemptInput): Promise<CreateAttemptResponse>;
  revokeConsent(input: RevokeConsentInput): Promise<RevokeConsentResponse>;
}
