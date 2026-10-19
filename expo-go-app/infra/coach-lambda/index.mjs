// Lambda entry for the FirstDay coach service (see app.mjs). Packaged by infra/deploy-coach.sh together with
// ../../brain/coach.mjs (the shared coach logic) and ../../brain/cognito.mjs (the token check).
import { cognitoIdVerifier, cognitoVerifier } from "./cognito.mjs";
import { createCoach } from "./app.mjs";
import { dynamoStore } from "./store.mjs";

const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const poolId = process.env.COGNITO_POOL_ID;
const clientId = process.env.COGNITO_CLIENT_ID;

export const handler = createCoach({
  store: dynamoStore(process.env.TABLE_NAME),
  verify: cognitoVerifier({ poolId, clientId }),
  verifyId: cognitoIdVerifier({ poolId, clientId }),
  // Web pages allowed to call /mcp from a browser (the app's web version and the voice screen).
  // Other MCP clients and the iPhone app send no Origin.
  origins: list(process.env.WEB_ORIGINS),
  mcpUrl: process.env.MCP_URL || "",
  log: (m) => console.log(m),
});
