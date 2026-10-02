import {expoEnvironment} from "./launcher-config.mjs";
import { spawn } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expoDirectory = dirname(require.resolve("expo/package.json"));
const mobileEnvironment = expoEnvironment(process.env,{});
const devicePreview = process.argv.includes("--ios-device");
const child = spawn(process.execPath, [resolve(expoDirectory, "bin/cli"), "start", ...(devicePreview ? ["--lan"] : ["--web", "--localhost"]), "--port", devicePreview ? "8084" : "8081"], {
  cwd: resolve(projectRoot, "apps/mobile"),
  env: { ...mobileEnvironment, EXPO_NO_DOTENV: "1", EXPO_PUBLIC_FIRSTDAY_DATA_MODE: "fixture", EXPO_PUBLIC_FIRSTDAY_AI_MODE: "offline" },
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => { process.stderr.write(`Could not start the synthetic demo: ${error.message}\n`); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
