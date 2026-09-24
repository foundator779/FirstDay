import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  API_START_FAILURE_MESSAGE,
  DEFAULT_API_PORT,
  isDirectExecution,
  readApiRuntimeConfig,
} from "./index.js";

const BRIDGE_TOKEN = "bridge-token-that-is-at-least-32-characters";
const LEARNER_ID = "70000000-0000-4000-8000-000000000001";

describe("API runtime configuration", () => {
  it("loads explicit non-production fixture auth and exact origins", () => {
    const config = readApiRuntimeConfig({
      NODE_ENV: "development",
      FIRSTDAY_DATA_MODE: "fixture",
      FIRSTDAY_API_HOST: "127.0.0.1",
      FIRSTDAY_API_PORT: "0",
      FIRSTDAY_API_ALLOWED_ORIGINS: "http://localhost:8081,https://demo.example",
      FIRSTDAY_BEE_BRIDGE_PORT: "3100",
      FIRSTDAY_BEE_BRIDGE_TOKEN: BRIDGE_TOKEN,
      FIRSTDAY_DEMO_SESSION_TOKEN: "public-demo-token",
      FIRSTDAY_DEMO_LEARNER_ID: LEARNER_ID,
    });

    expect(config).toEqual({
      dataMode: "fixture",
      port: 0,
      allowedOrigins: ["http://localhost:8081", "https://demo.example"],
      bridgeBaseUrl: "http://127.0.0.1:3100",
      bridgeToken: BRIDGE_TOKEN,
      auth: {
        kind: "fixture",
        token: "public-demo-token",
        learnerId: LEARNER_ID,
      },
    });
  });

  it("loads hosted Supabase Auth without accepting a service-role credential", () => {
    const config = readApiRuntimeConfig({
      NODE_ENV: "production",
      FIRSTDAY_DATA_MODE: "live",
      FIRSTDAY_BEE_BRIDGE_TOKEN: BRIDGE_TOKEN,
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-be-read",
    });

    expect(config.port).toBe(DEFAULT_API_PORT);
    expect(config.auth).toEqual({
      kind: "supabase",
      supabaseUrl: "https://project.supabase.co",
      anonKey: "public-anon-key",
    });
    expect(JSON.stringify(config)).not.toContain("must-not-be-read");
  });

  it.each([
    { NODE_ENV: "production", FIRSTDAY_DATA_MODE: "fixture" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_HOST: "0.0.0.0" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_ALLOWED_ORIGINS: "http://localhost:8081/path" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_ALLOWED_ORIGINS: "http://localhost:8081,http://localhost:8081" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_DEMO_SESSION_TOKEN: BRIDGE_TOKEN },
  ])("rejects unsafe fixture configuration %#", (overrides) => {
    const environment: Record<string, string | undefined> = {
      NODE_ENV: "development",
      FIRSTDAY_DATA_MODE: "fixture",
      FIRSTDAY_BEE_BRIDGE_TOKEN: BRIDGE_TOKEN,
      FIRSTDAY_DEMO_SESSION_TOKEN: "public-demo-token",
      FIRSTDAY_DEMO_LEARNER_ID: LEARNER_ID,
    };
    Object.assign(environment, overrides);
    expect(() => readApiRuntimeConfig(environment)).toThrow();
  });

  it("exposes a stable safe direct-start failure message and direct-entry check", () => {
    expect(API_START_FAILURE_MESSAGE).toBe("FirstDay API failed to start.");
    expect(API_START_FAILURE_MESSAGE).not.toContain(BRIDGE_TOKEN);
    const entry = resolve("tmp", "api", "index.js");
    expect(isDirectExecution(pathToFileURL(entry).href, entry)).toBe(true);
    expect(isDirectExecution(pathToFileURL(entry).href, resolve("tmp", "api", "other.js"))).toBe(false);
  });
});
