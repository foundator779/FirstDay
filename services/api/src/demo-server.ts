import { readFile } from "node:fs/promises";
import { beeSourceSchema, listBeeConversationsResponseSchema, type BeeSource } from "@firstday/contracts";
import { ApiError } from "./errors.js";
import { isDirectExecution, startProductionApi } from "./index.js";
import type { BeeGateway } from "./bee-gateway.js";

/** Fixture-only source gateway for the Bedrock demo. No live Bee access is claimed. */
export function createDemoGateway(sources: BeeSource[]): BeeGateway {
  const snapshots = sources.map((source) => beeSourceSchema.parse(source));
  if (snapshots.some((s) => s.sourceKind !== "fixture")) throw new ApiError("INVALID_STATE");
  return {
    async health() { return { authenticated: false, message: "Synthetic sources only." }; },
    async listConversations(input) {
      if (input.sourceKind !== "fixture") throw new ApiError("FORBIDDEN");
      if (input.cursor) throw new ApiError("VALIDATION_ERROR");
      return listBeeConversationsResponseSchema.parse({ items: snapshots.filter((s) => !input.query || s.title.toLowerCase().includes(input.query.toLowerCase())).slice(0, input.limit).map((s) => ({ id: s.id, title: s.title, sourceKind: s.sourceKind, startedAt: s.startedAt, endedAt: s.endedAt, status: s.status, revision: s.revision })), nextCursor: null });
    },
    async getConversation(input) {
      if (input.sourceKind !== "fixture") throw new ApiError("FORBIDDEN");
      const source = snapshots.find((s) => s.id === input.beeSourceId);
      if (!source) throw new ApiError("BEE_SOURCE_NOT_FOUND");
      return { conversation: structuredClone(source) };
    },
  };
}

export async function loadDemoSources(): Promise<BeeSource[]> {
  return Promise.all(["library", "studio", "bookshop"].flatMap((name) => ["onboarding", "policy-update"].map(async (kind) => beeSourceSchema.parse(JSON.parse(await readFile(new URL(`../../../fixtures/transcripts/${name}-${kind}.json`, import.meta.url), "utf8"))))));
}

export async function startBedrockDemo(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env["FIRSTDAY_DATA_MODE"] !== "fixture" || env["FIRSTDAY_AI_PROVIDER"] !== "bedrock" || env["NODE_ENV"] === "production") throw new ApiError("INVALID_STATE");
  return startProductionApi(env, { beeGateway: createDemoGateway(await loadDemoSources()) });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void startBedrockDemo().then(({ address, server }) => {
    process.stdout.write(`FirstDay Bedrock demo API: http://${address.host}:${address.port}\n`);
    const close = () => { void server.close(); };
    process.once("SIGTERM", close); process.once("SIGINT", close);
  }).catch(() => { process.stderr.write("Bedrock demo API failed to start. Check local environment settings and port availability.\n"); process.exitCode = 1; });
}
