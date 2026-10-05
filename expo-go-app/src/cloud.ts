// The FirstDay AWS endpoint: a Lambda Function URL that calls Amazon Bedrock (Nova Pro).
// Pay-per-request (nothing runs or bills while nobody uses it) and it only answers signed-in
// users: every request carries the Amazon Cognito access token. See infra/ for how it's deployed.
import { getAccessToken } from "./auth";
import type { Target } from "./brain";

const DEFAULT_URL = "https://y2cyv3updzqk6d2h5lg4cle2xe0werqj.lambda-url.us-east-1.on.aws";

/** Override with EXPO_PUBLIC_FIRSTDAY_AI_URL (for your own deployment of infra/template.yaml). */
export const CLOUD_AI_URL = (process.env.EXPO_PUBLIC_FIRSTDAY_AI_URL || DEFAULT_URL).trim().replace(/\/+$/, "");

export const cloudTarget: Target = { url: CLOUD_AI_URL, withToken: true };

/** True when the user is signed in, so the endpoint will accept requests. */
export async function cloudReady(): Promise<boolean> {
  if (!CLOUD_AI_URL) return false;
  try {
    return !!(await getAccessToken());
  } catch {
    return false;
  }
}
