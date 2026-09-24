import {
  createPracticeSetRequestSchema, createPracticeSetResponseSchema, getPracticeSetRequestSchema,
  getPracticeSetResponseSchema, createAttemptRequestSchema, createAttemptResponseSchema,
  compareSourceRequestSchema, compareSourceResponseSchema, confirmChangeRequestSchema, confirmChangeResponseSchema,
  errorEnvelopeSchema,
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
  type CreateOpenQuestionRequestInput,
  type CreateOpenQuestionResponse,
  type ErrorCode,
  type ExtractInstructionsRequestInput,
  type ExtractInstructionsResponse,
  type GetBeeConversationRequestInput,
  type GetBeeConversationResponse,
  type HealthResponse,
  type ImportConversationRequestInput,
  type ImportConversationResponse,
  type ListBeeConversationsRequestInput,
  type ListBeeConversationsResponse,
  type UpdateInstructionRequestInput,
  type UpdateInstructionResponse,
} from "@firstday/contracts";
import type { PracticeClient } from "./synthetic-client";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class FirstDayClientError extends Error {
  readonly code: ClientErrorCode;
  readonly requestId: string | undefined;
  readonly status: number | undefined;

  constructor(
    code: ClientErrorCode,
    message: string,
    options: { requestId?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FirstDayClientError";
    this.code = code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type ResponseSchema<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

export type FirstDayClient = {
  health(signal?: AbortSignal): Promise<HealthResponse>;
  listConversations(
    request: ListBeeConversationsRequestInput,
    signal?: AbortSignal,
  ): Promise<ListBeeConversationsResponse>;
  getConversation(
    request: GetBeeConversationRequestInput,
    signal?: AbortSignal,
  ): Promise<GetBeeConversationResponse>;
  importConversation(
    request: ImportConversationRequestInput,
    signal?: AbortSignal,
  ): Promise<ImportConversationResponse>;
  extractInstructions(
    request: ExtractInstructionsRequestInput,
    signal?: AbortSignal,
  ): Promise<ExtractInstructionsResponse>;
  updateInstruction(
    request: UpdateInstructionRequestInput,
    signal?: AbortSignal,
  ): Promise<UpdateInstructionResponse>;
  createOpenQuestion(
    request: CreateOpenQuestionRequestInput,
    signal?: AbortSignal,
  ): Promise<CreateOpenQuestionResponse>;
};

export type FirstDayApiClientOptions = {
  baseUrl: string;
  sessionToken: string;
  fetchImplementation?: FetchImplementation;
};

function normalizedBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new FirstDayClientError("INVALID_STATE", "FirstDay API URL is not configured.");
  }
  return normalized;
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new FirstDayClientError("INVALID_RESPONSE", "FirstDay returned unreadable data.", {
      status: response.status,
      cause: error,
    });
  }
}

async function parseResponse<T>(
  response: Response,
  schema: ResponseSchema<T>,
): Promise<T> {
  const body = await decodeJson(response);
  if (!response.ok) {
    const canonical = errorEnvelopeSchema.safeParse(body);
    if (canonical.success) {
      throw new FirstDayClientError(canonical.data.error.code, canonical.data.error.message, {
        requestId: canonical.data.error.requestId,
        status: response.status,
      });
    }
    throw new FirstDayClientError("INVALID_RESPONSE", "FirstDay returned an unexpected error.", {
      status: response.status,
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new FirstDayClientError("INVALID_RESPONSE", "FirstDay returned data in an unexpected shape.", {
      status: response.status,
    });
  }
  return parsed.data;
}

async function safeFetch(
  fetchImplementation: FetchImplementation,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImplementation(input, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new FirstDayClientError("NETWORK_ERROR", "FirstDay could not reach the local API.", {
      cause: error,
    });
  }
}

export function createFirstDayApiClient({
  baseUrl,
  sessionToken,
  fetchImplementation = fetch,
}: FirstDayApiClientOptions): PracticeClient {
  const apiBaseUrl = normalizedBaseUrl(baseUrl);
  const authorization = `Bearer ${sessionToken}`;

  async function authenticatedJson<T>(
    path: string,
    method: "GET" | "POST" | "PATCH",
    schema: ResponseSchema<T>,
    body: unknown | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const response = await safeFetch(fetchImplementation, `${apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    return parseResponse(response, schema);
  }

  return {
    async createPractice(input) {
      return authenticatedJson("/api/practice-sets", "POST", createPracticeSetResponseSchema, createPracticeSetRequestSchema.parse(input), undefined);
    },
    async getPractice(id) {
      const request = getPracticeSetRequestSchema.parse({ practiceSetId: id });
      return authenticatedJson(`/api/practice-sets/${encodeURIComponent(request.practiceSetId)}`, "GET", getPracticeSetResponseSchema, undefined, undefined);
    },
    async submitAttempt(input) {
      const { scenarioId, ...body } = createAttemptRequestSchema.parse(input);
      return authenticatedJson(`/api/scenarios/${encodeURIComponent(scenarioId)}/attempts`, "POST", createAttemptResponseSchema, body, undefined);
    },
    async compareSources(input) {
      const { sourceConversationId, ...body } = compareSourceRequestSchema.parse(input);
      return authenticatedJson(`/api/source-conversations/${encodeURIComponent(sourceConversationId)}/compare`, "POST", compareSourceResponseSchema, body, undefined);
    },
    async confirmChange(input) {
      const { changeId, ...body } = confirmChangeRequestSchema.parse(input);
      return authenticatedJson(`/api/changes/${encodeURIComponent(changeId)}/confirm`, "POST", confirmChangeResponseSchema, body, undefined);
    },
    async health(signal) {
      const response = await safeFetch(fetchImplementation, `${apiBaseUrl}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      return parseResponse(response, healthResponseSchema);
    },
    async listConversations(input, signal) {
      const request = listBeeConversationsRequestSchema.parse(input);
      const query = new URLSearchParams({ sourceKind: request.sourceKind });
      if (request.query !== undefined) query.set("query", request.query);
      if (request.cursor !== undefined) query.set("cursor", request.cursor);
      if (request.limit !== undefined) query.set("limit", String(request.limit));
      const response = await safeFetch(
        fetchImplementation,
        `${apiBaseUrl}/api/bee/conversations?${query.toString()}`,
        {
          method: "GET",
          headers: { authorization, accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return parseResponse(response, listBeeConversationsResponseSchema);
    },
    async getConversation(input, signal) {
      const request = getBeeConversationRequestSchema.parse(input);
      const query = new URLSearchParams({ sourceKind: request.sourceKind });
      return authenticatedJson(
        `/api/bee/conversations/${encodeURIComponent(request.beeSourceId)}?${query.toString()}`,
        "GET",
        getBeeConversationResponseSchema,
        undefined,
        signal,
      );
    },
    async importConversation(input, signal) {
      const request = importConversationRequestSchema.parse(input);
      return authenticatedJson(
        "/api/imports",
        "POST",
        importConversationResponseSchema,
        request,
        signal,
      );
    },
    async extractInstructions(input, signal) {
      const request = extractInstructionsRequestSchema.parse(input);
      const { sourceConversationId, ...body } = request;
      return authenticatedJson(
        `/api/source-conversations/${encodeURIComponent(sourceConversationId)}/extract`,
        "POST",
        extractInstructionsResponseSchema,
        body,
        signal,
      );
    },
    async updateInstruction(input, signal) {
      const request = updateInstructionRequestSchema.parse(input);
      const { instructionId, ...body } = request;
      return authenticatedJson(
        `/api/instructions/${encodeURIComponent(instructionId)}`,
        "PATCH",
        updateInstructionResponseSchema,
        body,
        signal,
      );
    },
    async createOpenQuestion(input, signal) {
      const request = createOpenQuestionRequestSchema.parse(input);
      return authenticatedJson(
        "/api/open-questions",
        "POST",
        createOpenQuestionResponseSchema,
        request,
        signal,
      );
    },
  };
}
