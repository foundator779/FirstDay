import { describe, expect, it, vi } from "vitest";

import {
  createFixtureSessionVerifier,
  createSupabaseSessionVerifier,
} from "./auth.js";

const LEARNER_ID = "70000000-0000-4000-8000-000000000001";

describe("fixture session verifier", () => {
  it("returns only the configured learner and fixture-only access for an exact token", async () => {
    const verifier = createFixtureSessionVerifier({
      token: "public-fixture-token",
      learnerId: LEARNER_ID,
    });

    await expect(verifier.verify("public-fixture-token")).resolves.toEqual({
      learnerId: LEARNER_ID,
      access: "fixtureOnly",
    });
    await expect(verifier.verify("public-fixture-tokeN")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("Supabase Auth session verifier", () => {
  it("verifies the presented learner token through the Auth user endpoint", async () => {
    let receivedInput: string | URL | Request | undefined;
    let receivedInit: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      receivedInput = input;
      receivedInit = init;
      return new Response(JSON.stringify({ id: LEARNER_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const verifier = createSupabaseSessionVerifier({
      supabaseUrl: "https://project.supabase.co",
      anonKey: "public-anon-key",
      fetchImplementation,
    });

    await expect(verifier.verify("learner-jwt")).resolves.toEqual({
      learnerId: LEARNER_ID,
      access: "all",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(receivedInput).toBe("https://project.supabase.co/auth/v1/user");
    expect(receivedInit).toMatchObject({
      method: "GET",
      headers: {
        apikey: "public-anon-key",
        authorization: "Bearer learner-jwt",
      },
    });
  });

  it.each([
    new Response("no", { status: 401 }),
    new Response(JSON.stringify({ id: "not-a-uuid", secret: "must not leak" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ])("maps unsuccessful or malformed Auth responses to unauthenticated", async (authResponse) => {
    const verifier = createSupabaseSessionVerifier({
      supabaseUrl: "https://project.supabase.co",
      anonKey: "public-anon-key",
      fetchImplementation: vi.fn(async () => authResponse.clone()),
    });

    await expect(verifier.verify("learner-jwt")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
