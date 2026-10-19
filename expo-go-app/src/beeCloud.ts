// "Connect Bee" without a computer: talks to the FirstDay Bee service (infra/bee-connect.yaml), which
// runs Bee's official CLI in AWS for you (deployed with infra/deploy-bee.sh). Only allow-listed
// FirstDay accounts can connect; others see that the preview isn't open to them yet.
//
// The service keeps your Bee sign-in sealed. The key that opens it is created here, kept in this
// phone's secure storage, and sent with each request; the service never stores it.
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { getAccessToken, loadSession } from "./auth";
import type { Brain } from "./logic/types";

/** FirstDay's Bee service (stack firstday-go-bee, AWS account 237320501162). Override with EXPO_PUBLIC_FIRSTDAY_BEE_URL. */
const DEFAULT_URL = "https://5dqpf6ocpwpvarrhdhcdnpxvle0hyybu.lambda-url.us-east-1.on.aws";
export const BEE_CLOUD_URL = (process.env.EXPO_PUBLIC_FIRSTDAY_BEE_URL || DEFAULT_URL).trim().replace(/\/+$/, "");
export const beeCloudAvailable = BEE_CLOUD_URL.length > 0;
/** Must match CONSENT_VERSION in infra/bee-lambda/app.mjs. */
export const BEE_CONSENT_VERSION = "bee-cloud-2026-10-06";
export const BEE_KEY_HEADER = "x-firstday-bee-key";

/** What the app stores as its "brain" once connected: Bee only, through the service. */
export const cloudBeeBrain: Brain = { url: BEE_CLOUD_URL, code: "", ai: false, bee: true, live: true, withToken: true, cloudBee: true };

const keyName = (sub: string) => `firstday-bee-key-${sub.replace(/[^A-Za-z0-9._-]/g, "")}`;

function base64url(bytes: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += abc[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += abc[n & 63]!;
  }
  return out;
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else bytes.set(getRandomBytes(32));
  return base64url(bytes);
}

/** This phone's key for the signed-in account. `create` makes one if there's none yet. */
export async function phoneKey(create = false): Promise<string | null> {
  const s = await loadSession();
  if (!s?.sub) return null;
  try {
    const have = await SecureStore.getItemAsync(keyName(s.sub));
    if (have) return have;
    if (!create) return null;
    const k = randomKey();
    await SecureStore.setItemAsync(keyName(s.sub), k);
    return k;
  } catch {
    return null;
  }
}

async function forgetPhoneKey() {
  const s = await loadSession();
  if (s?.sub) await SecureStore.deleteItemAsync(keyName(s.sub)).catch(() => {});
}

export class BeeCloudError extends Error {
  constructor(message: string, public status: number, public detail: Record<string, unknown> = {}) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, createKey = false): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new BeeCloudError("Sign in first.", 401);
  const key = await phoneKey(createKey);
  const res = await fetch(`${BEE_CLOUD_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(key ? { [BEE_KEY_HEADER]: key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BeeCloudError(typeof json.error === "string" ? json.error : `Request failed (${res.status})`, res.status, json);
  return json as T;
}

export type BeeConnection = { status: "none" | "pending" | "connected"; connectedAt: number | null; needsConsent?: boolean };

export const beeCloudApi = {
  connection: () => call<BeeConnection>("GET", "/bee/connection"),
  /** Records your consent and starts Bee's sign-in. Returns Bee's approval link. */
  start: () => call<{ status: "pending"; link: string; expiresInSeconds: number }>("POST", "/bee/connect/start", { consent: BEE_CONSENT_VERSION }, true),
  /** Finishes the sign-in once you've approved it in Bee. */
  check: () => call<{ status: BeeConnection["status"] }>("POST", "/bee/connect/check", {}),
  /** Signs out of Bee on the service and deletes everything stored there, then forgets this phone's key. */
  async disconnect() {
    try {
      await call<{ ok: boolean }>("POST", "/bee/disconnect", {});
    } finally {
      await forgetPhoneKey();
    }
  },
};
