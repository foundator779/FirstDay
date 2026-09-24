import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";

import { ApiError } from "./errors.js";

export const API_BODY_LIMIT_BYTES = 64 * 1024;
export const API_HEADER_LIMIT_BYTES = 32 * 1024;
export const API_URL_LIMIT_BYTES = 20 * 1024;

function ownObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR");
  }
  return value as Record<string, unknown>;
}

function assertScalarTransportValues(record: Readonly<Record<string, unknown>>): void {
  if (Object.values(record).some((value) => typeof value !== "string")) {
    throw new ApiError("VALIDATION_ERROR");
  }
}

function mergeWithoutCollisions(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) {
      throw new ApiError("VALIDATION_ERROR");
    }
    target[key] = value;
  }
}

export function flattenRequest(request: FastifyRequest): Record<string, unknown> {
  const query = ownObject(request.query);
  const params = ownObject(request.params);
  assertScalarTransportValues(query);
  assertScalarTransportValues(params);

  const flattened: Record<string, unknown> = {};
  mergeWithoutCollisions(flattened, params);
  mergeWithoutCollisions(flattened, query);

  if (request.method === "GET") {
    const length = request.headers["content-length"];
    if (
      request.body !== undefined ||
      request.headers["transfer-encoding"] !== undefined ||
      (typeof length === "string" && length !== "0")
    ) {
      throw new ApiError("VALIDATION_ERROR");
    }
    return flattened;
  }

  if (request.body !== undefined) {
    const body = ownObject(request.body);
    mergeWithoutCollisions(flattened, body);
  }
  return flattened;
}

export function parseRequest<Output>(schema: ZodType<Output>, request: FastifyRequest): Output {
  const parsed = schema.safeParse(flattenRequest(request));
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR");
  }
  return parsed.data;
}
