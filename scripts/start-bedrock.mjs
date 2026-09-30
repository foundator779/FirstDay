import {expoEnvironment} from "./launcher-config.mjs";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers/promises";
import { parseEnv } from "node:util";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
// Shared filtering also strips arbitrary inherited public sentinels.
const common = expoEnvironment(process.env,{});
const port = "8083";
const apiPort = "3001";
const sessionToken = randomBytes(32).toString("hex");
const apiEnv = { ...process.env, ...local, NODE_ENV: "development", FIRSTDAY_DATA_MODE: "fixture", FIRSTDAY_AI_PROVIDER: "bedrock", FIRSTDAY_API_PORT: apiPort,
  FIRSTDAY_DEMO_SESSION_TOKEN: sessionToken,
  FIRSTDAY_BEE_BRIDGE_TOKEN: local.FIRSTDAY_BEE_BRIDGE_TOKEN || randomBytes(32).toString("hex"),
  FIRSTDAY_API_ALLOWED_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}` };
const api = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "services/api/src/demo-server.ts"], { cwd: root, env: apiEnv, stdio: "inherit", windowsHide: true });
let mobile;
let stopping = false;
function stop() { if (stopping) return; stopping = true; api.kill(); mobile?.kill(); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
api.once("exit", (code) => { if (!stopping) { process.exitCode = code || 1; stop(); } });
api.once("error", () => { process.stderr.write("Could not start the API process.\n"); stop(); process.exitCode = 1; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
    try { const response = await globalThis.fetch(`http://127.0.0.1:${apiPort}/api/bee/conversations?sourceKind=fixture&limit=20`, { headers: { authorization: `Bearer ${sessionToken}` }, signal: globalThis.AbortSignal.timeout(1000) }); ready = response.ok; } catch { /* Startup can take a few seconds. */ }
    if (ready) break;
    await setTimeout(250);
  }
  if (!ready) throw new Error("API startup failed");
  mobile = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/expo/bin/cli", import.meta.url)), "start", "--web", "--localhost", "--port", port], {
    cwd: fileURLToPath(new URL("../apps/mobile/", import.meta.url)),
    env: { ...common, EXPO_NO_DOTENV: "1", EXPO_PUBLIC_FIRSTDAY_DATA_MODE: "fixture", EXPO_PUBLIC_FIRSTDAY_AI_MODE: "bedrock", EXPO_PUBLIC_FIRSTDAY_API_URL: `http://127.0.0.1:${apiPort}`, EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN: sessionToken }, stdio: "inherit", windowsHide: true,
  });
  mobile.once("exit", (code) => { if (!stopping) { process.exitCode = code || 0; stop(); } });
  mobile.once("error", () => { process.stderr.write("Could not start Expo.\n"); stop(); process.exitCode = 1; });
} catch { process.stderr.write("Bedrock demo could not start. Check the local environment and ports 3001/8083.\n"); stop(); process.exitCode = 1; }
