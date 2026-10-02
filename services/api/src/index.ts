import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSupabaseAuthBroker,
  createFixtureSessionVerifier,
  createSupabaseSessionVerifier,
  type FetchImplementation,
} from "./auth.js";
import { createHttpBeeGateway, type BeeGateway } from "./bee-gateway.js";
import {
  DEFAULT_API_PORT,
  readApiRuntimeConfig,
  type ApiRuntimeConfig,
} from "./config.js";
import { createFixtureInstructionExtractor } from "./extraction.js";
import { createBedrockProvider } from "./bedrock.js";
import { createMemoryRepository } from "./memory-repository.js";
import { createSupabaseRepository } from "./supabase-repository.js";
import {
  buildApiServer,
  deterministicScenarioEngine,
  listenOnLoopback,
  type ApiServer,
  type LoopbackAddress,
} from "./server.js";

export * from "./auth.js";
export * from "./bee-gateway.js";
export * from "./config.js";
export * from "./errors.js";
export * from "./extraction.js";
export * from "./memory-repository.js";
export * from "./repository.js";
export * from "./server.js";

export const API_START_FAILURE_MESSAGE = "FirstDay API failed to start.";

export type ProductionApiOptions = {
  beeGateway?: BeeGateway;
  bedrockFetchImplementation?: typeof fetch;
  fetchImplementation?: FetchImplementation;
  requestIdFactory?: () => string;
  idFactory?: () => string;
  clock?: () => string;
};

export type StartedApi = {
  server: ApiServer;
  address: LoopbackAddress;
};

export function createProductionApiServer(
  config: ApiRuntimeConfig,
  options: ProductionApiOptions = {},
): ApiServer {
  if(config.dataMode==="live"&&(config.auth.kind!=="supabase"||config.storage===undefined||config.bedrock===undefined||config.ownerId===undefined))throw new Error(API_START_FAILURE_MESSAGE);
  const fetchImplementation = options.fetchImplementation;
  const sessionVerifier = config.auth.kind === "fixture"
    ? createFixtureSessionVerifier({ token: config.auth.token, learnerId: config.auth.learnerId })
    : createSupabaseSessionVerifier({
        ...config.auth,
        ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
      });
  const beeGateway = options.beeGateway ?? createHttpBeeGateway({
    baseUrl: config.bridgeBaseUrl,
    bearerToken: config.bridgeToken,
    ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
  });
  const bedrock = config.bedrock === undefined ? undefined : createBedrockProvider(config.bedrock,
    options.bedrockFetchImplementation === undefined ? {} : { fetchImplementation: options.bedrockFetchImplementation });
  return buildApiServer({
    ...(config.auth.kind==="supabase"&&config.ownerId!==undefined?{ownerId:config.ownerId,authBroker:createSupabaseAuthBroker({...config.auth,ownerId:config.ownerId,...(fetchImplementation===undefined?{}:{fetchImplementation})})}:{}),
    sessionVerifier,
    beeGateway,
    repository: config.storage === undefined ? createMemoryRepository({ groundedExtraction: bedrock !== undefined }) : createSupabaseRepository({ ...config.storage, groundedExtraction: bedrock !== undefined, ...(fetchImplementation === undefined ? {} : { fetchImplementation }) }),
    ...(bedrock ? {understandingComparator:bedrock.compareUnderstanding,understandingInitialComparator:bedrock.compareUnderstandingInitial}:{}),
    extractor: bedrock?.extractor ?? createFixtureInstructionExtractor(),
    scenarioEngine: bedrock === undefined ? deterministicScenarioEngine : {
      ...deterministicScenarioEngine,
      generateStandardPracticeSet: bedrock.generateStandardPracticeSet,
      evaluateScenario: bedrock.evaluateScenario,
    },
    allowedOrigins: config.allowedOrigins,
    clock: options.clock ?? (() => new Date().toISOString()),
    idFactory: options.idFactory ?? randomUUID,
    ...(options.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: options.requestIdFactory }),
  });
}

export async function startProductionApi(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: ProductionApiOptions = {},
): Promise<StartedApi> {
  const config = readApiRuntimeConfig(environment);
  const server = createProductionApiServer(config, options);
  try {
    const address = await listenOnLoopback(server, config.port);
    return { server, address };
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

export function isDirectExecution(moduleUrl: string, entryPath: string | undefined): boolean {
  if (entryPath === undefined) return false;
  try {
    return fileURLToPath(moduleUrl) === resolve(entryPath);
  } catch {
    return false;
  }
}

async function runDirect(): Promise<void> {
  try {
    await startProductionApi();
  } catch {
    process.stderr.write(`${API_START_FAILURE_MESSAGE}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runDirect();
}

export { DEFAULT_API_PORT };
