import { transcriptSelectionsOverlap, excludedRangeForUtterance } from "@firstday/contracts";
import type {
  BeeConversationSummary,
  BeeSource,
  BeeUtterance,
  ExcludedRange,
  ExtractInstructionsResponse,
  HealthResponse,
  InstructionCard,
  OpenQuestion,
  SourceKind,
  SourceConversation,
  SourceSessionResponse,
} from "@firstday/contracts";

import { isUtteranceExcluded } from "./review-evidence";

export type PickerPhase = "checking" | "ready" | "empty" | "unavailable";

export type PickerState = {
  phase: PickerPhase;
  sourceKind: SourceKind;
  bridgeStatus: HealthResponse["beeBridge"] | "checking";
  authenticatedList: boolean;
  conversations: BeeConversationSummary[];
  selectedConversationId: string | null;
  message: string | null;
};

export type PreviewState = {
  phase: "idle" | "loading" | "ready" | "error";
  source: BeeSource | null;
  consentConfirmed: boolean;
  excludedRanges: ExcludedRange[];
  message: string | null;
};

export type ReviewState = {
  phase: "idle" | "loading" | "ready" | "error";
  sourceConversation: SourceConversation | null;
  extraction: ExtractInstructionsResponse | null;
  message: string | null;
};

export type FirstDayState = {
  stage: "picker" | "transcript" | "review";
  picker: PickerState;
  preview: PreviewState;
  review: ReviewState;
};

export type FirstDayAction =
  | { type: "session/restored"; session: SourceSessionResponse }
  | { type: "picker/loadStarted"; sourceKind: SourceKind }
  | {
      type: "picker/loadSucceeded";
      health: HealthResponse;
      conversations: BeeConversationSummary[];
      authenticatedList?: boolean;
    }
  | { type: "picker/loadFailed"; message: string }
  | { type: "picker/conversationSelected"; conversationId: string }
  | { type: "preview/loadStarted" }
  | { type: "preview/loadSucceeded"; source: BeeSource }
  | { type: "preview/loadFailed"; message: string }
  | { type: "preview/utteranceToggled"; utterance: BeeUtterance }
  | { type: "preview/consentChanged"; confirmed: boolean }
  | { type: "preview/back" }
  | { type: "review/extractionStarted" }
  | {
      type: "review/extractionSucceeded";
      sourceConversation: SourceConversation;
      extraction: ExtractInstructionsResponse;
    }
  | { type: "review/extractionFailed"; message: string }
  | { type: "review/instructionUpdated"; instruction: InstructionCard }
  | { type: "review/questionCreated"; openQuestion: OpenQuestion };

const initialPreviewState: PreviewState = {
  phase: "idle",
  source: null,
  consentConfirmed: false,
  excludedRanges: [],
  message: null,
};

const initialReviewState: ReviewState = {
  phase: "idle",
  sourceConversation: null,
  extraction: null,
  message: null,
};

export const initialFirstDayState: FirstDayState = {
  stage: "picker",
  picker: {
    phase: "checking",
    sourceKind: "bee",
    bridgeStatus: "checking",
    authenticatedList: false,
    conversations: [],
    selectedConversationId: null,
    message: null,
  },
  preview: initialPreviewState,
  review: initialReviewState,
};

export function isConversationSelectable(conversation: BeeConversationSummary): boolean {
  return conversation.status === "processed" && conversation.revision !== undefined;
}

export function reduceFirstDayState(
  state: FirstDayState,
  action: FirstDayAction,
): FirstDayState {
  switch (action.type) {
    case "session/restored":
      return { ...state, stage: action.session.extraction ? "review" : "transcript", picker: { ...state.picker, sourceKind: action.session.sourceConversation.sourceKind }, preview: { phase: "ready", source: action.session.source, consentConfirmed: true, excludedRanges: action.session.excludedRanges, message: null }, review: { phase: action.session.extraction ? "ready" : "idle", sourceConversation: action.session.sourceConversation, extraction: action.session.extraction ?? null, message: null } };
    case "picker/loadStarted":
      return {
        ...state,
        stage: "picker",
        picker: {
          phase: "checking",
          sourceKind: action.sourceKind,
          bridgeStatus: "checking",
          authenticatedList: false,
          conversations: [],
          selectedConversationId: null,
          message: null,
        },
        preview: initialPreviewState,
        review: initialReviewState,
      };
    case "picker/loadSucceeded": {
      const authenticatedList = state.picker.sourceKind === "bee" && action.authenticatedList === true;
      const bridgeAvailable =
        state.picker.sourceKind === "fixture" || authenticatedList || action.health.beeBridge === "authenticated";
      const selectableConversations = action.conversations.filter(isConversationSelectable);
      return {
        ...state,
        picker: {
          ...state.picker,
          phase: !bridgeAvailable
            ? "unavailable"
            : selectableConversations.length === 0
              ? "empty"
              : "ready",
          bridgeStatus: action.health.beeBridge,
          authenticatedList,
          conversations: action.conversations,
          selectedConversationId: null,
          message: null,
        },
      };
    }
    case "picker/loadFailed":
      return {
        ...state,
        picker: {
          ...state.picker,
          phase: "unavailable",
          bridgeStatus: "unavailable",
          authenticatedList: false,
          conversations: [],
          selectedConversationId: null,
          message: action.message,
        },
      };
    case "picker/conversationSelected": {
      const selected = state.picker.conversations.find(
        ({ id }) => id === action.conversationId,
      );
      if (selected === undefined || !isConversationSelectable(selected)) return state;
      return {
        ...state,
        picker: {
          ...state.picker,
          selectedConversationId: selected.id,
        },
      };
    }
    case "preview/loadStarted":
      if (state.picker.selectedConversationId === null) return state;
      return {
        ...state,
        stage: "transcript",
        preview: { ...initialPreviewState, phase: "loading" },
        review: initialReviewState,
      };
    case "preview/loadSucceeded":
      return {
        ...state,
        stage: "transcript",
        preview: {
          phase: "ready",
          source: action.source,
          consentConfirmed: false,
          excludedRanges: [],
          message: null,
        },
      };
    case "preview/loadFailed":
      return {
        ...state,
        stage: "transcript",
        preview: {
          ...initialPreviewState,
          phase: "error",
          message: action.message,
        },
      };
    case "preview/utteranceToggled": {
      if (state.preview.source === null) return state;
      const excluded = isUtteranceExcluded(
        action.utterance,
        state.preview.excludedRanges,
      );
      return {
        ...state,
        preview: {
          ...state.preview,
          excludedRanges: excluded
            ? state.preview.excludedRanges.filter(
                (range) => !transcriptSelectionsOverlap(action.utterance, range),
              )
            : [
                ...state.preview.excludedRanges,
                {
                  ...excludedRangeForUtterance(action.utterance),
                  reason: "Excluded by learner before extraction",
                },
              ].sort((left, right) => left.startMs - right.startMs),
        },
      };
    }
    case "preview/consentChanged":
      return {
        ...state,
        preview: { ...state.preview, consentConfirmed: action.confirmed },
      };
    case "preview/back":
      return {
        ...state,
        stage: "picker",
        preview: initialPreviewState,
        review: initialReviewState,
      };
    case "review/extractionStarted":
      return {
        ...state,
        stage: "review",
        review: { ...initialReviewState, phase: "loading" },
      };
    case "review/extractionSucceeded":
      return {
        ...state,
        stage: "review",
        review: {
          phase: "ready",
          sourceConversation: action.sourceConversation,
          extraction: action.extraction,
          message: null,
        },
      };
    case "review/extractionFailed":
      return {
        ...state,
        stage: "transcript",
        review: {
          ...initialReviewState,
          phase: "error",
          message: action.message,
        },
      };
    case "review/instructionUpdated": {
      const extraction = state.review.extraction;
      if (extraction === null) return state;
      const items = extraction.items.map((item) =>
        item.id === action.instruction.id ? action.instruction : item,
      );
      if (!items.some(({ id }) => id === action.instruction.id)) return state;
      return {
        ...state,
        review: {
          ...state.review,
          extraction: { ...extraction, items },
          message: null,
        },
      };
    }
    case "review/questionCreated": {
      const extraction = state.review.extraction;
      if (extraction === null) return state;
      const existing = extraction.openQuestions.findIndex(
        ({ id }) => id === action.openQuestion.id,
      );
      const openQuestions = [...extraction.openQuestions];
      if (existing === -1) openQuestions.push(action.openQuestion);
      else openQuestions[existing] = action.openQuestion;
      return {
        ...state,
        review: {
          ...state.review,
          extraction: { ...extraction, openQuestions },
          message: null,
        },
      };
    }
  }
}
