import {
  beeBridgeHealthResponseSchema,
  getBeeConversationResponseSchema,
  listBeeConversationsResponseSchema,
  type BeeBridgeHealthResponse,
  type GetBeeConversationRequest,
  type GetBeeConversationResponse,
  type ListBeeConversationsRequest,
  type ListBeeConversationsResponse,
} from "@firstday/contracts";
import type { ZodType } from "zod";

import { ApiError, InvalidDependencyOutputError } from "./errors.js";
import type { FetchImplementation } from "./auth.js";

const BRIDGE_TOKEN_MIN = 32;
const BRIDGE_TOKEN_MAX = 4_096;

export interface BeeGateway {
  health(): Promise<BeeBridgeHealthResponse>;
  listConversations(input: ListBeeConversationsRequest): Promise<ListBeeConversationsResponse>;
  getConversation(input: GetBeeConversationRequest): Promise<GetBeeConversationResponse>;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("INVALID_STATE");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ApiError("INVALID_STATE");
  }
  return url;
}

function validateBridgeToken(value: string): void {
  if (
    value.length < BRIDGE_TOKEN_MIN ||
    value.length > BRIDGE_TOKEN_MAX ||
    value.trim() !== value ||
    /\s/u.test(value)
  ) {
    throw new ApiError("INVALID_STATE");
  }
}

function mapStatus(status: number): ApiError {
  if (status === 404) return new ApiError("BEE_SOURCE_NOT_FOUND");
  if (status === 409) return new ApiError("SOURCE_NOT_READY");
  if (status === 422) return new ApiError("VALIDATION_ERROR");
  return new ApiError("BEE_BRIDGE_UNAVAILABLE");
}

export function createHttpBeeGateway(input: {
  baseUrl: string;
  bearerToken: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}): BeeGateway {
  const baseUrl = parseBaseUrl(input.baseUrl);
  validateBridgeToken(input.bearerToken);
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ApiError("INVALID_STATE");
  }

  async function request<Output>(
    path: string,
    schema: ZodType<Output>,
  ): Promise<Output> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(new URL(path, baseUrl), {
        method: "GET",
        headers: { authorization: `Bearer ${input.bearerToken}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw mapStatus(response.status);
      const contentType = response.headers.get("content-type") ?? "";
      if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
        throw new InvalidDependencyOutputError();
      }
      const body = await response.json() as unknown;
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new InvalidDependencyOutputError();
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError || error instanceof InvalidDependencyOutputError) {
        throw error;
      }
      throw new ApiError("BEE_BRIDGE_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: async () => request("/v1/health", beeBridgeHealthResponseSchema),
    async listConversations(listInput) {
      const url = new URL("/v1/conversations", baseUrl);
      url.searchParams.set("sourceKind", listInput.sourceKind);
      if (listInput.query !== undefined) url.searchParams.set("query", listInput.query);
      if (listInput.cursor !== undefined) url.searchParams.set("cursor", listInput.cursor);
      if (listInput.limit !== undefined) url.searchParams.set("limit", String(listInput.limit));
      const output = await request(url.pathname + url.search, listBeeConversationsResponseSchema);
      if (output.items.some(({ sourceKind }) => sourceKind !== listInput.sourceKind)) {
        throw new InvalidDependencyOutputError();
      }
      return output;
    },
    async getConversation(detailInput) {
      const url = new URL(`/v1/conversations/${encodeURIComponent(detailInput.beeSourceId)}`, baseUrl);
      url.searchParams.set("sourceKind", detailInput.sourceKind);
      const output = await request(url.pathname + url.search, getBeeConversationResponseSchema);
      if (
        output.conversation.id !== detailInput.beeSourceId ||
        output.conversation.sourceKind !== detailInput.sourceKind
      ) {
        throw new InvalidDependencyOutputError();
      }
      return output;
    },
  };
}
