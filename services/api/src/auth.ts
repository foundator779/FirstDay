import { createHash, timingSafeEqual } from "node:crypto";

import { uuidSchema } from "@firstday/contracts";

import { ApiError } from "./errors.js";

const SESSION_TOKEN_MAX = 16 * 1024;

export type SessionAccess = "all" | "fixtureOnly";

export type LearnerSession = {
  learnerId: string;
  access: SessionAccess;
};

export interface SessionVerifier {
  verify(token: string): Promise<LearnerSession>;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function validateToken(token: unknown): asserts token is string {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > SESSION_TOKEN_MAX ||
    token.trim() !== token ||
    /\s/u.test(token)
  ) {
    throw new ApiError("UNAUTHENTICATED");
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function createFixtureSessionVerifier(input: {
  token: string;
  learnerId: string;
}): SessionVerifier {
  validateToken(input.token);
  const learnerId = uuidSchema.parse(input.learnerId);
  const expected = digest(input.token);
  return {
    async verify(token) {
      validateToken(token);
      const matches = timingSafeEqual(digest(token), expected);
      if (!matches) throw new ApiError("UNAUTHENTICATED");
      return { learnerId, access: "fixtureOnly" };
    },
  };
}

function parseSupabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("INVALID_STATE");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ApiError("INVALID_STATE");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/auth/v1/user`;
  return url;
}

export function createSupabaseSessionVerifier(input: {
  supabaseUrl: string;
  anonKey: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}): SessionVerifier {
  const endpoint = parseSupabaseUrl(input.supabaseUrl).toString();
  validateToken(input.anonKey);
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ApiError("INVALID_STATE");
  }

  return {
    async verify(token) {
      validateToken(token);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(endpoint, {
          method: "GET",
          headers: {
            apikey: input.anonKey,
            authorization: `Bearer ${token}`,
          },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new ApiError("UNAUTHENTICATED");
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
          throw new ApiError("UNAUTHENTICATED");
        }
        const body = await response.json() as unknown;
        const id = typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>)["id"]
          : undefined;
        const learnerId = uuidSchema.safeParse(id);
        if (!learnerId.success) throw new ApiError("UNAUTHENTICATED");
        return { learnerId: learnerId.data, access: "all" };
      } catch {
        throw new ApiError("UNAUTHENTICATED");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
