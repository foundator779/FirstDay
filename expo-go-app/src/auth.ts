/**
 * Amazon Cognito email + password accounts, talking to the Cognito API directly with fetch.
 * No Amplify (it needs native code Expo Go can't load) and no secrets in the app:
 * the user pool's app client ID and region are public values.
 *
 * Flows: sign up -> confirm email with code -> sign in; forgot password -> reset with code;
 * refresh tokens automatically; sign out (revokes the refresh token); delete account.
 */
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

// FirstDay Go user pool (AWS account 237320501162). Public values; override in .env if needed.
const REGION = process.env.EXPO_PUBLIC_COGNITO_REGION || "us-east-1";
const CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "2ml0g4qv3uj1o66do3mm15r7os";
const KEY = "firstday-go-session-v1";

export const authConfigured = !!REGION && !!CLIENT_ID;

export type Session = {
  email: string;
  sub: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Friendly, specific messages instead of AWS exception names. */
const MESSAGES: Record<string, string> = {
  UsernameExistsException: "There's already an account with this email. Try signing in.",
  InvalidPasswordException: "That password doesn't meet the rules below.",
  CodeMismatchException: "That code doesn't match. Check the newest email and try again.",
  ExpiredCodeException: "That code expired. Tap “Send a new code”.",
  NotAuthorizedException: "Email or password is wrong.",
  UserNotConfirmedException: "Please confirm your email first. We just sent you a code.",
  UserNotFoundException: "Email or password is wrong.",
  LimitExceededException: "Too many tries. Wait a few minutes, then try again.",
  TooManyRequestsException: "Too many tries. Wait a minute, then try again.",
  TooManyFailedAttemptsException: "Too many tries. Wait a few minutes, then try again.",
  CodeDeliveryFailureException: "We couldn't send the email. Check the address and try again.",
  InvalidParameterException: "Something in the form isn't valid. Check the email and password.",
};

async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!authConfigured) throw new AuthError("NotConfigured", "Accounts aren't set up in this build yet.");
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Network", "No connection. Check your internet and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(json.__type ?? "Error").split("#").pop() ?? "Error";
    const raw = typeof json.message === "string" ? json.message : "";
    throw new AuthError(type, MESSAGES[type] ?? (raw || "Something went wrong. Try again."));
  }
  return json as T;
}

// ---------- session storage + subscription ----------

let current: Session | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function save(s: Session | null) {
  current = s;
  emit();
  try {
    if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
}

export async function loadSession(): Promise<Session | null> {
  if (loaded) return current;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  loaded = true;
  emit();
  return current;
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb: () => void) => {
      listeners.add(cb);
      if (!loaded) void loadSession();
      return () => {
        listeners.delete(cb);
      };
    },
    () => current,
    () => current,
  );
}

function utf8(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp = b;
    let n = 0;
    if (b >= 0xf0) { cp = b & 0x07; n = 3; } else if (b >= 0xe0) { cp = b & 0x0f; n = 2; } else if (b >= 0xc0) { cp = b & 0x1f; n = 1; }
    for (let k = 1; k <= n; k++) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of part) {
    const i = chars.indexOf(c);
    if (i < 0) continue;
    value = ((value << 6) | i) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  try {
    return JSON.parse(utf8(bytes)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type AuthResult = { AccessToken: string; IdToken: string; RefreshToken?: string; ExpiresIn: number };

function sessionFrom(r: AuthResult, refreshToken: string): Session {
  const id = decodeJwt(r.IdToken);
  return {
    email: String(id.email ?? ""),
    sub: String(id.sub ?? ""),
    accessToken: r.AccessToken,
    idToken: r.IdToken,
    refreshToken,
    expiresAt: Date.now() + r.ExpiresIn * 1000,
  };
}

// ---------- password rules (keep in sync with the user pool policy in AUTH-SETUP.md) ----------

export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
];

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

// ---------- flows ----------

export async function signUp(email: string, password: string) {
  await cognito("SignUp", {
    ClientId: CLIENT_ID,
    Username: normalizeEmail(email),
    Password: password,
    UserAttributes: [{ Name: "email", Value: normalizeEmail(email) }],
  });
}

export async function confirmSignUp(email: string, code: string) {
  await cognito("ConfirmSignUp", { ClientId: CLIENT_ID, Username: normalizeEmail(email), ConfirmationCode: code.trim() });
}

export async function resendSignUpCode(email: string) {
  await cognito("ResendConfirmationCode", { ClientId: CLIENT_ID, Username: normalizeEmail(email) });
}

export async function signIn(email: string, password: string): Promise<Session> {
  const r = await cognito<{ AuthenticationResult?: AuthResult; ChallengeName?: string }>("InitiateAuth", {
    ClientId: CLIENT_ID,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: normalizeEmail(email), PASSWORD: password },
  });
  if (!r.AuthenticationResult) {
    throw new AuthError(r.ChallengeName ?? "Challenge", "This account needs an extra step that the app doesn't support yet.");
  }
  const s = sessionFrom(r.AuthenticationResult, r.AuthenticationResult.RefreshToken ?? "");
  await save(s);
  return s;
}

export async function forgotPassword(email: string) {
  await cognito("ForgotPassword", { ClientId: CLIENT_ID, Username: normalizeEmail(email) });
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  await cognito("ConfirmForgotPassword", {
    ClientId: CLIENT_ID,
    Username: normalizeEmail(email),
    ConfirmationCode: code.trim(),
    Password: newPassword,
  });
}

/** A valid access token, refreshed when it's about to expire. Undefined when signed out or the session ended. */
export async function getAccessToken(): Promise<string | undefined> {
  const s = await loadSession();
  if (!s) return undefined;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  try {
    const r = await cognito<{ AuthenticationResult?: AuthResult }>("InitiateAuth", {
      ClientId: CLIENT_ID,
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: s.refreshToken },
    });
    if (!r.AuthenticationResult) return undefined;
    const next = sessionFrom(r.AuthenticationResult, r.AuthenticationResult.RefreshToken ?? s.refreshToken);
    await save(next);
    return next.accessToken;
  } catch (e) {
    // Refresh token revoked or expired: sign out locally. Network errors keep the session.
    if (e instanceof AuthError && e.code !== "Network") await save(null);
    return undefined;
  }
}

export async function signOut() {
  const s = await loadSession();
  if (s?.refreshToken) {
    try {
      await cognito("RevokeToken", { ClientId: CLIENT_ID, Token: s.refreshToken });
    } catch {}
  }
  await save(null);
}

/** Permanently deletes the Cognito account (App Store rule: apps with sign-up must offer this). */
export async function deleteAccount() {
  const token = await getAccessToken();
  if (!token) throw new AuthError("NotAuthorizedException", "Please sign in again first.");
  await cognito("DeleteUser", { AccessToken: token });
  await save(null);
}
