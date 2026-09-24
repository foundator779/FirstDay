import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  beeSourceSchema,
  type BeeAdapterRegistry,
  type BeeSource,
} from "@firstday/contracts";

import {
  BeeBridgeError,
  createBeeCliAdapter,
  createFixtureBeeAdapter,
  createNodeBeeCliRunner,
  type BeeCliRunner,
} from "./adapter.js";
import {
  buildBridgeServer,
  listenOnLoopback,
  validateBridgeBearerToken,
  type BridgeServer,
  type LoopbackAddress,
} from "./server.js";

export * from "./adapter.js";
export * from "./server.js";

export const DEFAULT_BEE_BRIDGE_PORT = 3_100;
export const BRIDGE_START_FAILURE_MESSAGE = "FirstDay Bee bridge failed to start.";

const BOOKSHOP_FIXTURE_URLS = [
  new URL("../../../fixtures/transcripts/bookshop-onboarding.json", import.meta.url),
  new URL("../../../fixtures/transcripts/bookshop-policy-update.json", import.meta.url),
] as const;

const BEE_CHILD_RUNTIME_KEYS = new Set([
  "ALL_PROXY",
  "APPDATA",
  "COMSPEC",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

export type BridgeRuntimeConfig = {
  bearerToken: string;
  port: number;
  beeCliPath: string;
};

export type ProductionBridgeOptions = {
  environment?: Readonly<Record<string, string | undefined>>;
  runner?: BeeCliRunner;
  requestIdFactory?: () => string;
};

export type StartedBridge = {
  server: BridgeServer;
  address: LoopbackAddress;
};

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_BEE_BRIDGE_PORT;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return port;
}

function parseBeeCliPath(value: string | undefined): string {
  if (value === undefined) {
    return "bee";
  }
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return value;
}

/** Builds a least-privilege environment for the Bee subprocess. */
export function createBeeCliChildEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    const isBeeOwned = key.startsWith("BEE_") && key !== "BEE_CLI_PATH";
    const isLocale = key.startsWith("LC_");
    if (
      typeof value === "string" &&
      (BEE_CHILD_RUNTIME_KEYS.has(key) || isBeeOwned || isLocale)
    ) {
      childEnvironment[key] = value;
    }
  }
  return childEnvironment;
}

/** Reads only server-side runtime variables and validates them before startup. */
export function readBridgeRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BridgeRuntimeConfig {
  const bearerToken = environment["FIRSTDAY_BEE_BRIDGE_TOKEN"];
  validateBridgeBearerToken(bearerToken);
  return {
    bearerToken,
    port: parsePort(environment["FIRSTDAY_BEE_BRIDGE_PORT"]),
    beeCliPath: parseBeeCliPath(environment["BEE_CLI_PATH"]),
  };
}

/** Loads only checked-in, redacted fixture sources and revalidates their contract. */
export async function loadBookshopFixtureSources(): Promise<BeeSource[]> {
  const sources: BeeSource[] = [];
  for (const url of BOOKSHOP_FIXTURE_URLS) {
    try {
      const raw = JSON.parse(await readFile(url, "utf8")) as unknown;
      const parsed = beeSourceSchema.safeParse(raw);
      if (!parsed.success || parsed.data.sourceKind !== "fixture") {
        throw new BeeBridgeError("INTERNAL_ERROR");
      }
      sources.push(parsed.data);
    } catch (error) {
      if (error instanceof BeeBridgeError) {
        throw error;
      }
      throw new BeeBridgeError("INTERNAL_ERROR");
    }
  }
  return sources;
}

/** Constructs both canonical adapters and the HTTP handler without listening. */
export async function createProductionBridgeServer(
  config: BridgeRuntimeConfig,
  options: ProductionBridgeOptions = {},
): Promise<BridgeServer> {
  validateBridgeBearerToken(config.bearerToken);
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const beeCliPath = parseBeeCliPath(config.beeCliPath);
  const fixtureSources = await loadBookshopFixtureSources();
  const runner = options.runner ?? createNodeBeeCliRunner({
    executable: beeCliPath,
    env: createBeeCliChildEnvironment(options.environment),
  });
  const registry: BeeAdapterRegistry = {
    bee: createBeeCliAdapter(runner),
    fixture: createFixtureBeeAdapter(fixtureSources),
  };
  return buildBridgeServer({
    registry,
    bearerToken: config.bearerToken,
    ...(options.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: options.requestIdFactory }),
  });
}

/** Builds and starts the production bridge at fixed IPv4 loopback. */
export async function startProductionBridge(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: ProductionBridgeOptions = {},
): Promise<StartedBridge> {
  const config = readBridgeRuntimeConfig(environment);
  const server = await createProductionBridgeServer(config, { ...options, environment });
  try {
    const address = await listenOnLoopback(server, config.port);
    return { server, address };
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

export function isDirectExecution(
  moduleUrl: string,
  entryPath: string | undefined,
): boolean {
  if (entryPath === undefined) {
    return false;
  }
  try {
    return fileURLToPath(moduleUrl) === resolve(entryPath);
  } catch {
    return false;
  }
}

async function runDirect(): Promise<void> {
  try {
    await startProductionBridge();
  } catch {
    process.stderr.write(`${BRIDGE_START_FAILURE_MESSAGE}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runDirect();
}
