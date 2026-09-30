import { execFile } from "node:child_process";
import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  beeBridgeHealthResponseSchema,
  beeConversationSummarySchema,
  beeIdSchema,
  beeSourceSchema,
  listBeeConversationsRequestSchema,
  listBeeConversationsResponseSchema,
  recentBeeChangesRequestSchema,
  recentBeeChangesResponseSchema,
  type BeeAdapter,
  type BeeBridgeHealthResponse,
  type BeeConversationSummary,
  type BeeId,
  type BeeSource,
  type ErrorCode,
  type ListBeeConversationsRequest,
  type ListBeeConversationsResponse,
  type RecentBeeChangesRequest,
  type RecentBeeChangesResponse,
  type SourceKind,
} from "@firstday/contracts";

const DEFAULT_PAGE_LIMIT = 20;
const MAX_CURSOR_LENGTH = 16 * 1024;
const CURSOR_PREFIX = "fdc2.";
const MAX_CONTINUATION_STATES = 128;
const MAX_CONTINUATION_STATE_BYTES = 64 * 1024;
const MAX_CONTINUATION_TOTAL_BYTES = 4 * 1024 * 1024;
const CLI_PAGE_LIMIT = 20;
const MAX_UPSTREAM_PAGES = 100;
const MAX_JSON_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

type CursorOperation = "list" | "changes";

type CursorBoundary = {
  operation: CursorOperation;
  sourceKind: SourceKind;
  query: string;
};

type FixtureCursorState = {
  offset: number;
};

type LiveListCursorState = {
  started: boolean;
  exhausted: boolean;
  upstreamCursor?: string;
  bufferedItems: BeeConversationSummary[];
  seenIds: string[];
};

type LiveChangesCursorState = {
  started: boolean;
  exhausted: boolean;
  upstreamCursor?: string;
  bufferedIds: string[];
  seenIds: string[];
};

type ContinuationSnapshot = {
  boundary: CursorBoundary;
  state: unknown;
};

type ContinuationEntry = {
  bytes: number;
  inFlight: Map<string, Promise<string>>;
  pins: number;
  replaySuccessors: Map<string, ContinuationEntry[]>;
  replays: Map<string, string>;
  serialized: string;
  token: string;
};

type ContinuationIssuer = (boundary: CursorBoundary, state: unknown) => string;

type ContinuationStore = {
  run<T>(compute: (issue: ContinuationIssuer) => T | Promise<T>): Promise<T>;
  resolve<T>(
    cursor: string,
    expected: CursorBoundary,
    key: string,
    compute: (state: unknown, issue: ContinuationIssuer) => T | Promise<T>,
  ): Promise<T>;
};

const SAFE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  BEE_BRIDGE_UNAVAILABLE: "The local Bee bridge is not reachable.",
  BEE_SOURCE_NOT_FOUND: "The requested Bee conversation was not found.",
  SOURCE_NOT_READY: "The Bee conversation is not ready to import.",
  VALIDATION_ERROR: "The Bee bridge request is invalid.",
  INTERNAL_ERROR: "The Bee bridge could not complete the request.",
};

/** A public-safe bridge failure carrying only a canonical application code. */
export class BeeBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(SAFE_MESSAGES[code] ?? "The Bee bridge could not complete the request.");
    this.name = "BeeBridgeError";
    this.code = code;
  }
}

export type BeeCliRunResult = {
  stdout: string;
};

export type BeeCliFailureClassification = "notFound" | "unavailable";

/** A sanitized runner failure; raw process errors and output are never retained. */
export class BeeCliRunnerError extends Error {
  readonly classification: BeeCliFailureClassification;

  constructor(classification: BeeCliFailureClassification) {
    super("The Bee CLI command failed.");
    this.name = "BeeCliRunnerError";
    this.classification = classification;
  }
}

export interface BeeCliRunner {
  run(args: readonly string[]): Promise<BeeCliRunResult>;
}

export type NodeBeeCliRunnerOptions = {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeRawId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : undefined;
}

function rememberIds(
  existing: readonly string[],
  ids: readonly string[],
): string[] {
  return [...new Set([...existing, ...ids])];
}

function normalizeEpochMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1_000;
  const rounded = Math.round(milliseconds);
  if (!Number.isSafeInteger(rounded) || rounded > 8_640_000_000_000_000) {
    return undefined;
  }
  return rounded;
}

function toIsoUtc(value: unknown): string | undefined {
  const milliseconds = normalizeEpochMilliseconds(value);
  if (milliseconds === undefined) {
    return undefined;
  }
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return undefined;
  }
}

function firstNonblankLine(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  for (const line of value.split(/\r?\n/)) {
    const normalized = line.trim();
    if (normalized.length > 0) {
      return normalized.slice(0, 256);
    }
  }
  return undefined;
}

function titleFromRecord(record: Record<string, unknown>, id: string): string {
  return (
    firstNonblankLine(record["short_summary"]) ??
    firstNonblankLine(record["summary"]) ??
    `Bee conversation ${id}`
  );
}

function normalizeProcessingStatus(value: unknown): BeeConversationSummary["status"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["ready", "processed", "complete", "completed"].includes(normalized)) {
    return "processed";
  }
  if (["failed", "error"].includes(normalized)) {
    return "failed";
  }
  return "processing";
}

function compareSummaries(left: BeeConversationSummary, right: BeeConversationSummary): number {
  const timeDifference = Date.parse(right.startedAt) - Date.parse(left.startedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return left.id.localeCompare(right.id);
}

function chooseSummary(
  left: BeeConversationSummary,
  right: BeeConversationSummary,
): BeeConversationSummary {
  const leftKey = `${left.revision ?? ""}\n${left.startedAt}\n${left.title}`;
  const rightKey = `${right.revision ?? ""}\n${right.startedAt}\n${right.title}`;
  return rightKey.localeCompare(leftKey) > 0 ? right : left;
}

function dedupeAndSortSummaries(
  values: readonly BeeConversationSummary[],
): BeeConversationSummary[] {
  const byId = new Map<string, BeeConversationSummary>();
  for (const value of values) {
    const existing = byId.get(value.id);
    byId.set(value.id, existing === undefined ? value : chooseSummary(existing, value));
  }
  return [...byId.values()].sort(compareSummaries);
}

function sourceToSummary(source: BeeSource): BeeConversationSummary {
  const start = Date.parse(source.startedAt);
  const end = source.endedAt === undefined ? undefined : Date.parse(source.endedAt);
  return beeConversationSummarySchema.parse({
    id: source.id,
    sourceKind: source.sourceKind,
    title: source.title,
    startedAt: source.startedAt,
    ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
    ...(end === undefined ? {} : { durationMs: end - start }),
    status: source.status,
    revision: source.revision,
  });
}

function parseListInput(
  input: ListBeeConversationsRequest,
  expectedSourceKind: SourceKind,
): ListBeeConversationsRequest {
  const parsed = listBeeConversationsRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.sourceKind !== expectedSourceKind) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return parsed.data;
}

function parseChangesInput(
  input: RecentBeeChangesRequest,
  expectedSourceKind: SourceKind,
): RecentBeeChangesRequest {
  const parsed = recentBeeChangesRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.sourceKind !== expectedSourceKind) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return parsed.data;
}

function validateListResponse(value: unknown): ListBeeConversationsResponse {
  const parsed = listBeeConversationsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  return parsed.data;
}

function validateChangesResponse(value: unknown): RecentBeeChangesResponse {
  const parsed = recentBeeChangesResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  return parsed.data;
}

function createContinuationStore(): ContinuationStore {
  const secret = randomBytes(32);
  const entries = new Map<string, ContinuationEntry>();
  let totalBytes = 0;

  function tokenForHandle(handle: string): string {
    const unsigned = `${CURSOR_PREFIX}${handle}`;
    const signature = createHmac("sha256", secret)
      .update(unsigned, "utf8")
      .digest("base64url");
    return `${unsigned}.${signature}`;
  }

  function removeEntry(handle: string, expectedEntry?: ContinuationEntry): void {
    const entry = entries.get(handle);
    if (entry === undefined || (expectedEntry !== undefined && entry !== expectedEntry)) {
      return;
    }
    entries.delete(handle);
    totalBytes -= entry.bytes;
    for (const successors of entry.replaySuccessors.values()) {
      for (const successor of successors) {
        successor.pins -= 1;
      }
    }
    entry.replaySuccessors.clear();
  }

  function evictOldest(): boolean {
    for (const [handle, entry] of entries) {
      if (entry.pins > 0) {
        continue;
      }
      removeEntry(handle, entry);
      return true;
    }
    return false;
  }

  function readEntry(
    cursor: string,
    expected: CursorBoundary,
  ): { entry: ContinuationEntry; handle: string; state: unknown } {
    if (cursor.length > MAX_CURSOR_LENGTH) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    const match = /^fdc2\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(cursor);
    if (match === null) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    const handle = match[1];
    const signature = match[2];
    if (handle === undefined || signature === undefined) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    const received = Buffer.from(signature, "base64url");
    const expectedSignature = createHmac("sha256", secret)
      .update(`${CURSOR_PREFIX}${handle}`, "utf8")
      .digest();
    if (
      received.toString("base64url") !== signature ||
      received.length !== expectedSignature.length ||
      !timingSafeEqual(received, expectedSignature)
    ) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }

    const entry = entries.get(handle);
    if (entry === undefined) {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    try {
      const snapshot = asRecord(JSON.parse(entry.serialized));
      if (snapshot === undefined) {
        throw new Error("cursor snapshot is invalid");
      }
      const boundary = asRecord(snapshot["boundary"]);
      if (
        boundary?.["operation"] !== expected.operation ||
        boundary["sourceKind"] !== expected.sourceKind ||
        boundary["query"] !== expected.query ||
        !("state" in snapshot)
      ) {
        throw new Error("cursor boundary mismatch");
      }
      return { entry, handle, state: cloneJson(snapshot["state"]) };
    } catch {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
  }

  function issueEntry(
    boundary: CursorBoundary,
    state: unknown,
  ): { entry: ContinuationEntry; handle: string; token: string } {
    let serialized: string;
    try {
      serialized = JSON.stringify({ boundary, state } satisfies ContinuationSnapshot);
    } catch {
      throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_CONTINUATION_STATE_BYTES) {
      throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
    }

    while (
      entries.size >= MAX_CONTINUATION_STATES ||
      totalBytes + bytes > MAX_CONTINUATION_TOTAL_BYTES
    ) {
      if (!evictOldest()) {
        throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
      }
    }

    let handle: string;
    do {
      handle = randomBytes(18).toString("base64url");
    } while (entries.has(handle));
    const token = tokenForHandle(handle);
    if (token.length > MAX_CURSOR_LENGTH) {
      throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
    }
    const entry: ContinuationEntry = {
      bytes,
      inFlight: new Map(),
      pins: 0,
      replaySuccessors: new Map(),
      replays: new Map(),
      serialized,
      token,
    };
    entries.set(handle, entry);
    totalBytes += bytes;
    return { entry, handle, token };
  }

  return {
    async run<T>(
      compute: (issue: ContinuationIssuer) => T | Promise<T>,
    ): Promise<T> {
      const issued: Array<{ entry: ContinuationEntry; handle: string }> = [];
      let succeeded = false;
      const issue: ContinuationIssuer = (boundary, state) => {
        const created = issueEntry(boundary, state);
        created.entry.pins += 1;
        issued.push(created);
        return created.token;
      };
      try {
        const value = await compute(issue);
        succeeded = true;
        return value;
      } finally {
        for (const { entry, handle } of issued) {
          entry.pins -= 1;
          if (!succeeded) {
            removeEntry(handle, entry);
          }
        }
      }
    },

    async resolve<T>(
      cursor: string,
      expected: CursorBoundary,
      key: string,
      compute: (state: unknown, issue: ContinuationIssuer) => T | Promise<T>,
    ): Promise<T> {
      const { entry, state } = readEntry(cursor, expected);
      const cached = entry.replays.get(key);
      if (cached !== undefined) {
        try {
          return cloneJson(JSON.parse(cached) as T);
        } catch {
          throw new BeeBridgeError("VALIDATION_ERROR");
        }
      }

      const existing = entry.inFlight.get(key);
      if (existing !== undefined) {
        const serialized = await existing;
        return cloneJson(JSON.parse(serialized) as T);
      }

      entry.pins += 1;
      const issued: Array<{ entry: ContinuationEntry; handle: string }> = [];
      let committed = false;
      const issue: ContinuationIssuer = (boundary, nextState) => {
        const created = issueEntry(boundary, nextState);
        created.entry.pins += 1;
        issued.push(created);
        return created.token;
      };
      const computation = Promise.resolve().then(async () => {
        const value = await compute(state, issue);
        let serialized: string;
        try {
          serialized = JSON.stringify(value);
        } catch {
          throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
        }
        const bytes = Buffer.byteLength(serialized, "utf8");
        if (bytes > MAX_CONTINUATION_TOTAL_BYTES) {
          throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
        }
        while (totalBytes + bytes > MAX_CONTINUATION_TOTAL_BYTES) {
          if (!evictOldest()) {
            throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
          }
        }
        const successors = issued.map(({ entry: issuedEntry }) => issuedEntry);
        for (const successor of successors) {
          successor.pins += 1;
        }
        entry.replaySuccessors.set(key, successors);
        entry.replays.set(key, serialized);
        entry.bytes += bytes;
        totalBytes += bytes;
        committed = true;
        return serialized;
      });
      entry.inFlight.set(key, computation);
      try {
        const serialized = await computation;
        return cloneJson(JSON.parse(serialized) as T);
      } finally {
        if (entry.inFlight.get(key) === computation) {
          entry.inFlight.delete(key);
        }
        for (const { entry: issuedEntry, handle } of issued) {
          issuedEntry.pins -= 1;
          if (!committed) {
            removeEntry(handle, issuedEntry);
          }
        }
        entry.pins -= 1;
      }
    },
  };
}

function parseFixtureCursorState(value: unknown): FixtureCursorState {
  const record = asRecord(value);
  if (
    record === undefined ||
    Object.keys(record).length !== 1 ||
    !Number.isSafeInteger(record["offset"]) ||
    (record["offset"] as number) < 0
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return { offset: record["offset"] as number };
}

function fixtureBoundary(
  operation: CursorOperation,
  query = "",
): CursorBoundary {
  return { operation, sourceKind: "fixture", query };
}

/** Creates a deterministic, immutable fixture adapter over canonical Bee sources. */
export function createFixtureBeeAdapter(sources: readonly BeeSource[]): BeeAdapter {
  const continuations = createContinuationStore();
  const canonicalSources: BeeSource[] = [];
  for (const source of sources) {
    const parsed = beeSourceSchema.safeParse(source);
    if (!parsed.success || parsed.data.sourceKind !== "fixture") {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    canonicalSources.push(parsed.data);
  }

  const sourcesById = new Map<string, BeeSource>();
  for (const source of canonicalSources) {
    const existing = sourcesById.get(source.id);
    if (existing === undefined || source.revision.localeCompare(existing.revision) > 0) {
      sourcesById.set(source.id, source);
    }
  }
  const snapshot = [...sourcesById.values()].sort((left, right) =>
    compareSummaries(sourceToSummary(left), sourceToSummary(right)),
  );

  async function fixturePage(
    operation: CursorOperation,
    input: ListBeeConversationsRequest | RecentBeeChangesRequest,
  ): Promise<ListBeeConversationsResponse> {
    const query = operation === "list" && "query" in input
      ? normalizeQuery(input.query)
      : "";
    const boundary = fixtureBoundary(operation, query);
    const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
    const replayKey = `limit:${limit}`;
    const compute = (
      rawState: unknown,
      issue: ContinuationIssuer,
    ): ListBeeConversationsResponse => {
      const offset = parseFixtureCursorState(rawState).offset;
      const candidates = snapshot
        .map(sourceToSummary)
        .filter((summary) => query.length === 0 || summary.title.toLowerCase().includes(query));
      const items = candidates.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return validateListResponse({
        items,
        nextCursor: nextOffset < candidates.length
          ? issue(boundary, { offset: nextOffset })
          : null,
      });
    };
    return input.cursor === undefined
      ? continuations.run((issue) => compute({ offset: 0 }, issue))
      : continuations.resolve(input.cursor, boundary, replayKey, compute);
  }

  return {
    sourceKind: "fixture",
    async health() {
      const latest = snapshot[0];
      const value = {
        authenticated: true,
        ...(latest === undefined ? {} : { lastSyncAt: latest.startedAt }),
      };
      return cloneJson(beeBridgeHealthResponseSchema.parse(value));
    },
    async listCandidateConversations(input) {
      const parsed = parseListInput(input, "fixture");
      return cloneJson(await fixturePage("list", parsed));
    },
    async getConversation(id) {
      const parsedId = beeIdSchema.safeParse(id);
      if (!parsedId.success) {
        throw new BeeBridgeError("VALIDATION_ERROR");
      }
      const source = sourcesById.get(parsedId.data);
      if (source === undefined) {
        throw new BeeBridgeError("BEE_SOURCE_NOT_FOUND");
      }
      return cloneJson(source);
    },
    async getRecentChanges(input) {
      const parsed = parseChangesInput(input, "fixture");
      return cloneJson(validateChangesResponse(await fixturePage("changes", parsed)));
    },
  };
}

function parseJsonOutput(stdout: string): unknown {
  if (Buffer.byteLength(stdout, "utf8") > MAX_JSON_OUTPUT_BYTES) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  try {
    return JSON.parse(stdout.trim()) as unknown;
  } catch {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
}

async function runJson(
  runner: BeeCliRunner,
  args: readonly string[],
  options: { mapNotFound?: boolean } = {},
): Promise<unknown> {
  try {
    const result = await runner.run(args);
    if (typeof result.stdout !== "string") {
      throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
    }
    return parseJsonOutput(result.stdout);
  } catch (error) {
    if (error instanceof BeeBridgeError) {
      throw error;
    }
    if (error instanceof BeeCliRunnerError && error.classification === "notFound") {
      throw new BeeBridgeError(
        options.mapNotFound === true ? "BEE_SOURCE_NOT_FOUND" : "BEE_BRIDGE_UNAVAILABLE",
      );
    }
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
}

function normalizeRawSummary(
  value: unknown,
  failureCode: ErrorCode = "BEE_BRIDGE_UNAVAILABLE",
): BeeConversationSummary {
  const record = asRecord(value);
  const id = normalizeRawId(record?.["id"]);
  const startMilliseconds = normalizeEpochMilliseconds(
    record?.["start_time"] ?? record?.["created_at"],
  );
  if (record === undefined || id === undefined || startMilliseconds === undefined) {
    throw new BeeBridgeError(failureCode);
  }

  const endValue = record["end_time"];
  const endMilliseconds = endValue === null || endValue === undefined
    ? undefined
    : normalizeEpochMilliseconds(endValue);
  if (
    (endValue !== null && endValue !== undefined && endMilliseconds === undefined) ||
    (endMilliseconds !== undefined && endMilliseconds < startMilliseconds)
  ) {
    throw new BeeBridgeError(failureCode);
  }

  const updatedValue = record["updated_at"];
  const updatedAt = updatedValue === null || updatedValue === undefined
    ? undefined
    : toIsoUtc(updatedValue);
  if (updatedValue !== null && updatedValue !== undefined && updatedAt === undefined) {
    throw new BeeBridgeError(failureCode);
  }

  const candidate = {
    id,
    sourceKind: "bee" as const,
    title: titleFromRecord(record, id),
    startedAt: new Date(startMilliseconds).toISOString(),
    ...(endMilliseconds === undefined
      ? {}
      : {
          endedAt: new Date(endMilliseconds).toISOString(),
          durationMs: endMilliseconds - startMilliseconds,
        }),
    status: normalizeProcessingStatus(record["state"] ?? record["status"]),
    ...(updatedAt === undefined ? {} : { revision: `bee:${id}:${updatedAt}` }),
  };
  const parsed = beeConversationSummarySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BeeBridgeError(failureCode);
  }
  return parsed.data;
}

function parseListPayload(value: unknown): {
  items: BeeConversationSummary[];
  nextCursor?: string;
} {
  const record = asRecord(value);
  if (record === undefined || !Array.isArray(record["conversations"])) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  const conversations = record["conversations"];
  const rawNextCursor = record["next_cursor"];
  if (
    rawNextCursor !== undefined &&
    rawNextCursor !== null &&
    (typeof rawNextCursor !== "string" || rawNextCursor.trim().length === 0 || rawNextCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  return {
    items: dedupeAndSortSummaries(conversations.map((item) => normalizeRawSummary(item))),
    ...(typeof rawNextCursor === "string" ? { nextCursor: rawNextCursor } : {}),
  };
}

function parseLiveListCursorState(value: unknown): LiveListCursorState {
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record["started"] !== "boolean" ||
    typeof record["exhausted"] !== "boolean" ||
    !Array.isArray(record["bufferedItems"]) ||
    record["bufferedItems"].length > 100 ||
    !Array.isArray(record["seenIds"]) ||
    record["seenIds"].some(
      (id) => typeof id !== "string" || normalizeRawId(id) !== id,
    )
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const upstreamCursor = record["upstreamCursor"];
  if (
    upstreamCursor !== undefined &&
    (typeof upstreamCursor !== "string" || upstreamCursor.length === 0 || upstreamCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const bufferedItems: BeeConversationSummary[] = [];
  for (const item of record["bufferedItems"]) {
    const parsed = beeConversationSummarySchema.safeParse(item);
    if (!parsed.success || parsed.data.sourceKind !== "bee") {
      throw new BeeBridgeError("VALIDATION_ERROR");
    }
    bufferedItems.push(parsed.data);
  }
  return {
    started: record["started"],
    exhausted: record["exhausted"],
    ...(typeof upstreamCursor === "string" ? { upstreamCursor } : {}),
    bufferedItems: dedupeAndSortSummaries(bufferedItems),
    seenIds: [...new Set(record["seenIds"] as string[])],
  };
}

function initialLiveListState(): LiveListCursorState {
  return { started: false, exhausted: false, bufferedItems: [], seenIds: [] };
}

async function listLiveConversations(
  runner: BeeCliRunner,
  continuations: ContinuationStore,
  input: ListBeeConversationsRequest,
): Promise<ListBeeConversationsResponse> {
  const query = normalizeQuery(input.query);
  const boundary: CursorBoundary = { operation: "list", sourceKind: "bee", query };
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  const replayKey = `limit:${limit}`;
  const compute = async (
    rawState: unknown,
    issue: ContinuationIssuer,
  ): Promise<ListBeeConversationsResponse> => {
    const state = parseLiveListCursorState(rawState);
    const seenIds = new Set(state.seenIds);
    let available = dedupeAndSortSummaries(
      state.bufferedItems.filter((item) => !seenIds.has(item.id)),
    );
    let { started, exhausted, upstreamCursor } = state;
    const visitedCursors = new Set<string>();
    let pages = 0;

    while (available.length < limit && (!started || !exhausted)) {
      if (pages >= MAX_UPSTREAM_PAGES) {
        throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
      }
      pages += 1;
      const requested = Math.min(CLI_PAGE_LIMIT, Math.max(1, limit - available.length));
      const args = ["conversations", "list", "--limit", String(requested)];
      if (upstreamCursor !== undefined) {
        args.push("--cursor", upstreamCursor);
      }
      args.push("--json");

      const page = parseListPayload(await runJson(runner, args));
      started = true;
      const filtered = page.items.filter(
        (item) =>
          !seenIds.has(item.id) &&
          (query.length === 0 || item.title.toLowerCase().includes(query)),
      );
      available = dedupeAndSortSummaries([...available, ...filtered]);

      if (page.nextCursor === undefined) {
        upstreamCursor = undefined;
        exhausted = true;
      } else {
        if (page.nextCursor === upstreamCursor || visitedCursors.has(page.nextCursor)) {
          throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
        }
        visitedCursors.add(page.nextCursor);
        upstreamCursor = page.nextCursor;
        exhausted = false;
      }
    }

    const items = available.slice(0, limit);
    const bufferedItems = available.slice(limit);
    const nextSeenIds = rememberIds(
      state.seenIds,
      items.map(({ id }) => id),
    );
    const hasNext = bufferedItems.length > 0 || !exhausted;
    const nextCursor = hasNext
      ? issue(boundary, {
          started,
          exhausted,
          ...(upstreamCursor === undefined ? {} : { upstreamCursor }),
          bufferedItems,
          seenIds: nextSeenIds,
        } satisfies LiveListCursorState)
      : null;
    return validateListResponse({ items, nextCursor });
  };
  return input.cursor === undefined
    ? continuations.run((issue) => compute(initialLiveListState(), issue))
    : continuations.resolve(input.cursor, boundary, replayKey, compute);
}

function liveDetailId(id: BeeId): string {
  const parsed = beeIdSchema.safeParse(id);
  if (!parsed.success || !/^[1-9]\d*$/.test(parsed.data)) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const numeric = Number(parsed.data);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return parsed.data;
}

async function getDetailRecord(
  runner: BeeCliRunner,
  id: string,
): Promise<Record<string, unknown>> {
  const payload = asRecord(
    await runJson(
      runner,
      ["conversations", "get", id, "--json"],
      { mapNotFound: true },
    ),
  );
  const conversation = asRecord(payload?.["conversation"]);
  if (conversation === undefined) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }
  return conversation;
}

function normalizeSpeaker(value: unknown): { label: string; name?: string } {
  if (typeof value === "string") {
    const label = value.trim();
    return { label: label.length > 0 ? label.slice(0, 256) : "unknown" };
  }
  const record = asRecord(value);
  const label = typeof record?.["label"] === "string"
    ? record["label"].trim().slice(0, 256)
    : "";
  const name = typeof record?.["name"] === "string"
    ? record["name"].trim().slice(0, 256)
    : "";
  return {
    label: label.length > 0 ? label : "unknown",
    ...(name.length > 0 ? { name } : {}),
  };
}

function validSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function normalizeFullSource(record: Record<string, unknown>, requestedId: string): BeeSource {
  const id = normalizeRawId(record["id"]);
  const startMilliseconds = normalizeEpochMilliseconds(
    record["start_time"] ?? record["created_at"],
  );
  const endValue = record["end_time"];
  const endMilliseconds = endValue === null || endValue === undefined
    ? undefined
    : normalizeEpochMilliseconds(endValue);
  const updatedAt = toIsoUtc(record["updated_at"]);
  if (
    id === undefined ||
    id !== requestedId ||
    startMilliseconds === undefined ||
    updatedAt === undefined ||
    (endValue !== null && endValue !== undefined && endMilliseconds === undefined) ||
    (endMilliseconds !== undefined && endMilliseconds < startMilliseconds) ||
    normalizeProcessingStatus(record["state"] ?? record["status"]) !== "processed"
  ) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }

  const rawTranscriptions = record["transcriptions"];
  if (!Array.isArray(rawTranscriptions) || rawTranscriptions.length === 0) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }
  const candidates = rawTranscriptions.map(asRecord);
  if (candidates.some(candidate => candidate === undefined ||
    (candidate["realtime"] !== undefined && typeof candidate["realtime"] !== "boolean"))) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }
  const finalCandidates = candidates.filter(candidate => candidate !== undefined && candidate["realtime"] !== true);
  if (finalCandidates.length !== 1) throw new BeeBridgeError("SOURCE_NOT_READY");
  const transcription = finalCandidates[0];
  const rawUtterances = transcription?.["utterances"];
  if (!Array.isArray(rawUtterances)) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }

  const finalUtterances: Record<string, unknown>[] = [];
  for (const rawUtterance of rawUtterances) {
    const utterance = asRecord(rawUtterance);
    if (utterance === undefined || typeof utterance["text"] !== "string") {
      throw new BeeBridgeError("SOURCE_NOT_READY");
    }
    if (utterance["text"].trim().length > 0) finalUtterances.push(utterance);
  }
  const reportedMode = finalUtterances.some(utterance => {
    const start = normalizeEpochMilliseconds(utterance["start"]);
    const end = normalizeEpochMilliseconds(utterance["end"]);
    return start === undefined || end === undefined || end <= start || start < startMilliseconds;
  });
  if (reportedMode && transcription?.["realtime"] !== false) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }
  const utterances: BeeSource["utterances"] = finalUtterances.map(utterance => {
    const utteranceId = normalizeRawId(utterance["id"]);
    if (utteranceId === undefined) throw new BeeBridgeError("SOURCE_NOT_READY");
    if (reportedMode) {
      const spokenAt = utterance["spoken_at"];
      const rawStart = utterance["start"];
      const rawEnd = utterance["end"];
      if (
        typeof spokenAt !== "number" || !Number.isSafeInteger(spokenAt) ||
        spokenAt < 0 || spokenAt > 8_640_000_000_000_000 ||
        [rawStart, rawEnd].some(value => value !== undefined && value !== null &&
          (typeof value !== "number" || !Number.isFinite(value)))
      ) {
        throw new BeeBridgeError("SOURCE_NOT_READY");
      }
      return {
        id: utteranceId,
        startMs: spokenAt,
        endMs: spokenAt,
        text: utterance["text"] as string,
        speaker: normalizeSpeaker(utterance["speaker"]),
        timing: {
          basis: "reportedTimestamp" as const,
          ...(rawStart === undefined ? {} : { rawStart: rawStart as number | null }),
          ...(rawEnd === undefined ? {} : { rawEnd: rawEnd as number | null }),
        },
      };
    }
    return {
      id: utteranceId,
      startMs: normalizeEpochMilliseconds(utterance["start"])! - startMilliseconds,
      endMs: normalizeEpochMilliseconds(utterance["end"])! - startMilliseconds,
      text: utterance["text"] as string,
      speaker: normalizeSpeaker(utterance["speaker"]),
    };
  });
  utterances.sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs || (reportedMode ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) : left.id.localeCompare(right.id)),
  );
  if (utterances.length === 0) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }

  const speakers = [...new Map(
    utterances.map(({ speaker }) => {
      const resolved = speaker ?? { label: "unknown" };
      return [`${resolved.label}\n${resolved.name ?? ""}`, resolved] as const;
    }),
  ).values()];
  const sourceUrl = validSourceUrl(record["source_url"] ?? record["url"]);
  const candidate = {
    id,
    sourceKind: "bee" as const,
    title: titleFromRecord(record, id),
    startedAt: new Date(startMilliseconds).toISOString(),
    ...(endMilliseconds === undefined ? {} : { endedAt: new Date(endMilliseconds).toISOString() }),
    status: "processed" as const,
    transcript: utterances.map(({ text }) => text).join("\n"),
    utterances,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    revision: `bee:${id}:${updatedAt}` + (reportedMode ? `:reported:${createHash("sha256").update(JSON.stringify(utterances)).digest("hex")}` : ""),
    speakers,
  };
  const parsed = beeSourceSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BeeBridgeError("SOURCE_NOT_READY");
  }
  return parsed.data;
}

function conversationIdsFromChanges(value: unknown): {
  ids: string[];
  nextCursor?: string;
} {
  const payload = asRecord(value);
  if (payload === undefined || !Array.isArray(payload["conversations"])) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  const conversations = payload["conversations"];
  const ids: string[] = [];
  for (const item of conversations) {
    const record = asRecord(item);
    const id = normalizeRawId(record?.["id"] ?? item);
    if (id === undefined || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  const meta = asRecord(payload["meta"]);
  const rawNextCursor = meta?.["next_cursor"] ?? payload["next_cursor"];
  if (
    rawNextCursor !== undefined &&
    rawNextCursor !== null &&
    (typeof rawNextCursor !== "string" || rawNextCursor.trim().length === 0 || rawNextCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
  }
  return {
    ids,
    ...(typeof rawNextCursor === "string" ? { nextCursor: rawNextCursor } : {}),
  };
}

function parseLiveChangesCursorState(value: unknown): LiveChangesCursorState {
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record["started"] !== "boolean" ||
    typeof record["exhausted"] !== "boolean" ||
    !Array.isArray(record["bufferedIds"]) ||
    record["bufferedIds"].some(
      (id) =>
        typeof id !== "string" ||
        !/^[1-9]\d*$/.test(id) ||
        !Number.isSafeInteger(Number(id)),
    ) ||
    !Array.isArray(record["seenIds"]) ||
    record["seenIds"].some(
      (id) =>
        typeof id !== "string" ||
        !/^[1-9]\d*$/.test(id) ||
        !Number.isSafeInteger(Number(id)),
    )
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const upstreamCursor = record["upstreamCursor"];
  if (
    upstreamCursor !== undefined &&
    (typeof upstreamCursor !== "string" ||
      upstreamCursor.length === 0 ||
      upstreamCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return {
    started: record["started"] as boolean,
    exhausted: record["exhausted"] as boolean,
    ...(typeof upstreamCursor === "string" ? { upstreamCursor } : {}),
    bufferedIds: [...new Set(record["bufferedIds"] as string[])],
    seenIds: [...new Set(record["seenIds"] as string[])],
  };
}

function initialLiveChangesState(): LiveChangesCursorState {
  return {
    started: false,
    exhausted: false,
    bufferedIds: [],
    seenIds: [],
  };
}

async function listLiveChanges(
  runner: BeeCliRunner,
  continuations: ContinuationStore,
  input: RecentBeeChangesRequest,
): Promise<RecentBeeChangesResponse> {
  const boundary: CursorBoundary = { operation: "changes", sourceKind: "bee", query: "" };
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  const replayKey = `limit:${limit}`;
  const compute = async (
    rawState: unknown,
    issue: ContinuationIssuer,
  ): Promise<RecentBeeChangesResponse> => {
    const state = parseLiveChangesCursorState(rawState);
    const seenIds = new Set(state.seenIds);
    let bufferedIds = state.bufferedIds.filter(
      (id) => !seenIds.has(id),
    );
    const selectedIds: string[] = [];
    let { started, exhausted, upstreamCursor } = state;
    const visitedCursors = new Set<string>();
    let pages = 0;

    while (selectedIds.length < limit) {
      while (bufferedIds.length > 0 && selectedIds.length < limit) {
        const id = bufferedIds.shift();
        if (id === undefined) {
          throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
        }
        if (seenIds.has(id)) {
          continue;
        }
        seenIds.add(id);
        selectedIds.push(id);
      }

      if (selectedIds.length === limit || (started && exhausted)) {
        break;
      }
      if (pages >= MAX_UPSTREAM_PAGES) {
        throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
      }
      pages += 1;
      const args = ["changed"];
      if (upstreamCursor !== undefined) {
        args.push("--cursor", upstreamCursor);
      }
      args.push("--json");
      const page = conversationIdsFromChanges(await runJson(runner, args));
      started = true;
      bufferedIds = [
        ...new Set([
          ...bufferedIds,
          ...page.ids.filter((id) => !seenIds.has(id)),
        ]),
      ];
      if (page.nextCursor === undefined) {
        upstreamCursor = undefined;
        exhausted = true;
      } else {
        if (page.nextCursor === upstreamCursor || visitedCursors.has(page.nextCursor)) {
          throw new BeeBridgeError("BEE_BRIDGE_UNAVAILABLE");
        }
        visitedCursors.add(page.nextCursor);
        upstreamCursor = page.nextCursor;
        exhausted = false;
      }
    }

    const nextSeenIds = rememberIds(state.seenIds, selectedIds);
    const hasNext = bufferedIds.length > 0 || !exhausted;
    const nextCursor = hasNext
      ? issue(boundary, {
          started,
          exhausted,
          ...(upstreamCursor === undefined ? {} : { upstreamCursor }),
          bufferedIds,
          seenIds: nextSeenIds,
        } satisfies LiveChangesCursorState)
      : null;
    const summaries: BeeConversationSummary[] = [];
    for (const id of selectedIds) {
      const record = await getDetailRecord(runner, id);
      summaries.push(sourceToSummary(normalizeFullSource(record, id)));
    }
    const items = dedupeAndSortSummaries(summaries);
    return validateChangesResponse({ items, nextCursor });
  };
  return input.cursor === undefined
    ? continuations.run((issue) => compute(initialLiveChangesState(), issue))
    : continuations.resolve(input.cursor, boundary, replayKey, compute);
}

/** Creates the live adapter for the verified Bee CLI 0.7.3 command surface. */
export function createBeeCliAdapter(runner: BeeCliRunner): BeeAdapter {
  const continuations = createContinuationStore();
  return {
    sourceKind: "bee",
    async health(): Promise<BeeBridgeHealthResponse> {
      try {
        await runner.run(["status"]);
        return beeBridgeHealthResponseSchema.parse({ authenticated: true });
      } catch {
        return beeBridgeHealthResponseSchema.parse({ authenticated: false });
      }
    },
    async listCandidateConversations(input) {
      const parsed = parseListInput(input, "bee");
      return cloneJson(await listLiveConversations(runner, continuations, parsed));
    },
    async getConversation(id) {
      const normalizedId = liveDetailId(id);
      const record = await getDetailRecord(runner, normalizedId);
      return cloneJson(normalizeFullSource(record, normalizedId));
    },
    async getRecentChanges(input) {
      const parsed = parseChangesInput(input, "bee");
      return cloneJson(await listLiveChanges(runner, continuations, parsed));
    },
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  return resolved;
}

function isCanonicalNotFoundSignal(
  errorCode: string | number | null | undefined,
  stderr: string,
): boolean {
  if (errorCode !== 1) {
    return false;
  }
  const firstLine = stderr
    .slice(0, 512)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (
    firstLine !== undefined &&
    /^(?:Request failed with status 404|Not Found|Conversation(?: \d+)? (?:was )?not found\.?)$/i.test(
      firstLine,
    )
  );
}

/** Uses Node's execFile with no shell and deliberately discards stderr on failure. */
export function createNodeBeeCliRunner(options: NodeBeeCliRunnerOptions = {}): BeeCliRunner {
  const executable = options.executable ?? "bee";
  if (
    typeof executable !== "string" ||
    executable.trim().length === 0 ||
    executable.length > 4_096 ||
    executable.includes("\0")
  ) {
    throw new BeeBridgeError("VALIDATION_ERROR");
  }
  const timeout = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  const maxBuffer = boundedInteger(
    options.maxBufferBytes,
    DEFAULT_MAX_BUFFER_BYTES,
    1_024,
    MAX_BUFFER_BYTES,
  );
  const env = options.env === undefined ? process.env : { ...options.env };

  return {
    run(args) {
      if (
        !Array.isArray(args) ||
        args.some(
          (argument) =>
            typeof argument !== "string" ||
            argument.length > MAX_CURSOR_LENGTH ||
            argument.includes("\0"),
        )
      ) {
        return Promise.reject(new BeeBridgeError("VALIDATION_ERROR"));
      }

      return new Promise<BeeCliRunResult>((resolve, reject) => {
        execFile(
          executable,
          [...args],
          {
            encoding: "utf8",
            env,
            maxBuffer,
            timeout,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error !== null) {
              reject(
                new BeeCliRunnerError(
                  isCanonicalNotFoundSignal(error.code, stderr) ? "notFound" : "unavailable",
                ),
              );
              return;
            }
            resolve({ stdout });
          },
        );
      });
    },
  };
}
