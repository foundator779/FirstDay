// FirstDay Go AI endpoint: AWS Lambda behind a Function URL, Amazon Bedrock (Nova Pro) via the
// function's IAM role, Amazon Cognito access tokens required. Pay-per-request: nothing runs or
// bills while nobody is using it. Packaged with ../../brain/ai.mjs and ../../brain/cognito.mjs
// (copied next to this file by infra/deploy.sh).
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { aiHandlers, converseRequest, toolResult } from "./ai.mjs";
import { cognitoVerifier } from "./cognito.mjs";

const MODEL = process.env.BEDROCK_MODEL_ID || "us.amazon.nova-pro-v1:0";
const PER_USER_PER_HOUR = Number(process.env.PER_USER_PER_HOUR || 120);
const client = new BedrockRuntimeClient({});
const verify = cognitoVerifier({ poolId: process.env.COGNITO_POOL_ID, clientId: process.env.COGNITO_CLIENT_ID });
const ai = aiHandlers(async (task, data, schema) => {
  const r = await client.send(new ConverseCommand({ modelId: MODEL, ...converseRequest(task, data, schema) }));
  return toolResult(r.output);
});

const routes = { "POST /analyze": ai.analyze, "POST /ask": ai.ask, "POST /steps": ai.steps, "POST /grade": ai.grade };

// Soft per-user limit (per warm instance) so a stuck client can't run up Bedrock costs.
const usage = new Map();
function allowed(user) {
  const hour = Math.floor(Date.now() / 3600_000);
  const u = usage.get(user);
  const count = u && u.hour === hour ? u.count + 1 : 1;
  usage.set(user, { hour, count });
  return count <= PER_USER_PER_HOUR;
}

const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";
  if (method === "GET" && path === "/health") return reply(200, { ok: true, ai: true });
  const user = await verify(event.headers?.authorization ?? event.headers?.Authorization);
  if (!user) return reply(401, { error: "Sign in required" });
  const route = routes[`${method} ${path}`];
  if (!route) return reply(404, { error: "Not found" });
  if (!allowed(user)) return reply(429, { error: "Too many requests. Try again later." });
  let body = {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    if (raw.length > 400_000) return reply(413, { error: "Too big" });
    body = JSON.parse(raw || "{}") ?? {};
  } catch {
    return reply(400, { error: "Bad JSON" });
  }
  try {
    return reply(200, await route(body));
  } catch (e) {
    // Never log transcripts or answers; the error name is enough to debug.
    console.error(`${path} failed: ${e?.name ?? "Error"}`);
    return reply(502, { error: "AI request failed" });
  }
};
