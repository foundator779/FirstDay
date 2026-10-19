// Lambda entry for the FirstDay Bee service (see app.mjs). Packaged by infra/deploy-bee.sh with
// ../../brain/bee.mjs, ../../brain/cognito.mjs and the Bee CLI's Linux x64 program (npm @beeai/cli).
import { cognitoVerifier } from "./cognito.mjs";
import * as bee from "./bee.mjs";
import { createApp } from "./app.mjs";
import { dynamoStore } from "./store.mjs";

const list = (v) => new Set(String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const allowedIds = list(process.env.ALLOWED_USER_IDS);
const allowedEmails = list(process.env.ALLOWED_EMAILS);
const openToEveryone = process.env.OPEN_TO_EVERYONE === "true";
const region = String(process.env.COGNITO_POOL_ID || "us-east-1_").split("_")[0];

// Allowed by email: ask Cognito who this access token belongs to (GetUser needs only the token itself).
const emailOf = new Map();
async function emailFor(user, authorization) {
  if (emailOf.has(user)) return emailOf.get(user);
  const token = /^Bearer\s+(.+)$/i.exec(String(authorization || ""))?.[1];
  if (!token) return "";
  try {
    const r = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSCognitoIdentityProviderService.GetUser" },
      body: JSON.stringify({ AccessToken: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return "";
    const j = await r.json();
    const attr = (j.UserAttributes || []).find((a) => a.Name === "email" && a.Value);
    const verified = (j.UserAttributes || []).find((a) => a.Name === "email_verified")?.Value === "true";
    const email = attr && verified ? String(attr.Value).toLowerCase() : "";
    if (email) emailOf.set(user, email);
    return email;
  } catch {
    return "";
  }
}

export const handler = createApp({
  store: dynamoStore(process.env.TABLE_NAME),
  verify: cognitoVerifier({ poolId: process.env.COGNITO_POOL_ID, clientId: process.env.COGNITO_CLIENT_ID }),
  bee,
  beePath: process.env.BEE_CLI_PATH,
  allowed: async (user, authorization) =>
    openToEveryone || allowedIds.has(user.toLowerCase()) || (allowedEmails.size > 0 && allowedEmails.has(await emailFor(user, authorization))),
  log: (m) => console.log(m),
});
