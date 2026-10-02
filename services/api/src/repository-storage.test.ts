import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryFirstDayRepository, initialState, type RepositoryState } from "./memory-repository.js";
import type { RepositoryStorage } from "./repository-storage.js";
import source from "../../../fixtures/transcripts/library-onboarding.json" with { type: "json" };
import { beeSourceSchema } from "@firstday/contracts";
import { createSupabaseStorage } from "./supabase-repository.js";
import { REPOSITORY_TABLES } from "./relational-state.js";

function storage(): RepositoryStorage {
  const saved = new Map<string, { version: number; state: RepositoryState }>();
  return {
    async load(learnerId) { return structuredClone(saved.get(learnerId) ?? { version: 0, state: initialState() }); },
    async commit(learnerId, version, _before, after) {
      if ((saved.get(learnerId)?.version ?? 0) !== version) return false;
      saved.set(learnerId, { version: version + 1, state: structuredClone(after) });
      return true;
    },
  };
}

describe("transactional repository storage", () => {
  it("rejects database redirects and sanitizes failed upstream calls", async () => {
    let redirect: RequestInit["redirect"];
    const durable = createSupabaseStorage({ supabaseUrl: "http://127.0.0.1:55321", serviceRoleKey: "test-server-credential", async fetchImplementation(_url, init) {
      redirect = init?.redirect;
      throw new Error("upstream private response");
    } });
    await expect(durable.load(randomUUID())).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(redirect).toBe("error");
  });

  it("requests redirect rejection before accepting a valid database response", async () => {
    const durable = createSupabaseStorage({ supabaseUrl: "http://127.0.0.1:55321", serviceRoleKey: "test-server-credential", async fetchImplementation(_url, init) {
      expect(init?.redirect).toBe("error");
      return new Response(JSON.stringify({ version: 0, records: Object.fromEntries(REPOSITORY_TABLES.map(name => [name, []])) }));
    } });
    expect((await durable.load(randomUUID())).version).toBe(0);
  });
  it("restores sources in a new repository instance and isolates learners", async () => {
    const durable = storage(), learnerId = randomUUID(), sourceConversationId = randomUUID();
    const original = new MemoryFirstDayRepository(true, durable);
    const imported = await original.importSource({ learnerId, sourceConversationId, source: beeSourceSchema.parse(source), timestamp: "2026-09-29T12:00:00.000Z" });
    const resumed = new MemoryFirstDayRepository(true, durable);
    expect(await resumed.getSource({ learnerId, sourceConversationId })).toEqual(imported);
    expect((await resumed.listSavedSources({ learnerId, sourceKind: "fixture", limit: 20 })).items).toEqual([imported]);
    const session = await resumed.getSourceSession({ learnerId, sourceConversationId });
    expect(session.source.id).toBe(source.id);
    expect(session.extraction).toBeUndefined();
    expect(session.practices).toEqual([]);
    await expect(resumed.getSource({ learnerId: randomUUID(), sourceConversationId })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await resumed.revokeConsent({ learnerId, sourceConversationId, sourceRevision: source.revision, timestamp: "2026-09-29T13:00:00.000Z" });
    expect((await resumed.listSavedSources({ learnerId, sourceKind: "fixture", limit: 20 })).items).toEqual([]);
    await expect(resumed.getSourceSession({ learnerId, sourceConversationId })).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
  });

  it("resolves concurrent imports by rechecking identity against committed state", async () => {
    const durable = storage(), learnerId = randomUUID();
    const repositories = [new MemoryFirstDayRepository(true, durable), new MemoryFirstDayRepository(true, durable)];
    const results = await Promise.all(repositories.map((repo) => repo.importSource({ learnerId, sourceConversationId: randomUUID(), source: beeSourceSchema.parse(source), timestamp: "2026-09-29T12:00:00.000Z" })));
    expect(results[0]!.id).toBe(results[1]!.id);
  });

  it("does not accept a write when durable storage fails", async () => {
    const durable = storage(), learnerId = randomUUID(), sourceConversationId = randomUUID();
    durable.commit = async () => { throw new Error("database unavailable"); };
    const repo = new MemoryFirstDayRepository(true, durable);
    await expect(repo.importSource({ learnerId, sourceConversationId, source: beeSourceSchema.parse(source), timestamp: "2026-09-29T12:00:00.000Z" })).rejects.toThrow("unavailable");
    await expect(repo.getSource({ learnerId, sourceConversationId })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});
