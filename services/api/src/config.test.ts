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

  it("separates Supabase public auth from server-only durable storage", () => {
    const config = readApiRuntimeConfig({
      NODE_ENV: "production",
      FIRSTDAY_DATA_MODE: "live",
      FIRSTDAY_BEE_OWNER_ID: LEARNER_ID,
      FIRSTDAY_AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "ABSKfictional",
      FIRSTDAY_BEE_BRIDGE_TOKEN: BRIDGE_TOKEN,
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-database-key",
    });

    expect(config.port).toBe(DEFAULT_API_PORT);
    expect(config.auth).toEqual({
      kind: "supabase",
      supabaseUrl: "https://project.supabase.co",
      anonKey: "public-anon-key",
    });
    expect(config.ownerId).toBe(LEARNER_ID);
    expect(config.storage).toEqual({ kind: "supabase", supabaseUrl: "https://project.supabase.co", serviceRoleKey: "server-only-database-key" });
    expect(JSON.stringify(config.auth)).not.toContain("server-only-database-key");
  });

  it.each([{}, { FIRSTDAY_STORAGE_MODE: "memory" }, { SUPABASE_SERVICE_ROLE_KEY: "public-anon-key" }, { FIRSTDAY_STORAGE_MODE: "unknown" }])("fails closed for live persistence configuration %#", (overrides) => {
    expect(() => readApiRuntimeConfig({ FIRSTDAY_DATA_MODE: "live", FIRSTDAY_BEE_BRIDGE_TOKEN: BRIDGE_TOKEN, SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-anon-key", ...overrides })).toThrow();
  });

  it.each([
    { NODE_ENV: "production", FIRSTDAY_DATA_MODE: "fixture" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_HOST: "0.0.0.0" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_ALLOWED_ORIGINS: "http://localhost:8081/path" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_API_ALLOWED_ORIGINS: "http://localhost:8081,http://localhost:8081" },
    { NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_DEMO_SESSION_TOKEN: BRIDGE_TOKEN },
    { FIRSTDAY_STORAGE_MODE: "supabase", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-database-key" },
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

const liveEnvironment={NODE_ENV:'development',FIRSTDAY_DATA_MODE:'live',FIRSTDAY_BEE_OWNER_ID:LEARNER_ID,FIRSTDAY_BEE_BRIDGE_TOKEN:BRIDGE_TOKEN,FIRSTDAY_AI_PROVIDER:'bedrock',AWS_BEARER_TOKEN_BEDROCK:'ABSKfictional',SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
it.each([{FIRSTDAY_BEE_OWNER_ID:undefined},{FIRSTDAY_BEE_OWNER_ID:'email@example.invalid'},{FIRSTDAY_AI_PROVIDER:'fixture'},{SUPABASE_URL:'http://127.0.0.1:55321'},{SUPABASE_URL:'http://127.1:55321',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1'},{SUPABASE_URL:'http://localhost.evil:55321',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1'},{SUPABASE_URL:'http://127.0.0.1:55321',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1',NODE_ENV:'production'},{SUPABASE_URL:'https://project.supabase.co?x=1'}])('rejects missing owner/provider or unsafe origins %#',overrides=>{expect(()=>readApiRuntimeConfig({...liveEnvironment,...overrides})).toThrow();});
it('permits only explicit genuine development loopback Supabase HTTP',()=>{const config=readApiRuntimeConfig({...liveEnvironment,SUPABASE_URL:'http://127.0.0.1:55321',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1'});expect(config.auth).toMatchObject({supabaseUrl:'http://127.0.0.1:55321',allowLocalHttp:true,nodeEnv:'development'});});


describe('fixture runtime Supabase storage origin', () => {
  const environment: Record<string,string|undefined> = {
    NODE_ENV:'development',FIRSTDAY_DATA_MODE:'fixture',FIRSTDAY_STORAGE_MODE:'supabase',
    FIRSTDAY_DEMO_SESSION_TOKEN:'public-fixture-token',FIRSTDAY_DEMO_LEARNER_ID:LEARNER_ID,
    FIRSTDAY_BEE_BRIDGE_TOKEN:BRIDGE_TOKEN,SUPABASE_URL:'http://127.0.0.1:55321',
    SUPABASE_SERVICE_ROLE_KEY:'fictional-server-storage-key',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1',
  };
  it.each([
    {NODE_ENV:undefined},{NODE_ENV:'test'},{NODE_ENV:'production'},
    {FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:undefined},{FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'0'},
    {SUPABASE_URL:'http://127.1:55321'},{SUPABASE_URL:'http://2130706433:55321'},
    {SUPABASE_URL:'http://0x7f000001:55321'},{SUPABASE_URL:'http://%6cocalhost:55321'},
    {SUPABASE_URL:'http://localhost.evil:55321'},{SUPABASE_URL:'http://localhost.:55321'},
    {SUPABASE_URL:'http://127.0.0.1:55321/path'},
    {SUPABASE_URL:'http://fictional:password@127.0.0.1:55321'},
    {SUPABASE_URL:'http://127.0.0.1:55321?fictional=1'},
    {SUPABASE_URL:'http://127.0.0.1:55321#fictional'},
    {SUPABASE_URL:'https://hosted.example'},
  ])('rejects unsafe fixture storage configuration %#', overrides => {
    expect(()=>readApiRuntimeConfig({...environment,...overrides})).toThrow();
  });
  it.each(['http://127.0.0.1:55321','http://localhost:55321','http://[::1]:55321'])('accepts explicit genuine development loopback %s', supabaseUrl => {
    expect(readApiRuntimeConfig({...environment,SUPABASE_URL:supabaseUrl}).storage).toEqual({kind:'supabase',supabaseUrl,serviceRoleKey:'fictional-server-storage-key'});
  });
  it('accepts exact loopback HTTPS without permitting hosted fixture storage',()=>{
    expect(readApiRuntimeConfig({...environment,SUPABASE_URL:'https://localhost:55321',NODE_ENV:'test',FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:undefined}).storage?.supabaseUrl).toBe('https://localhost:55321');
  });
});
