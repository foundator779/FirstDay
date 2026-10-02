import { uuidSchema } from "@firstday/contracts";

import { supabaseOrigin } from "./auth.js";
import { ApiError } from "./errors.js";
import { readBedrockConfig, type BedrockConfig } from "./bedrock.js";

export const DEFAULT_API_PORT = 3_000;
export const DEFAULT_API_ALLOWED_ORIGINS = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
] as const;

type FixtureAuthConfig = {
  kind: "fixture";
  token: string;
  learnerId: string;
};

type SupabaseAuthConfig = {
  kind: "supabase";
  supabaseUrl: string;
  anonKey: string;
  allowLocalHttp?:boolean;
  nodeEnv?:string;
};

export type ApiRuntimeConfig = {
  ownerId?:string;
  storage?: { kind: "supabase"; supabaseUrl: string; serviceRoleKey: string };
  bedrock?: BedrockConfig;
  dataMode: "fixture" | "live";
  port: number;
  allowedOrigins: string[];
  bridgeBaseUrl: string;
  bridgeToken: string;
  auth: FixtureAuthConfig | SupabaseAuthConfig;
};

function required(value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.trim() !== value) {
    throw new ApiError("INVALID_STATE");
  }
  return value;
}

function port(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new ApiError("INVALID_STATE");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new ApiError("INVALID_STATE");
  }
  return parsed;
}

function exactOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError("INVALID_STATE");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new ApiError("INVALID_STATE");
  }
  return value;
}

function allowedOrigins(value: string | undefined): string[] {
  const values = value === undefined ? [...DEFAULT_API_ALLOWED_ORIGINS] : value.split(",");
  const parsed = values.map((origin) => exactOrigin(origin));
  if (new Set(parsed).size !== parsed.length) throw new ApiError("INVALID_STATE");
  return parsed;
}

export function readApiRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApiRuntimeConfig {
  if (
    environment["FIRSTDAY_API_HOST"] !== undefined &&
    environment["FIRSTDAY_API_HOST"] !== "127.0.0.1"
  ) {
    throw new ApiError("INVALID_STATE");
  }

  const rawDataMode = environment["FIRSTDAY_DATA_MODE"];
  if (rawDataMode !== "fixture" && rawDataMode !== "live") {
    throw new ApiError("INVALID_STATE");
  }
  const dataMode: "fixture" | "live" = rawDataMode;
  const localHttp = environment["FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP"] === "1" && environment["NODE_ENV"] === "development";
  const storageMode = environment["FIRSTDAY_STORAGE_MODE"] ?? (dataMode === "live" ? "supabase" : "memory");
  if ((storageMode !== "memory" && storageMode !== "supabase") || (dataMode === "live" && storageMode !== "supabase")) throw new ApiError("INVALID_STATE");
  const storage = storageMode === "supabase" ? { kind: "supabase" as const, supabaseUrl: required(environment["SUPABASE_URL"]), serviceRoleKey: required(environment["SUPABASE_SERVICE_ROLE_KEY"]) } : undefined;
  if (storage !== undefined) {
    const origin = supabaseOrigin(storage.supabaseUrl, localHttp, environment["NODE_ENV"]);
    if (dataMode === "fixture" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) {
      throw new ApiError("INVALID_STATE");
    }
  }
  if (storage !== undefined && (storage.serviceRoleKey === environment["SUPABASE_ANON_KEY"] || storage.serviceRoleKey === environment["FIRSTDAY_BEE_BRIDGE_TOKEN"])) throw new ApiError("INVALID_STATE");
  const bedrock = readBedrockConfig(environment);
  if(dataMode==="live"&&bedrock===undefined)throw new ApiError("INVALID_STATE");
  const bridgeToken = required(environment["FIRSTDAY_BEE_BRIDGE_TOKEN"]);
  const bridgePort = port(environment["FIRSTDAY_BEE_BRIDGE_PORT"], 3_100);
  if (bridgePort === 0) throw new ApiError("INVALID_STATE");

  const shared = {
    ...(storage === undefined ? {} : { storage }),
    ...(bedrock === undefined ? {} : { bedrock }),
    dataMode,
    port: port(environment["FIRSTDAY_API_PORT"], DEFAULT_API_PORT),
    allowedOrigins: allowedOrigins(environment["FIRSTDAY_API_ALLOWED_ORIGINS"]),
    bridgeBaseUrl: `http://127.0.0.1:${bridgePort}`,
    bridgeToken,
  };

  if (dataMode === "fixture") {
    if (environment["NODE_ENV"] === "production") throw new ApiError("INVALID_STATE");
    const token = required(environment["FIRSTDAY_DEMO_SESSION_TOKEN"]);
    if (token === bridgeToken) throw new ApiError("INVALID_STATE");
    return {
      ...shared,
      auth: {
        kind: "fixture",
        token,
        learnerId: uuidSchema.parse(required(environment["FIRSTDAY_DEMO_LEARNER_ID"])),
      },
    };
  }

  return {
    ...shared,
    ownerId:uuidSchema.parse(required(environment["FIRSTDAY_BEE_OWNER_ID"])),
    auth: {
      ...(localHttp?{allowLocalHttp:true,nodeEnv:"development"}:{}),
      kind: "supabase",
      supabaseUrl: required(environment["SUPABASE_URL"]),
      anonKey: required(environment["SUPABASE_ANON_KEY"]),
    },
  };
}
