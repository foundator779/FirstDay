import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  beeBridgeHealthResponseSchema,
  errorEnvelopeSchema,
  getBeeConversationRequestSchema,
  getBeeConversationResponseSchema,
  healthRequestSchema,
  listBeeConversationsRequestSchema,
  listBeeConversationsResponseSchema,
  recentBeeChangesRequestSchema,
  recentBeeChangesResponseSchema,
  type BeeAdapter,
  type BeeAdapterRegistry,
  type ErrorCode,
  type SourceKind,
} from "@firstday/contracts";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from "fastify";
import type { ZodType } from "zod";

import { BeeBridgeError } from "./adapter.js";

export const LOOPBACK_HOST = "127.0.0.1";
const MINIMUM_BEARER_TOKEN_LENGTH = 32;
const MAXIMUM_BEARER_TOKEN_LENGTH = 4_096;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/u;

const ERROR_STATUS = {
  BEE_BRIDGE_UNAVAILABLE: 503,
  BEE_SOURCE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  SOURCE_NOT_READY: 409,
  VALIDATION_ERROR: 422,
} as const satisfies Partial<Record<ErrorCode, number>>;

type MappedBridgeErrorCode = keyof typeof ERROR_STATUS;

const ERROR_MESSAGE: Record<
  "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | keyof typeof ERROR_STATUS,
  string
> = {
  UNAUTHENTICATED: "Bridge authentication is required.",
  RESOURCE_NOT_FOUND: "The requested bridge route was not found.",
  BEE_BRIDGE_UNAVAILABLE: "The local Bee bridge is not reachable.",
  BEE_SOURCE_NOT_FOUND: "The requested Bee conversation was not found.",
  INTERNAL_ERROR: "The Bee bridge could not complete the request.",
  SOURCE_NOT_READY: "The Bee conversation is not ready to import.",
  VALIDATION_ERROR: "The Bee bridge request is invalid.",
};

class InvalidAdapterOutputError extends Error {
  constructor() {
    super("Invalid adapter output.");
    this.name = "InvalidAdapterOutputError";
  }
}

export type BridgeServer = FastifyInstance;

export type BuildBridgeServerDependencies = {
  registry: BeeAdapterRegistry;
  bearerToken: string;
  requestIdFactory?: () => string;
};

export type LoopbackAddress = {
  host: typeof LOOPBACK_HOST;
  port: number;
};

/** Validates a server-only bridge secret without retaining or exposing a derived value. */
export function validateBridgeBearerToken(token: unknown): asserts token is string {
  if (
    typeof token !== "string" ||
    token.length < MINIMUM_BEARER_TOKEN_LENGTH ||
    token.length > MAXIMUM_BEARER_TOKEN_LENGTH ||
    token.trim() !== token ||
    !BEARER_TOKEN_PATTERN.test(token)
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hasAuthorizedBearer(header: string | undefined, expectedDigest: Buffer): boolean {
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/.exec(header) : null;
  const candidateDigest = digestToken(match?.[1] ?? "");
  const matches = timingSafeEqual(candidateDigest, expectedDigest);
  return match !== null && matches;
}

function validRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function makeRequestId(factory: () => string): string {
  try {
    const candidate = factory();
    if (validRequestId(candidate)) {
      return candidate.toLowerCase();
    }
  } catch {
    // A request ID provider must never make an error response unsafe or invalid.
  }
  return randomUUID();
}

function sendError(
  reply: FastifyReply,
  requestIdFactory: () => string,
  status: number,
  code: ErrorCode,
  message: string,
): FastifyReply {
  const envelope = makeErrorEnvelope(requestIdFactory, code, message);
  return reply.code(status).type("application/json; charset=utf-8").send(envelope);
}

function makeErrorEnvelope(
  requestIdFactory: () => string,
  code: ErrorCode,
  message: string,
): ReturnType<typeof errorEnvelopeSchema.parse> {
  return errorEnvelopeSchema.parse({
    error: {
      code,
      message,
      details: {},
      requestId: makeRequestId(requestIdFactory),
    },
  });
}

function sendRawRouterError(
  request: IncomingMessage,
  response: ServerResponse,
  requestIdFactory: () => string,
  expectedTokenDigest: Buffer,
): void {
  const authorized = hasAuthorizedBearer(
    request.headers.authorization,
    expectedTokenDigest,
  );
  const status = authorized ? 422 : 401;
  const code = authorized ? "VALIDATION_ERROR" : "UNAUTHENTICATED";
  const message = authorized
    ? ERROR_MESSAGE.VALIDATION_ERROR
    : ERROR_MESSAGE.UNAUTHENTICATED;
  const body = JSON.stringify(
    makeErrorEnvelope(requestIdFactory, code, message),
  );
  response.statusCode = status;
  response.setHeader("content-length", Buffer.byteLength(body, "utf8"));
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(body);
}

function isMappedBridgeErrorCode(code: ErrorCode): code is MappedBridgeErrorCode {
  return Object.hasOwn(ERROR_STATUS, code);
}

function adapterError(
  error: unknown,
): { status: number; code: ErrorCode; message: string } {
  if (error instanceof BeeBridgeError && isMappedBridgeErrorCode(error.code)) {
    const status = ERROR_STATUS[error.code];
    const message = ERROR_MESSAGE[error.code];
    return { status, code: error.code, message };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: ERROR_MESSAGE.INTERNAL_ERROR,
  };
}

function isFrameworkRequestError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  return (
    typeof code === "string" &&
    code.startsWith("FST_ERR_CTP_")
  );
}

function ownRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return value as Record<string, unknown>;
}

function flattenedRequest(request: FastifyRequest): Record<string, unknown> {
  const contentLength = request.headers["content-length"];
  if (
    request.body !== undefined ||
    request.headers["transfer-encoding"] !== undefined ||
    (typeof contentLength === "string" && contentLength !== "0")
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const query = ownRecord(request.query);
  const params = ownRecord(request.params);
  for (const key of Object.keys(params)) {
    if (Object.hasOwn(query, key)) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
  }
  return { ...query, ...params };
}

function parseRequest<Output>(
  schema: ZodType<Output>,
  request: FastifyRequest,
): Output {
  const parsed = schema.safeParse(flattenedRequest(request));
  if (!parsed.success) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return parsed.data;
}

function parseAdapterOutput<Output>(schema: ZodType<Output>, value: unknown): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidAdapterOutputError();
  }
  return parsed.data;
}

function selectAdapter(registry: BeeAdapterRegistry, sourceKind: SourceKind): BeeAdapter {
  const selected = registry[sourceKind];
  if (
    typeof selected !== "object" ||
    selected === null ||
    selected.sourceKind !== sourceKind
  ) {
    throw new InvalidAdapterOutputError();
  }
  return selected;
}

function assertPageCorrelation(
  sourceKind: SourceKind,
  items: readonly { sourceKind: SourceKind }[],
): void {
  if (items.some((item) => item.sourceKind !== sourceKind)) {
    throw new InvalidAdapterOutputError();
  }
}

/** Builds the side-effect-free authenticated bridge handler. */
export function buildBridgeServer(
  dependencies: BuildBridgeServerDependencies,
): BridgeServer {
  validateBridgeBearerToken(dependencies.bearerToken);
  const expectedTokenDigest = digestToken(dependencies.bearerToken);
  const requestIdFactory = dependencies.requestIdFactory ?? randomUUID;
  const server = Fastify({
    exposeHeadRoutes: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
    requestIdHeader: false,
    routerOptions: {
      maxParamLength: 1_024,
      onBadUrl: (_path, request, response) => {
        sendRawRouterError(request, response, requestIdFactory, expectedTokenDigest);
      },
      onMaxParamLength: (_path, request, response) => {
        sendRawRouterError(request, response, requestIdFactory, expectedTokenDigest);
      },
    },
  });

  server.addHook("onRequest", async (request, reply) => {
    if (!hasAuthorizedBearer(request.headers.authorization, expectedTokenDigest)) {
      await sendError(
        reply,
        requestIdFactory,
        401,
        "UNAUTHENTICATED",
        ERROR_MESSAGE.UNAUTHENTICATED,
      );
    }
  });

  server.setErrorHandler(async (error, _request, reply) => {
    if (reply.sent) {
      return;
    }
    if (isFrameworkRequestError(error)) {
      await sendError(
        reply,
        requestIdFactory,
        422,
        "VALIDATION_ERROR",
        ERROR_MESSAGE.VALIDATION_ERROR,
      );
      return;
    }
    const mapped = adapterError(error);
    await sendError(reply, requestIdFactory, mapped.status, mapped.code, mapped.message);
  });

  server.setNotFoundHandler(async (_request, reply) => {
    await sendError(
      reply,
      requestIdFactory,
      404,
      "RESOURCE_NOT_FOUND",
      ERROR_MESSAGE.RESOURCE_NOT_FOUND,
    );
  });

  server.get("/v1/health", async (request) => {
    parseRequest(healthRequestSchema, request);
    const selected = selectAdapter(dependencies.registry, "bee");
    const output = await selected.health();
    return parseAdapterOutput(beeBridgeHealthResponseSchema, output);
  });

  server.get("/v1/conversations", async (request) => {
    const input = parseRequest(listBeeConversationsRequestSchema, request);
    const selected = selectAdapter(dependencies.registry, input.sourceKind);
    const output = parseAdapterOutput(
      listBeeConversationsResponseSchema,
      await selected.listCandidateConversations(input),
    );
    assertPageCorrelation(input.sourceKind, output.items);
    return output;
  });

  server.get("/v1/conversations/:beeSourceId", async (request) => {
    const input = parseRequest(getBeeConversationRequestSchema, request);
    const selected = selectAdapter(dependencies.registry, input.sourceKind);
    const output = parseAdapterOutput(getBeeConversationResponseSchema, {
      conversation: await selected.getConversation(input.beeSourceId),
    });
    if (
      output.conversation.sourceKind !== input.sourceKind ||
      output.conversation.id !== input.beeSourceId
    ) {
      throw new InvalidAdapterOutputError();
    }
    return output;
  });

  server.get("/v1/changes", async (request) => {
    const input = parseRequest(recentBeeChangesRequestSchema, request);
    const selected = selectAdapter(dependencies.registry, input.sourceKind);
    const output = parseAdapterOutput(
      recentBeeChangesResponseSchema,
      await selected.getRecentChanges(input),
    );
    assertPageCorrelation(input.sourceKind, output.items);
    return output;
  });

  return server;
}

/** Starts an already-built bridge at the only permitted host. */
export async function listenOnLoopback(
  server: BridgeServer,
  port: number,
): Promise<LoopbackAddress> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  await server.listen({ host: LOOPBACK_HOST, port });
  const address = server.server.address();
  if (
    address === null ||
    typeof address === "string" ||
    address.address !== LOOPBACK_HOST
  ) {
    await server.close();
    throw new BeeBridgeError("INTERNAL_ERROR");
  }
  return { host: LOOPBACK_HOST, port: address.port };
}
