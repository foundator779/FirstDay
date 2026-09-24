import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  beeBridgeHealthResponseSchema,
  compareSourceRequestSchema, compareSourceResponseSchema,
  confirmChangeRequestSchema, confirmChangeResponseSchema,
  createAttemptRequestSchema,
  createAttemptResponseSchema,
  createOpenQuestionRequestSchema,
  createOpenQuestionResponseSchema,
  createPracticeSetRequestSchema,
  createPracticeSetResponseSchema,
  errorEnvelopeSchema,
  extractInstructionsRequestSchema,
  extractInstructionsResponseSchema,
  getBeeConversationRequestSchema,
  getBeeConversationResponseSchema,
  getPracticeSetRequestSchema,
  getPracticeSetResponseSchema,
  healthRequestSchema,
  healthResponseSchema,
  importConversationRequestSchema,
  importConversationResponseSchema,
  listBeeConversationsRequestSchema,
  listBeeConversationsResponseSchema,
  revokeConsentRequestSchema,
  revokeConsentResponseSchema,
  updateInstructionRequestSchema,
  updateInstructionResponseSchema,
  updateOpenQuestionRequestSchema,
  updateOpenQuestionResponseSchema,
  type ErrorCode,
  type SourceKind,
} from "@firstday/contracts";
import {
  compareInstructionRevisions,
  evaluateScenario,
  generateChangeDrill,
  generateStandardPracticeSet,
  ScenarioEngineError,
} from "@firstday/scenario-engine";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { ZodType } from "zod";

import type { LearnerSession, SessionVerifier } from "./auth.js";
import type { BeeGateway } from "./bee-gateway.js";
import {
  API_ERROR_MESSAGE,
  API_ERROR_STATUS,
  ApiError,
  InvalidDependencyOutputError,
} from "./errors.js";
import type { InstructionExtractor } from "./extraction.js";
import {
  API_BODY_LIMIT_BYTES,
  API_HEADER_LIMIT_BYTES,
  API_URL_LIMIT_BYTES,
  flattenRequest,
  parseRequest,
} from "./request.js";
import type { FirstDayRepository } from "./repository.js";

export type { SessionVerifier } from "./auth.js";
export type { BeeGateway } from "./bee-gateway.js";

export const API_LOOPBACK_HOST = "127.0.0.1";
export const API_VERSION = "0.2.0";

export type ApiServer = FastifyInstance;

export type ScenarioEngineFacade = {
  generateStandardPracticeSet: (...args: Parameters<typeof generateStandardPracticeSet>) => ReturnType<typeof generateStandardPracticeSet> | Promise<ReturnType<typeof generateStandardPracticeSet>>;
  evaluateScenario: (...args: Parameters<typeof evaluateScenario>) => ReturnType<typeof evaluateScenario> | Promise<ReturnType<typeof evaluateScenario>>;
  compareInstructionRevisions: typeof compareInstructionRevisions;
  generateChangeDrill: typeof generateChangeDrill;
};

export const deterministicScenarioEngine = {
  generateStandardPracticeSet,
  evaluateScenario,
  compareInstructionRevisions,
  generateChangeDrill,
} satisfies ScenarioEngineFacade;

export type BuildApiServerDependencies = {
  sessionVerifier: SessionVerifier;
  beeGateway: BeeGateway;
  repository: FirstDayRepository;
  extractor: InstructionExtractor;
  scenarioEngine: ScenarioEngineFacade;
  clock?: () => string;
  idFactory?: () => string;
  requestIdFactory?: () => string;
  allowedOrigins?: readonly string[];
};

export type LoopbackAddress = {
  host: typeof API_LOOPBACK_HOST;
  port: number;
};

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function makeRequestId(factory: () => string): string {
  try {
    const value = factory();
    if (validRequestId(value)) return value.toLowerCase();
  } catch {
    // Error responses must stay valid even when an injected request-ID source fails.
  }
  return randomUUID();
}

function makeErrorEnvelope(factory: () => string, code: ErrorCode) {
  return errorEnvelopeSchema.parse({
    error: {
      code,
      message: API_ERROR_MESSAGE[code],
      details: {},
      requestId: makeRequestId(factory),
    },
  });
}

async function sendError(
  reply: FastifyReply,
  factory: () => string,
  code: ErrorCode,
): Promise<void> {
  await reply
    .code(API_ERROR_STATUS[code])
    .type("application/json; charset=utf-8")
    .send(makeErrorEnvelope(factory, code));
}

function sendRawError(
  response: ServerResponse,
  factory: () => string,
  code: ErrorCode,
): void {
  if (response.writableEnded) return;
  const body = JSON.stringify(makeErrorEnvelope(factory, code));
  response.statusCode = API_ERROR_STATUS[code];
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body, "utf8"));
  response.end(body);
}

function parseOutput<Output>(schema: ZodType<Output>, value: unknown): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidDependencyOutputError();
  return parsed.data;
}

async function runScenarioEngine<Output>(operation: () => Output): Promise<Awaited<Output>> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ScenarioEngineError) throw new ApiError(error.code);
    throw error;
  }
}

async function runAttemptEvaluator<Output>(operation: () => Output): Promise<Awaited<Output>> {
  try {
    return await operation();
  } catch {
    throw new InvalidDependencyOutputError();
  }
}

function bearerToken(header: string | undefined): string {
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/u.exec(header) : null;
  if (match?.[1] === undefined) throw new ApiError("UNAUTHENTICATED");
  return match[1];
}

function isCanonicalJsonContentType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^[\t ]*application\/json[\t ]*(?:;[\t ]*charset=utf-8[\t ]*)?$/iu.exec(value);
  return match?.[0] === value;
}

function hasValidRequestTargetEncoding(value: string): boolean {
  try {
    decodeURI(value);
    return true;
  } catch {
    return false;
  }
}

function isFrameworkRequestError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" && (
    code.startsWith("FST_ERR_CTP_") ||
    code === "FST_ERR_VALIDATION" ||
    code === "FST_ERR_BAD_URL"
  );
}

function ensureSourceAccess(session: LearnerSession, sourceKind: SourceKind): void {
  if (session.access === "fixtureOnly" && sourceKind !== "fixture") {
    throw new ApiError("FORBIDDEN");
  }
}

function sessionFor(
  sessions: WeakMap<FastifyRequest, LearnerSession>,
  request: FastifyRequest,
): LearnerSession {
  const session = sessions.get(request);
  if (session === undefined) throw new ApiError("UNAUTHENTICATED");
  return session;
}

function hasLiteralImportConsent(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const consent = (body as Record<string, unknown>)["consent"];
  return (
    typeof consent === "object" &&
    consent !== null &&
    !Array.isArray(consent) &&
    (consent as Record<string, unknown>)["confirmed"] === true
  );
}

function appendVaryOrigin(reply: FastifyReply): void {
  const existing = reply.getHeader("vary");
  const values = typeof existing === "string" ? existing.split(",").map((value) => value.trim()) : [];
  if (!values.some((value) => value.toLowerCase() === "origin")) values.push("Origin");
  reply.header("vary", values.join(", "));
}

function appendRawVaryOrigin(response: ServerResponse): void {
  const existing = response.getHeader("vary");
  const values = typeof existing === "string" ? existing.split(",").map((value) => value.trim()) : [];
  if (!values.some((value) => value.toLowerCase() === "origin")) values.push("Origin");
  response.setHeader("vary", values.join(", "));
}

function handleRawRouterError(input: {
  request: IncomingMessage;
  response: ServerResponse;
  dependencies: BuildApiServerDependencies;
  allowedOrigins: ReadonlySet<string>;
  requestIdFactory: () => string;
}): void {
  const { request, response, dependencies, allowedOrigins, requestIdFactory } = input;
  const path = request.url ?? "";
  const origin = request.headers.origin;
  const originAllowed = typeof origin === "string" && allowedOrigins.has(origin);

  if (originAllowed) {
    response.setHeader("access-control-allow-origin", origin);
    appendRawVaryOrigin(response);
  }

  if (request.method === "OPTIONS" && path.startsWith("/api/") && originAllowed) {
    response.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    response.setHeader("access-control-allow-headers", "Authorization, Content-Type");
    response.statusCode = 204;
    response.end();
    return;
  }

  void (async () => {
    if (path.startsWith("/api/")) {
      try {
        const token = bearerToken(request.headers.authorization);
        await dependencies.sessionVerifier.verify(token);
      } catch {
        sendRawError(response, requestIdFactory, "UNAUTHENTICATED");
        return;
      }
    }
    sendRawError(response, requestIdFactory, "VALIDATION_ERROR");
  })().catch(() => sendRawError(response, requestIdFactory, "INTERNAL_ERROR"));
}

export function buildApiServer(dependencies: BuildApiServerDependencies): ApiServer {
  const requestIdFactory = dependencies.requestIdFactory ?? randomUUID;
  const sessions = new WeakMap<FastifyRequest, LearnerSession>();
  const allowedOrigins = new Set(dependencies.allowedOrigins ?? []);
  const server = Fastify({
    bodyLimit: API_BODY_LIMIT_BYTES,
    exposeHeadRoutes: false,
    http: { maxHeaderSize: API_HEADER_LIMIT_BYTES },
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    routerOptions: {
      maxParamLength: 1_024,
      onBadUrl: (_path, request, response) => {
        handleRawRouterError({
          request,
          response,
          dependencies,
          allowedOrigins,
          requestIdFactory,
        });
      },
      onMaxParamLength: (_path, request, response) => {
        handleRawRouterError({
          request,
          response,
          dependencies,
          allowedOrigins,
          requestIdFactory,
        });
      },
    },
  });

  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const originAllowed = typeof origin === "string" && allowedOrigins.has(origin);
    if (originAllowed) {
      reply.header("access-control-allow-origin", origin);
      appendVaryOrigin(reply);
    }

    if (request.method === "OPTIONS" && request.url.startsWith("/api/") && originAllowed) {
      reply.header("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
      reply.header("access-control-allow-headers", "Authorization, Content-Type");
      await reply.code(204).send();
      return;
    }

    if (request.url.startsWith("/api/")) {
      const token = bearerToken(request.headers.authorization);
      try {
        const session = await dependencies.sessionVerifier.verify(token);
        sessions.set(request, session);
      } catch {
        throw new ApiError("UNAUTHENTICATED");
      }
    }

    if (Buffer.byteLength(request.raw.url ?? "", "utf8") > API_URL_LIMIT_BYTES) {
      throw new ApiError("VALIDATION_ERROR");
    }
    if (!hasValidRequestTargetEncoding(request.raw.url ?? "")) {
      throw new ApiError("VALIDATION_ERROR");
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const contentLength = request.headers["content-length"];
      const hasBody =
        request.headers["transfer-encoding"] !== undefined ||
        (typeof contentLength === "string" && contentLength !== "0");
      const contentType = request.headers["content-type"];
      if (hasBody && !isCanonicalJsonContentType(contentType)) {
        throw new ApiError("VALIDATION_ERROR");
      }
    }
  });

  server.setErrorHandler(async (error, _request, reply) => {
    if (reply.sent) return;
    if (error instanceof ApiError) {
      await sendError(reply, requestIdFactory, error.code);
      return;
    }
    if (isFrameworkRequestError(error)) {
      await sendError(reply, requestIdFactory, "VALIDATION_ERROR");
      return;
    }
    await sendError(reply, requestIdFactory, "INTERNAL_ERROR");
  });

  server.setNotFoundHandler(async (_request, reply) => {
    await sendError(reply, requestIdFactory, "RESOURCE_NOT_FOUND");
  });

  server.get("/health", async (request) => {
    parseRequest(healthRequestSchema, request);
    let beeBridge: "authenticated" | "unauthenticated" | "unavailable" = "unavailable";
    try {
      const health = beeBridgeHealthResponseSchema.safeParse(await dependencies.beeGateway.health());
      if (health.success) beeBridge = health.data.authenticated ? "authenticated" : "unauthenticated";
    } catch {
      beeBridge = "unavailable";
    }
    return parseOutput(healthResponseSchema, {
      ok: true,
      service: "firstday-api",
      version: API_VERSION,
      beeBridge,
    });
  });

  server.get("/api/bee/conversations", async (request) => {
    const input = parseRequest(listBeeConversationsRequestSchema, request);
    const session = sessionFor(sessions, request);
    ensureSourceAccess(session, input.sourceKind);
    const output = parseOutput(
      listBeeConversationsResponseSchema,
      await dependencies.beeGateway.listConversations(input),
    );
    if (output.items.some(({ sourceKind }) => sourceKind !== input.sourceKind)) {
      throw new InvalidDependencyOutputError();
    }
    return output;
  });

  server.get("/api/bee/conversations/:beeSourceId", async (request) => {
    const input = parseRequest(getBeeConversationRequestSchema, request);
    const session = sessionFor(sessions, request);
    ensureSourceAccess(session, input.sourceKind);
    const output = parseOutput(
      getBeeConversationResponseSchema,
      await dependencies.beeGateway.getConversation(input),
    );
    if (
      output.conversation.id !== input.beeSourceId ||
      output.conversation.sourceKind !== input.sourceKind
    ) {
      throw new InvalidDependencyOutputError();
    }
    return output;
  });

  server.post("/api/imports", async (request, reply) => {
    if (!hasLiteralImportConsent(request.body)) throw new ApiError("CONSENT_REQUIRED");
    const input = parseRequest(importConversationRequestSchema, request);
    const session = sessionFor(sessions, request);
    ensureSourceAccess(session, input.sourceKind);
    const gatewayResponse = parseOutput(
      getBeeConversationResponseSchema,
      await dependencies.beeGateway.getConversation({
        beeSourceId: input.beeSourceId,
        sourceKind: input.sourceKind,
      }),
    );
    if (
      gatewayResponse.conversation.id !== input.beeSourceId ||
      gatewayResponse.conversation.sourceKind !== input.sourceKind
    ) {
      throw new InvalidDependencyOutputError();
    }
    if (gatewayResponse.conversation.revision !== input.sourceRevision) {
      throw new ApiError("REVISION_CONFLICT");
    }
    const sourceConversation = await dependencies.repository.importSource({
      learnerId: session.learnerId,
      sourceConversationId: (dependencies.idFactory ?? randomUUID)(),
      source: gatewayResponse.conversation,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
    });
    const output = parseOutput(importConversationResponseSchema, { sourceConversation });
    return reply.code(201).send(output);
  });

  server.post(
    "/api/source-conversations/:sourceConversationId/consent/revoke",
    async (request) => {
      const input = parseRequest(revokeConsentRequestSchema, request);
      const session = sessionFor(sessions, request);
      const output = await dependencies.repository.revokeConsent({
        learnerId: session.learnerId,
        sourceConversationId: input.sourceConversationId,
        sourceRevision: input.sourceRevision,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
      });
      return parseOutput(revokeConsentResponseSchema, output);
    },
  );

  server.post(
    "/api/source-conversations/:sourceConversationId/extract",
    async (request) => {
      const input = parseRequest(extractInstructionsRequestSchema, request);
      const session = sessionFor(sessions, request);
      const context = await dependencies.repository.prepareExtraction({
        learnerId: session.learnerId,
        sourceConversationId: input.sourceConversationId,
        sourceRevision: input.sourceRevision,
      });
      const extractorContext = structuredClone(context);
      const lineage = {
        previousInstructionContextsById: structuredClone(
          context.previousInstructionContextsById,
        ),
      };
      const excludedRanges = structuredClone(input.excludedRanges);
      const allocatedRecordIds: string[] = [];
      const idFactory = dependencies.idFactory ?? randomUUID;
      const timestamp = (dependencies.clock ?? (() => new Date().toISOString()))();
      const extraction = parseOutput(
        extractInstructionsResponseSchema,
        await dependencies.extractor.extract({
          ...extractorContext,
          excludedRanges: structuredClone(excludedRanges),
          timestamp,
          idFactory: () => {
            const id = idFactory();
            allocatedRecordIds.push(id);
            return id;
          },
        }),
      );
      return parseOutput(
        extractInstructionsResponseSchema,
        await dependencies.repository.saveExtraction({
          learnerId: session.learnerId,
          sourceConversationId: input.sourceConversationId,
          sourceRevision: input.sourceRevision,
          excludedRanges,
          extraction,
          allocation: {
            recordIds: [...allocatedRecordIds],
            timestamp,
          },
          lineage,
        }),
      );
    },
  );

  server.patch("/api/instructions/:instructionId", async (request) => {
    const input = parseRequest(updateInstructionRequestSchema, request);
    const session = sessionFor(sessions, request);
    const instruction = await dependencies.repository.updateInstruction({
      learnerId: session.learnerId,
      ...input,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
    });
    return parseOutput(updateInstructionResponseSchema, { instruction });
  });

  server.post("/api/open-questions", async (request) => {
    const input = parseRequest(createOpenQuestionRequestSchema, request);
    const session = sessionFor(sessions, request);
    const openQuestion = await dependencies.repository.createOpenQuestion({
      learnerId: session.learnerId,
      openQuestionId: (dependencies.idFactory ?? randomUUID)(),
      ...input,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
    });
    return parseOutput(createOpenQuestionResponseSchema, { openQuestion });
  });

  server.patch("/api/open-questions/:openQuestionId", async (request) => {
    const input = parseRequest(updateOpenQuestionRequestSchema, request);
    const session = sessionFor(sessions, request);
    const openQuestion = await dependencies.repository.updateOpenQuestion({
      learnerId: session.learnerId,
      ...input,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
    });
    return parseOutput(updateOpenQuestionResponseSchema, { openQuestion });
  });

  server.post("/api/practice-sets", async (request, reply) => {
    const input = parseRequest(createPracticeSetRequestSchema, request);
    const session = sessionFor(sessions, request);
    const context = await dependencies.repository.prepareStandardPractice({
      learnerId: session.learnerId,
      ...input,
    });
    const idFactory = dependencies.idFactory ?? randomUUID;
    const allocation = {
      practiceSetId: idFactory(),
      scenarioIds: Array.from({ length: 3 }, () => idFactory()),
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
    };
    const generation = parseOutput(
      createPracticeSetResponseSchema,
      await runScenarioEngine(() => dependencies.scenarioEngine.generateStandardPracticeSet({
        ...context,
        title: input.title,
        ...allocation,
        scenarioIds: [...allocation.scenarioIds],
      })),
    );
    const output = parseOutput(
      createPracticeSetResponseSchema,
      await dependencies.repository.saveStandardPractice({
        learnerId: session.learnerId,
        request: input,
        generation,
        allocation,
      }),
    );
    return reply.code(201).send(output);
  });

  server.get("/api/practice-sets/:practiceSetId", async (request) => {
    const input = parseRequest(getPracticeSetRequestSchema, request);
    const session = sessionFor(sessions, request);
    return parseOutput(
      getPracticeSetResponseSchema,
      await dependencies.repository.getPracticeSet({
        learnerId: session.learnerId,
        practiceSetId: input.practiceSetId,
      }),
    );
  });

  server.post("/api/scenarios/:scenarioId/attempts", async (request) => {
    const input = parseRequest(createAttemptRequestSchema, request);
    const session = sessionFor(sessions, request);
    const context = await dependencies.repository.prepareAttempt({
      learnerId: session.learnerId,
      ...input,
    });
    const evaluation = await runAttemptEvaluator(() =>
      dependencies.scenarioEngine.evaluateScenario({
        scenario: structuredClone(context.scenario),
        responseText: input.responseText,
        instructions: structuredClone(context.instructions),
        sourceEvidence: structuredClone(context.sourceEvidence),
        ...(context.changeProposal === undefined
          ? {}
          : { changeProposal: structuredClone(context.changeProposal) }),
      }),
    );
    return parseOutput(
      createAttemptResponseSchema,
      await dependencies.repository.saveAttempt({
        learnerId: session.learnerId,
        ...input,
        attemptId: (dependencies.idFactory ?? randomUUID)(),
        timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
        evaluation,
      }),
    );
  });

  server.post("/api/source-conversations/:sourceConversationId/compare", async (request) => {
    const input = parseRequest(compareSourceRequestSchema, request);
    return parseOutput(compareSourceResponseSchema, await dependencies.repository.compareSources({
      ...input, learnerId: sessionFor(sessions, request).learnerId,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
      idFactory: dependencies.idFactory ?? randomUUID,
    }));
  });
  server.post("/api/changes/:changeId/confirm", async (request) => {
    const input = parseRequest(confirmChangeRequestSchema, request);
    const idFactory = dependencies.idFactory ?? randomUUID;
    return parseOutput(confirmChangeResponseSchema, await dependencies.repository.confirmChange({
      ...input, learnerId: sessionFor(sessions, request).learnerId,
      timestamp: (dependencies.clock ?? (() => new Date().toISOString()))(),
      practiceSetId: idFactory(), scenarioId: idFactory(),
    }));
  });

  for (const method of ["POST", "PATCH"] as const) {
    server.route({
      method,
      url: "/api/*",
      handler: async (request, reply) => {
        flattenRequest(request);
        await sendError(reply, requestIdFactory, "RESOURCE_NOT_FOUND");
      },
    });
  }

  return server;
}

export async function listenOnLoopback(server: ApiServer, port: number): Promise<LoopbackAddress> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new ApiError("INVALID_STATE");
  }
  await server.listen({ host: API_LOOPBACK_HOST, port });
  const address = server.server.address();
  if (address === null || typeof address === "string" || address.address !== API_LOOPBACK_HOST) {
    await server.close();
    throw new ApiError("INTERNAL_ERROR");
  }
  return { host: API_LOOPBACK_HOST, port: address.port };
}
