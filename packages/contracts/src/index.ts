import { z } from "zod";

/** Portable SHA-256 for the exact UTF-8 transcript, shared by offline and server imports. */
export function createTranscriptHash(transcript: string): string {
  return sha256Hex(transcript);
}

const SHORT_TEXT_MAX = 256;
const REVISION_MAX = 512;
const LONG_TEXT_MAX = 4_000;
const TRANSCRIPT_MAX = 2_000_000;
const TRANSPORT_COLLECTION_MAX = 100;
const EVIDENCE_BUNDLE_MAX = 500;
const RULE_COLLECTION_MAX = 20;
const BEE_UTTERANCE_MAX = 10_000;

function nonBlankString(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0, "value cannot be blank");
}

const requiredShortTextSchema = nonBlankString(SHORT_TEXT_MAX);
const requiredLongTextSchema = nonBlankString(LONG_TEXT_MAX);
const millisecondSchema = z.number().int().nonnegative();

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
  0x5be0cd19,
] as const;
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const symbol of value) {
    let codePoint = symbol.codePointAt(0) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

function sha256Hex(value: string): string {
  const source = utf8Bytes(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;

  const bitLength = source.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
}

export type SourceEvidenceIdentity = {
  sourceConversationId: string;
  sourceRevision: string;
  startMs: number;
  endMs: number;
  timing?: { basis: "reportedTimestamps" } | undefined;
  utteranceIds?: readonly string[] | undefined;
};

function deriveSourceEvidenceId(identity: SourceEvidenceIdentity): `evd_${string}` {
  const canonical = [
    identity.sourceConversationId,
    identity.sourceRevision,
    identity.startMs,
    identity.endMs,
  ].join("\n") + (identity.timing ? `\nreportedTimestamps\n${JSON.stringify(identity.utteranceIds)}` : "");
  return `evd_${sha256Hex(canonical)}`;
}

export function createSourceEvidenceId(identity: SourceEvidenceIdentity): `evd_${string}` {
  return deriveSourceEvidenceId({
    ...identity,
    sourceConversationId: uuidSchema.parse(identity.sourceConversationId),
  });
}

export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const isoUtcDateTimeSchema = z.iso.datetime({ offset: false });
export const beeIdSchema = requiredShortTextSchema;
export const beeCliIdSchema = z.union([
  beeIdSchema,
  z.number().int().positive().safe().transform(String),
]);
export const sourceRevisionSchema = nonBlankString(REVISION_MAX);
export const instructionRevisionSchema = nonBlankString(REVISION_MAX);
export const sourceKindSchema = z.enum(["bee", "fixture"]);
export const characterIdSchema = z.enum(["customer-rowan", "guide-maya"]);
export const sourceEvidenceIdSchema = z
  .string()
  .regex(/^evd_[a-f0-9]{64}$/)
  .transform((value): `evd_${string}` => value as `evd_${string}`);

function hasUniqueStrings(values: ReadonlyArray<string>): boolean {
  return new Set(values).size === values.length;
}

const sourceEvidenceReferencesSchema = z
  .array(sourceEvidenceIdSchema)
  .min(1)
  .max(TRANSPORT_COLLECTION_MAX)
  .refine(hasUniqueStrings, "sourceEvidence IDs must be unique");

const expectedRuleIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(RULE_COLLECTION_MAX)
  .refine(hasUniqueStrings, "expectedRuleIds must be unique");

function uniqueTextArray(minimum: number) {
  return z
    .array(requiredLongTextSchema)
    .min(minimum)
    .max(RULE_COLLECTION_MAX)
    .refine(hasUniqueStrings, "values must be unique");
}

export const consentStatusSchema = z.enum(["pending", "confirmed", "revoked"]);
export const sourceStatusSchema = z.enum(["processing", "ready", "failed"]);
export const beeProcessingStatusSchema = z.enum(["processing", "processed", "failed"]);
export const instructionStatusSchema = z.enum([
  "needsReview",
  "confirmed",
  "rejected",
  "changed",
]);
export const practiceStatusSchema = z.enum([
  "draft",
  "ready",
  "inProgress",
  "complete",
  "stale",
]);
export const attemptResultSchema = z.enum(["covered", "partial", "missed", "needsReview"]);
export const inputModeSchema = z.enum(["voice", "text"]);
export const nextActionSchema = z.enum(["continue", "retry", "reviewSource", "complete"]);
export const openQuestionStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export const changeProposalStatusSchema = z.enum(["needsReview", "confirmed"]);

export const beeSpeakerSchema = z
  .object({
    label: requiredShortTextSchema,
    name: requiredShortTextSchema.optional(),
  })
  .strict();

const reportedEpochSchema = millisecondSchema.max(8_640_000_000_000_000);
const reportedSelectionTimingSchema = z.object({ basis: z.literal("reportedTimestamps") }).strict();
const reportedUtteranceTimingSchema = z.object({
  basis: z.literal("reportedTimestamp"),
  rawStart: z.number().finite().nullable().optional(),
  rawEnd: z.number().finite().nullable().optional(),
}).strict();
const utteranceSelectionIdsSchema = z.array(requiredShortTextSchema).min(1).max(TRANSPORT_COLLECTION_MAX).refine(hasUniqueStrings, "utteranceIds must be unique");

export const beeUtteranceSchema = z
  .object({
    id: requiredShortTextSchema,
    startMs: millisecondSchema,
    endMs: millisecondSchema,
    text: requiredLongTextSchema,
    speaker: beeSpeakerSchema.optional(),
    timing: reportedUtteranceTimingSchema.optional(),
  })
  .strict()
  .refine(({ endMs, startMs, timing }) => timing ? endMs === startMs && reportedEpochSchema.safeParse(startMs).success : endMs > startMs, {
    message: "timing must describe a reported point or a positive interval",
    path: ["endMs"],
  });

export const beeConversationSummarySchema = z
  .object({
    id: beeIdSchema,
    sourceKind: sourceKindSchema,
    title: requiredShortTextSchema,
    startedAt: isoUtcDateTimeSchema,
    endedAt: isoUtcDateTimeSchema.optional(),
    durationMs: millisecondSchema.optional(),
    status: beeProcessingStatusSchema,
    revision: sourceRevisionSchema.optional(),
  })
  .strict()
  .refine(
    ({ endedAt, startedAt }) => endedAt === undefined || Date.parse(endedAt) >= Date.parse(startedAt),
    { message: "endedAt cannot precede startedAt", path: ["endedAt"] },
  );

export const beeBridgeHealthResponseSchema = z
  .object({
    authenticated: z.boolean(),
    lastSyncAt: isoUtcDateTimeSchema.optional(),
  })
  .strict();

export const beeSourceSchema = z
  .object({
    id: beeIdSchema,
    sourceKind: sourceKindSchema,
    title: requiredShortTextSchema,
    startedAt: isoUtcDateTimeSchema,
    endedAt: isoUtcDateTimeSchema.optional(),
    status: z.literal("processed"),
    transcript: nonBlankString(TRANSCRIPT_MAX),
    utterances: z.array(beeUtteranceSchema).min(1).max(BEE_UTTERANCE_MAX),
    sourceUrl: z.url({ protocol: /^https?$/ }).optional(),
    revision: sourceRevisionSchema,
    speakers: z.array(beeSpeakerSchema).max(TRANSPORT_COLLECTION_MAX).optional(),
  })
  .strict()
  .refine(
    ({ endedAt, startedAt }) => endedAt === undefined || Date.parse(endedAt) >= Date.parse(startedAt),
    { message: "endedAt cannot precede startedAt", path: ["endedAt"] },
  )
  .superRefine((value, context) => {
    if (value.utterances.some(u => !!u.timing !== !!value.utterances[0]?.timing)) {
      context.addIssue({ code: "custom", message: "source timing must be uniform", path: ["utterances"] });
    }
    const utteranceIds = value.utterances.map(({ id }) => id);
    if (new Set(utteranceIds).size !== utteranceIds.length) {
      context.addIssue({
        code: "custom",
        message: "utterance IDs must be unique",
        path: ["utterances"],
      });
    }

    for (let index = 1; index < value.utterances.length; index += 1) {
      const previous = value.utterances[index - 1];
      const current = value.utterances[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        (current.startMs < previous.startMs ||
          (current.startMs === previous.startMs && current.endMs < previous.endMs) ||
          (current.timing && current.startMs === previous.startMs && current.endMs === previous.endMs && current.id < previous.id))
      ) {
        context.addIssue({
          code: "custom",
          message: "utterances must be ordered by startMs and endMs",
          path: ["utterances", index, "startMs"],
        });
      }
    }

    if (value.utterances.map(({ text }) => text).join("\n") !== value.transcript) {
      context.addIssue({
        code: "custom",
        message: "transcript must be the exact newline join of utterance text",
        path: ["transcript"],
      });
    }
  });

export const excludedRangeSchema = z
  .object({
    startMs: millisecondSchema,
    endMs: millisecondSchema,
    reason: requiredLongTextSchema.optional(),
    timing: reportedSelectionTimingSchema.optional(),
    utteranceIds: utteranceSelectionIdsSchema.optional(),
  })
  .strict()
  .refine(({ endMs, startMs, timing, utteranceIds }) => timing ? endMs >= startMs && !!utteranceIds && (utteranceIds.length !== 1 || endMs === startMs) && reportedEpochSchema.safeParse(startMs).success && reportedEpochSchema.safeParse(endMs).success : endMs > startMs && utteranceIds === undefined, {
    message: "reported selections require timestamp bounds and IDs; intervals require positive duration",
    path: ["endMs"],
  });

export const sourceEvidenceSchema = z
  .object({
    id: sourceEvidenceIdSchema,
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    startMs: millisecondSchema,
    endMs: millisecondSchema,
    quote: requiredLongTextSchema,
    timing: reportedSelectionTimingSchema.optional(),
    utteranceIds: z
      .array(requiredShortTextSchema)
      .min(1)
      .max(TRANSPORT_COLLECTION_MAX)
      .refine(hasUniqueStrings, "utteranceIds must be unique"),
    speakerLabel: requiredShortTextSchema.optional(),
  })
  .strict()
  .refine(({ endMs, startMs, timing, utteranceIds }) => timing ? endMs >= startMs && (utteranceIds.length !== 1 || endMs === startMs) && reportedEpochSchema.safeParse(startMs).success && reportedEpochSchema.safeParse(endMs).success : endMs > startMs, {
    message: "reported selections require timestamp bounds; intervals require positive duration",
    path: ["endMs"],
  })
  .refine(
    (value) => {
      const sourceConversationId = uuidSchema.safeParse(value.sourceConversationId);
      return (
        sourceConversationId.success &&
        value.id ===
          deriveSourceEvidenceId({
            ...value,
            sourceConversationId: sourceConversationId.data,
          })
      );
    },
    {
      message: "id must match the source conversation, revision, and time range",
      path: ["id"],
    },
  );

export const sourceConversationSchema = z
  .object({
    id: uuidSchema,
    learnerId: uuidSchema,
    beeSourceId: beeIdSchema,
    sourceKind: sourceKindSchema,
    title: requiredShortTextSchema,
    startedAt: isoUtcDateTimeSchema,
    endedAt: isoUtcDateTimeSchema.optional(),
    transcriptHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: sourceRevisionSchema,
    consentStatus: consentStatusSchema,
    consentConfirmedAt: isoUtcDateTimeSchema.optional(),
    consentRevokedAt: isoUtcDateTimeSchema.optional(),
    status: sourceStatusSchema,
    importedAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endedAt !== undefined && Date.parse(value.endedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "endedAt cannot precede startedAt",
        path: ["endedAt"],
      });
    }

    if (value.consentStatus === "pending") {
      if (value.consentConfirmedAt !== undefined) {
        context.addIssue({
          code: "custom",
          message: "pending consent cannot have consentConfirmedAt",
          path: ["consentConfirmedAt"],
        });
      }
      if (value.consentRevokedAt !== undefined) {
        context.addIssue({
          code: "custom",
          message: "pending consent cannot have consentRevokedAt",
          path: ["consentRevokedAt"],
        });
      }
      return;
    }

    if (value.consentConfirmedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "confirmed or revoked consent requires consentConfirmedAt",
        path: ["consentConfirmedAt"],
      });
    }

    if (value.consentStatus === "confirmed" && value.consentRevokedAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "confirmed consent cannot have consentRevokedAt",
        path: ["consentRevokedAt"],
      });
    }

    if (value.consentStatus === "revoked") {
      if (value.consentRevokedAt === undefined) {
        context.addIssue({
          code: "custom",
          message: "revoked consent requires consentRevokedAt",
          path: ["consentRevokedAt"],
        });
      } else if (
        value.consentConfirmedAt !== undefined &&
        Date.parse(value.consentRevokedAt) < Date.parse(value.consentConfirmedAt)
      ) {
        context.addIssue({
          code: "custom",
          message: "consentRevokedAt cannot precede consentConfirmedAt",
          path: ["consentRevokedAt"],
        });
      }
    }
  });

export const instructionCardSchema = z
  .object({
    id: uuidSchema,
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    text: requiredLongTextSchema,
    situation: requiredLongTextSchema,
    expectedAction: requiredLongTextSchema,
    exceptions: z.array(requiredLongTextSchema).max(RULE_COLLECTION_MAX),
    sourceEvidence: sourceEvidenceReferencesSchema,
    confidence: z.number().min(0).max(1),
    status: instructionStatusSchema,
    supersedesId: uuidSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
  })
  .strict();

export const practiceSetSchema = z
  .object({
    id: uuidSchema,
    learnerId: uuidSchema,
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    sourceKind: sourceKindSchema,
    title: requiredShortTextSchema,
    kind: z.enum(["standard", "changeDrill"]),
    instructionRevision: instructionRevisionSchema,
    status: practiceStatusSchema,
    scenarioIds: z
      .array(uuidSchema)
      .max(3)
      .refine(hasUniqueStrings, "scenarioIds must be unique"),
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedCount = value.status === "draft" ? 0 : value.kind === "standard" ? 3 : 1;
    if (value.scenarioIds.length !== expectedCount) {
      context.addIssue({
        code: "custom",
        message: `${value.status} ${value.kind} practice sets require ${expectedCount} scenario IDs`,
        path: ["scenarioIds"],
      });
    }
  });

export const scenarioSchema = z
  .object({
    id: uuidSchema,
    practiceSetId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    kind: z.enum(["standard", "changeDrill"]),
    characterId: characterIdSchema,
    prompt: requiredLongTextSchema,
    context: requiredLongTextSchema,
    expectedRuleIds: expectedRuleIdsSchema,
    acceptableSignals: uniqueTextArray(1),
    criticalMisses: uniqueTextArray(0),
    retryPrompt: requiredLongTextSchema,
    sourceEvidence: sourceEvidenceReferencesSchema,
    order: z.number().int().positive(),
  })
  .strict();

export const attemptSchema = z
  .object({
    id: uuidSchema,
    scenarioId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionRevision: instructionRevisionSchema,
    responseText: requiredLongTextSchema,
    inputMode: inputModeSchema,
    matchedRuleIds: z.array(uuidSchema).max(RULE_COLLECTION_MAX),
    missedRuleIds: z.array(uuidSchema).max(RULE_COLLECTION_MAX),
    sourceEvidence: sourceEvidenceReferencesSchema,
    result: attemptResultSchema,
    feedback: requiredLongTextSchema,
    createdAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const matched = new Set(value.matchedRuleIds);
    const missed = new Set(value.missedRuleIds);

    if (matched.size !== value.matchedRuleIds.length) {
      context.addIssue({
        code: "custom",
        message: "matchedRuleIds must be unique",
        path: ["matchedRuleIds"],
      });
    }
    if (missed.size !== value.missedRuleIds.length) {
      context.addIssue({
        code: "custom",
        message: "missedRuleIds must be unique",
        path: ["missedRuleIds"],
      });
    }
    if ([...matched].some((id) => missed.has(id))) {
      context.addIssue({
        code: "custom",
        message: "matchedRuleIds and missedRuleIds must be disjoint",
        path: ["missedRuleIds"],
      });
    }
    if (value.result === "covered" && value.missedRuleIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "covered attempts cannot contain missed rules",
        path: ["missedRuleIds"],
      });
    }
    if (value.result === "covered" && value.matchedRuleIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "covered attempts require at least one matched rule",
        path: ["matchedRuleIds"],
      });
    }
    if (
      (value.result === "partial" || value.result === "missed") &&
      value.missedRuleIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.result} attempts require at least one missed rule`,
        path: ["missedRuleIds"],
      });
    }
  });

export const openQuestionSchema = z
  .object({
    id: uuidSchema,
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionId: uuidSchema.optional(),
    question: requiredLongTextSchema,
    sourceEvidence: sourceEvidenceReferencesSchema,
    status: openQuestionStatusSchema,
    shareConsent: z.boolean(),
    resolution: requiredLongTextSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "resolved" && value.resolution === undefined) {
      context.addIssue({
        code: "custom",
        message: "resolved questions require a resolution",
        path: ["resolution"],
      });
    }
  });

export const changeProposalSchema = z
  .object({
    id: uuidSchema,
    previousInstructionId: uuidSchema,
    previousSourceRevision: sourceRevisionSchema,
    previousSourceEvidence: sourceEvidenceReferencesSchema,
    replacementInstruction: instructionCardSchema,
    sourceRevision: sourceRevisionSchema,
    status: changeProposalStatusSchema,
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.replacementInstruction.sourceRevision !== value.sourceRevision) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must use the proposal sourceRevision",
        path: ["replacementInstruction", "sourceRevision"],
      });
    }

    if (value.replacementInstruction.supersedesId !== value.previousInstructionId) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must supersede the previous instruction",
        path: ["replacementInstruction", "supersedesId"],
      });
    }

    if (value.replacementInstruction.id === value.previousInstructionId) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must have a distinct ID",
        path: ["replacementInstruction", "id"],
      });
    }

    if (value.replacementInstruction.status !== value.status) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction and proposal statuses must match",
        path: ["replacementInstruction", "status"],
      });
    }
  });

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "BEE_BRIDGE_UNAVAILABLE",
  "BEE_SOURCE_NOT_FOUND",
  "CONSENT_REQUIRED",
  "SOURCE_NOT_READY",
  "NO_CONFIRMED_INSTRUCTIONS",
  "STALE_PRACTICE_SET",
  "VALIDATION_ERROR",
  "RESOURCE_NOT_FOUND",
  "REVISION_CONFLICT",
  "CONSENT_REVOKED",
  "INVALID_STATE",
  "INTERNAL_ERROR",
]);

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: requiredLongTextSchema,
        details: z.record(z.string(), z.unknown()),
        requestId: uuidSchema,
      })
      .strict(),
  })
  .strict();

export const healthRequestSchema = z.object({}).strict();

export const healthResponseSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal("firstday-api"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    beeBridge: z.enum(["authenticated", "unauthenticated", "unavailable"]),
  })
  .strict();

const cursorSchema = nonBlankString(16 * 1024);
const pageLimitSchema = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(100));

export const listBeeConversationsRequestSchema = z
  .object({
    sourceKind: sourceKindSchema,
    query: requiredShortTextSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: pageLimitSchema.optional(),
  })
  .strict();

export const listBeeConversationsResponseSchema = z
  .object({
    items: z.array(beeConversationSummarySchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.items.map(({ id }) => id)).size !== value.items.length) {
      context.addIssue({
        code: "custom",
        message: "conversation summary IDs must be unique within a page",
        path: ["items"],
      });
    }

    const pageKinds = new Set(value.items.map(({ sourceKind }) => sourceKind));
    if (pageKinds.size > 1) {
      context.addIssue({
        code: "custom",
        message: "a conversation page must come from one source kind",
        path: ["items"],
      });
    }
  });

export const recentBeeChangesRequestSchema = z
  .object({
    sourceKind: sourceKindSchema,
    cursor: cursorSchema.optional(),
    limit: pageLimitSchema.optional(),
  })
  .strict();

export const recentBeeChangesResponseSchema = listBeeConversationsResponseSchema;

export const getBeeConversationRequestSchema = z
  .object({
    beeSourceId: beeIdSchema,
    sourceKind: sourceKindSchema,
  })
  .strict();

export const getBeeConversationResponseSchema = z
  .object({
    conversation: beeSourceSchema,
  })
  .strict();

export const consentConfirmationSchema = z
  .object({
    confirmed: z.literal(true),
  })
  .strict();

export const importConversationRequestSchema = z
  .object({
    beeSourceId: beeIdSchema,
    sourceKind: sourceKindSchema,
    sourceRevision: sourceRevisionSchema,
    consent: consentConfirmationSchema,
  })
  .strict();

export const importConversationResponseSchema = z
  .object({
    sourceConversation: sourceConversationSchema,
  })
  .strict()
  .refine(({ sourceConversation }) => sourceConversation.consentStatus === "confirmed", {
    message: "successful imports require confirmed consent",
    path: ["sourceConversation", "consentStatus"],
  });

export const revokeConsentRequestSchema = z
  .object({
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    reason: requiredLongTextSchema.optional(),
  })
  .strict();

export const revokeConsentResponseSchema = z
  .object({
    sourceConversation: sourceConversationSchema,
    stalePracticeSetIds: z
      .array(uuidSchema)
      .max(TRANSPORT_COLLECTION_MAX)
      .refine(hasUniqueStrings, "stalePracticeSetIds must be unique"),
  })
  .strict()
  .refine(({ sourceConversation: source }) => source.consentStatus === "revoked", {
    message: "revocation response must contain a revoked source",
    path: ["sourceConversation", "consentStatus"],
  });

export const extractInstructionsRequestSchema = z
  .object({
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    excludedRanges: z.array(excludedRangeSchema).max(TRANSPORT_COLLECTION_MAX),
  })
  .strict();

function referencedEvidenceIds(values: ReadonlyArray<{ sourceEvidence: ReadonlyArray<string> }>): Set<string> {
  return new Set(values.flatMap(({ sourceEvidence: evidence }) => evidence));
}

function validateEvidenceResolution(
  references: ReadonlySet<string>,
  evidence: ReadonlyArray<{ id: string }>,
  context: z.RefinementCtx,
): void {
  const availableIds = evidence.map(({ id }) => id);
  const available = new Set(availableIds);

  if (available.size !== availableIds.length) {
    context.addIssue({
      code: "custom",
      message: "sourceEvidence records must have unique IDs",
      path: ["sourceEvidence"],
    });
  }

  for (const id of references) {
    if (!available.has(id)) {
      context.addIssue({
        code: "custom",
        message: `sourceEvidence reference ${id} is not included in the response`,
        path: ["sourceEvidence"],
      });
    }
  }

  for (const id of available) {
    if (!references.has(id)) {
      context.addIssue({
        code: "custom",
        message: `unreferenced sourceEvidence ${id} cannot be included in the response`,
        path: ["sourceEvidence"],
      });
    }
  }
}

function validateEvidenceProvenance(
  references: ReadonlySet<string>,
  evidence: ReadonlyArray<z.output<typeof sourceEvidenceSchema>>,
  expected: { sourceConversationId: string; sourceRevision: string },
  context: z.RefinementCtx,
): void {
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));

  for (const id of references) {
    const record = evidenceById.get(id as `evd_${string}`);
    if (
      record !== undefined &&
      (record.sourceConversationId !== expected.sourceConversationId ||
        record.sourceRevision !== expected.sourceRevision)
    ) {
      context.addIssue({
        code: "custom",
        message: `sourceEvidence ${id} does not match the expected source provenance`,
        path: ["sourceEvidence"],
      });
    }
  }
}

function sameStringSet(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;

  const leftValues = new Set(left);
  const rightValues = new Set(right);
  return (
    leftValues.size === left.length &&
    rightValues.size === right.length &&
    leftValues.size === rightValues.size &&
    [...leftValues].every((value) => rightValues.has(value))
  );
}

function sameInstructionCard(
  left: z.output<typeof instructionCardSchema>,
  right: z.output<typeof instructionCardSchema>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePracticeBundle(
  practiceSet: z.output<typeof practiceSetSchema>,
  scenarios: ReadonlyArray<z.output<typeof scenarioSchema>>,
  context: z.RefinementCtx,
): void {
  const scenarioIds = scenarios.map(({ id }) => id);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    context.addIssue({
      code: "custom",
      message: "scenario IDs must be unique",
      path: ["scenarios"],
    });
  }
  if (
    scenarioIds.some((id, index) => practiceSet.scenarioIds[index] !== id) ||
    practiceSet.scenarioIds.length !== scenarioIds.length
  ) {
    context.addIssue({
      code: "custom",
      message: "practiceSet.scenarioIds must match scenarios in order",
      path: ["practiceSet", "scenarioIds"],
    });
  }

  for (const [index, scenarioValue] of scenarios.entries()) {
    if (scenarioValue.practiceSetId !== practiceSet.id) {
      context.addIssue({
        code: "custom",
        message: "scenario must belong to the returned practice set",
        path: ["scenarios", index, "practiceSetId"],
      });
    }
    if (scenarioValue.sourceRevision !== practiceSet.sourceRevision) {
      context.addIssue({
        code: "custom",
        message: "scenario must use the practice set sourceRevision",
        path: ["scenarios", index, "sourceRevision"],
      });
    }
    if (scenarioValue.kind !== practiceSet.kind) {
      context.addIssue({
        code: "custom",
        message: "scenario kind must match the practice set kind",
        path: ["scenarios", index, "kind"],
      });
    }
    if (scenarioValue.order !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "scenario order must be contiguous and match response order",
        path: ["scenarios", index, "order"],
      });
    }
  }
}

export const extractInstructionsResponseSchema = z
  .object({
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionRevision: instructionRevisionSchema,
    items: z.array(instructionCardSchema).max(TRANSPORT_COLLECTION_MAX),
    openQuestions: z.array(openQuestionSchema).max(TRANSPORT_COLLECTION_MAX),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    const recordIds = [...value.items, ...value.openQuestions].map(({ id }) => id);
    if (new Set(recordIds).size !== recordIds.length) {
      context.addIssue({
        code: "custom",
        message: "extracted record IDs must be unique",
        path: ["items"],
      });
    }

    for (const [index, instructionValue] of value.items.entries()) {
      if (instructionValue.status !== "needsReview") {
        context.addIssue({
          code: "custom",
          message: "newly extracted instructions must need review",
          path: ["items", index, "status"],
        });
      }
    }

    for (const [index, questionValue] of value.openQuestions.entries()) {
      if (questionValue.status !== "open") {
        context.addIssue({
          code: "custom",
          message: "newly extracted questions must be open",
          path: ["openQuestions", index, "status"],
        });
      }
    }

    const records = [...value.items, ...value.openQuestions];
    const references = referencedEvidenceIds(records);
    validateEvidenceResolution(references, value.sourceEvidence, context);
    validateEvidenceProvenance(references, value.sourceEvidence, value, context);

    for (const [index, record] of records.entries()) {
      if (
        record.sourceConversationId !== value.sourceConversationId ||
        record.sourceRevision !== value.sourceRevision
      ) {
        const isInstruction = index < value.items.length;
        context.addIssue({
          code: "custom",
          message: "extracted records must match the response source provenance",
          path: [
            isInstruction ? "items" : "openQuestions",
            isInstruction ? index : index - value.items.length,
            "sourceRevision",
          ],
        });
      }
    }
  });

const editableInstructionShape = {
  status: z.enum(["confirmed", "rejected", "needsReview"]).optional(),
  text: requiredLongTextSchema.optional(),
  situation: requiredLongTextSchema.optional(),
  expectedAction: requiredLongTextSchema.optional(),
  exceptions: z.array(requiredLongTextSchema).max(RULE_COLLECTION_MAX).optional(),
};

export const updateInstructionRequestSchema = z
  .object({
    instructionId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    ...editableInstructionShape,
  })
  .strict()
  .refine(
    ({ exceptions, expectedAction, situation, status, text }) =>
      status !== undefined ||
      text !== undefined ||
      situation !== undefined ||
      expectedAction !== undefined ||
      exceptions !== undefined,
    { message: "at least one instruction decision or edit is required" },
  );

export const updateInstructionResponseSchema = z
  .object({
    instruction: instructionCardSchema.extend({
      status: z.enum(["confirmed", "rejected", "needsReview"]),
    }),
  })
  .strict();

export const createPracticeSetRequestSchema = z
  .object({
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionIds: z.array(uuidSchema).min(1).max(20),
    title: requiredShortTextSchema,
  })
  .strict()
  .refine(({ instructionIds }) => new Set(instructionIds).size === instructionIds.length, {
    message: "instructionIds must be unique",
    path: ["instructionIds"],
  });

export const createPracticeSetResponseSchema = z
  .object({
    practiceSet: practiceSetSchema,
    scenarios: z.array(scenarioSchema).length(3),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.practiceSet.kind !== "standard") {
      context.addIssue({
        code: "custom",
        message: "created MVP practice sets must be standard",
        path: ["practiceSet", "kind"],
      });
    }

    if (value.practiceSet.status !== "ready") {
      context.addIssue({
        code: "custom",
        message: "new practice sets must be ready",
        path: ["practiceSet", "status"],
      });
    }

    validatePracticeBundle(value.practiceSet, value.scenarios, context);

    const references = referencedEvidenceIds(value.scenarios);
    validateEvidenceResolution(references, value.sourceEvidence, context);
    validateEvidenceProvenance(references, value.sourceEvidence, value.practiceSet, context);
  });

export const getPracticeSetRequestSchema = z
  .object({
    practiceSetId: uuidSchema,
  })
  .strict();

const practiceProgressSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict()
  .refine(({ completed, total }) => completed <= total, {
    message: "completed cannot exceed total",
    path: ["completed"],
  });

export const getPracticeSetResponseSchema = z
  .object({
    practiceSet: practiceSetSchema,
    scenarios: z.array(scenarioSchema).max(3),
    instructions: z.array(instructionCardSchema).max(RULE_COLLECTION_MAX),
    changeProposal: changeProposalSchema.optional(),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
    progress: practiceProgressSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validatePracticeBundle(value.practiceSet, value.scenarios, context);
    const records = [...value.scenarios, ...value.instructions];
    const references = referencedEvidenceIds(records);
    validateEvidenceResolution(references, value.sourceEvidence, context);

    if (value.progress.total !== value.scenarios.length) {
      context.addIssue({
        code: "custom",
        message: "progress.total must equal the number of scenarios",
        path: ["progress", "total"],
      });
    }
    if (
      (value.practiceSet.status === "draft" || value.practiceSet.status === "ready") &&
      value.progress.completed !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.practiceSet.status} practice sets cannot have completed scenarios`,
        path: ["progress", "completed"],
      });
    }
    if (
      value.practiceSet.status === "complete" &&
      value.progress.completed !== value.progress.total
    ) {
      context.addIssue({
        code: "custom",
        message: "complete practice sets require all scenarios to be completed",
        path: ["progress", "completed"],
      });
    }
    if (
      value.practiceSet.status === "inProgress" &&
      value.progress.completed === value.progress.total
    ) {
      context.addIssue({
        code: "custom",
        message: "inProgress practice sets must have an incomplete scenario",
        path: ["progress", "completed"],
      });
    }

    const instructionIds = value.instructions.map(({ id }) => id);
    if (new Set(instructionIds).size !== instructionIds.length) {
      context.addIssue({
        code: "custom",
        message: "instruction IDs must be unique",
        path: ["instructions"],
      });
    }
    const instructionById = new Map(value.instructions.map((item) => [item.id, item]));
    for (const [index, scenarioValue] of value.scenarios.entries()) {
      for (const ruleId of scenarioValue.expectedRuleIds) {
        const expectedRule = instructionById.get(ruleId);
        if (expectedRule === undefined) {
          context.addIssue({
            code: "custom",
            message: "scenario expected rules must be included in instructions",
            path: ["scenarios", index, "expectedRuleIds"],
          });
        } else if (
          expectedRule.status !== "confirmed" &&
          !(value.practiceSet.status === "stale" && expectedRule.status === "changed")
        ) {
          context.addIssue({
            code: "custom",
            message: "active expected rules must be confirmed; stale rules may be changed",
            path: ["scenarios", index, "expectedRuleIds"],
          });
        } else if (
          expectedRule.sourceConversationId !== value.practiceSet.sourceConversationId ||
          expectedRule.sourceRevision !== value.practiceSet.sourceRevision
        ) {
          context.addIssue({
            code: "custom",
            message: "scenario expected rules must match the practice set source provenance",
            path: ["scenarios", index, "expectedRuleIds"],
          });
        }
      }
    }

    if (value.practiceSet.kind === "standard") {
      if (value.changeProposal !== undefined) {
        context.addIssue({
          code: "custom",
          message: "standard practice responses cannot include a change proposal",
          path: ["changeProposal"],
        });
      }
      validateEvidenceProvenance(references, value.sourceEvidence, value.practiceSet, context);
      for (const [index, instructionValue] of value.instructions.entries()) {
        if (
          instructionValue.sourceConversationId !== value.practiceSet.sourceConversationId ||
          instructionValue.sourceRevision !== value.practiceSet.sourceRevision
        ) {
          context.addIssue({
            code: "custom",
            message: "standard-practice instructions must match the set source provenance",
            path: ["instructions", index, "sourceRevision"],
          });
        }
      }
      return;
    }

    const proposal = value.changeProposal;
    if (proposal === undefined) {
      context.addIssue({
        code: "custom",
        message: "Change Drill responses require their confirmed change proposal",
        path: ["changeProposal"],
      });
      return;
    }

    if (proposal.status !== "confirmed") {
      context.addIssue({
        code: "custom",
        message: "Change Drill proposal must be confirmed",
        path: ["changeProposal", "status"],
      });
    }
    if (
      proposal.sourceRevision !== value.practiceSet.sourceRevision ||
      proposal.replacementInstruction.sourceConversationId !==
        value.practiceSet.sourceConversationId
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill proposal must match the practice set source provenance",
        path: ["changeProposal", "sourceRevision"],
      });
    }

    const previousInstruction = instructionById.get(proposal.previousInstructionId);
    const replacement = instructionById.get(proposal.replacementInstruction.id);
    const expectedInstructionIds = [
      proposal.previousInstructionId,
      proposal.replacementInstruction.id,
    ];
    if (
      value.instructions.length !== expectedInstructionIds.length ||
      !expectedInstructionIds.every((id) => instructionById.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill instructions must be exactly the previous and replacement cards",
        path: ["instructions"],
      });
    }

    if (
      previousInstruction === undefined ||
      previousInstruction.status !== "changed" ||
      previousInstruction.sourceRevision !== proposal.previousSourceRevision ||
      !sameStringSet(previousInstruction.sourceEvidence, proposal.previousSourceEvidence)
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill previous instruction must match the confirmed proposal",
        path: ["instructions"],
      });
    }
    if (
      replacement === undefined ||
      replacement.status !== "confirmed" ||
      !sameInstructionCard(replacement, proposal.replacementInstruction)
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill replacement instruction must match the confirmed proposal",
        path: ["instructions"],
      });
    }

    const allowedEvidence = [
      ...proposal.previousSourceEvidence,
      ...proposal.replacementInstruction.sourceEvidence,
    ];
    for (const [index, scenarioValue] of value.scenarios.entries()) {
      if (!sameStringSet(scenarioValue.sourceEvidence, allowedEvidence)) {
        context.addIssue({
          code: "custom",
          message: "Change Drill scenario evidence must be exactly the old and new rule evidence",
          path: ["scenarios", index, "sourceEvidence"],
        });
      }
    }

    if (previousInstruction !== undefined) {
      validateEvidenceProvenance(
        new Set(proposal.previousSourceEvidence),
        value.sourceEvidence,
        {
          sourceConversationId: previousInstruction.sourceConversationId,
          sourceRevision: proposal.previousSourceRevision,
        },
        context,
      );
    }
    validateEvidenceProvenance(
      new Set(proposal.replacementInstruction.sourceEvidence),
      value.sourceEvidence,
      value.practiceSet,
      context,
    );
  });

export const createAttemptRequestSchema = z
  .object({
    scenarioId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionRevision: instructionRevisionSchema,
    responseText: requiredLongTextSchema,
    inputMode: inputModeSchema,
  })
  .strict();

export const createAttemptResponseSchema = z
  .object({
    practiceSet: practiceSetSchema,
    scenario: scenarioSchema,
    attempt: attemptSchema,
    instructions: z.array(instructionCardSchema).max(RULE_COLLECTION_MAX),
    changeProposal: changeProposalSchema.optional(),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
    nextAction: nextActionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scenario.practiceSetId !== value.practiceSet.id) {
      context.addIssue({
        code: "custom",
        message: "scenario must belong to the returned practice set",
        path: ["scenario", "practiceSetId"],
      });
    }
    const scenarioPosition = value.practiceSet.scenarioIds.indexOf(value.scenario.id);
    if (scenarioPosition === -1) {
      context.addIssue({
        code: "custom",
        message: "practice set must list the returned scenario",
        path: ["practiceSet", "scenarioIds"],
      });
    } else if (value.scenario.order !== scenarioPosition + 1) {
      context.addIssue({
        code: "custom",
        message: "scenario order must match its practice-set list position",
        path: ["scenario", "order"],
      });
    }
    if (value.scenario.kind !== value.practiceSet.kind) {
      context.addIssue({
        code: "custom",
        message: "scenario kind must match the returned practice set",
        path: ["scenario", "kind"],
      });
    }
    if (value.scenario.sourceRevision !== value.practiceSet.sourceRevision) {
      context.addIssue({
        code: "custom",
        message: "scenario must use the returned practice-set sourceRevision",
        path: ["scenario", "sourceRevision"],
      });
    }
    if (value.attempt.scenarioId !== value.scenario.id) {
      context.addIssue({
        code: "custom",
        message: "attempt must belong to the returned scenario",
        path: ["attempt", "scenarioId"],
      });
    }
    if (value.attempt.sourceRevision !== value.scenario.sourceRevision) {
      context.addIssue({
        code: "custom",
        message: "attempt must use the returned scenario sourceRevision",
        path: ["attempt", "sourceRevision"],
      });
    }
    if (value.attempt.instructionRevision !== value.practiceSet.instructionRevision) {
      context.addIssue({
        code: "custom",
        message: "attempt must use the returned practice-set instructionRevision",
        path: ["attempt", "instructionRevision"],
      });
    }
    if (!sameStringSet(value.attempt.sourceEvidence, value.scenario.sourceEvidence)) {
      context.addIssue({
        code: "custom",
        message: "attempt evidence must exactly match the returned scenario evidence",
        path: ["attempt", "sourceEvidence"],
      });
    }
    if (
      !sameStringSet(
        [...value.attempt.matchedRuleIds, ...value.attempt.missedRuleIds],
        value.scenario.expectedRuleIds,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "attempt rule results must partition the returned scenario expected rules",
        path: ["attempt", "matchedRuleIds"],
      });
    }

    validateEvidenceResolution(
      new Set(value.scenario.sourceEvidence),
      value.sourceEvidence,
      context,
    );

    const instructionIds = value.instructions.map(({ id }) => id);
    const instructionById = new Map(value.instructions.map((item) => [item.id, item]));
    if (new Set(instructionIds).size !== instructionIds.length) {
      context.addIssue({
        code: "custom",
        message: "instruction IDs must be unique",
        path: ["instructions"],
      });
    }

    if (value.scenario.kind === "standard") {
      if (value.changeProposal !== undefined) {
        context.addIssue({
          code: "custom",
          message: "standard attempt responses cannot include a change proposal",
          path: ["changeProposal"],
        });
      }
      if (!sameStringSet(instructionIds, value.scenario.expectedRuleIds)) {
        context.addIssue({
          code: "custom",
          message: "standard attempt instructions must be exactly the expected rules",
          path: ["instructions"],
        });
      }
      for (const [index, instructionValue] of value.instructions.entries()) {
        if (instructionValue.status !== "confirmed") {
          context.addIssue({
            code: "custom",
            message: "standard attempt instructions must be confirmed",
            path: ["instructions", index, "status"],
          });
        }
        if (
          instructionValue.sourceConversationId !== value.practiceSet.sourceConversationId ||
          instructionValue.sourceRevision !== value.practiceSet.sourceRevision
        ) {
          context.addIssue({
            code: "custom",
            message: "standard attempt instructions must match practice-set source provenance",
            path: ["instructions", index, "sourceRevision"],
          });
        }
      }

      const instructionEvidence = referencedEvidenceIds(value.instructions);
      if (!sameStringSet([...instructionEvidence], value.scenario.sourceEvidence)) {
        context.addIssue({
          code: "custom",
          message: "standard scenario evidence must be exactly the instruction evidence",
          path: ["scenario", "sourceEvidence"],
        });
      }
      validateEvidenceProvenance(
        new Set(value.scenario.sourceEvidence),
        value.sourceEvidence,
        value.practiceSet,
        context,
      );
    } else {
      const proposal = value.changeProposal;
      if (proposal === undefined) {
        context.addIssue({
          code: "custom",
          message: "Change Drill attempt responses require their confirmed change proposal",
          path: ["changeProposal"],
        });
      } else {
        if (proposal.status !== "confirmed") {
          context.addIssue({
            code: "custom",
            message: "Change Drill proposal must be confirmed",
            path: ["changeProposal", "status"],
          });
        }
        if (
          proposal.sourceRevision !== value.practiceSet.sourceRevision ||
          proposal.replacementInstruction.sourceConversationId !==
            value.practiceSet.sourceConversationId
        ) {
          context.addIssue({
            code: "custom",
            message: "Change Drill proposal must match practice-set source provenance",
            path: ["changeProposal", "sourceRevision"],
          });
        }

        const previousInstruction = instructionById.get(proposal.previousInstructionId);
        const replacementInstruction = instructionById.get(
          proposal.replacementInstruction.id,
        );
        if (
          !sameStringSet(instructionIds, [
            proposal.previousInstructionId,
            proposal.replacementInstruction.id,
          ])
        ) {
          context.addIssue({
            code: "custom",
            message: "Change Drill instructions must be exactly the previous and replacement cards",
            path: ["instructions"],
          });
        }
        if (
          previousInstruction === undefined ||
          previousInstruction.status !== "changed" ||
          previousInstruction.sourceRevision !== proposal.previousSourceRevision ||
          !sameStringSet(previousInstruction.sourceEvidence, proposal.previousSourceEvidence)
        ) {
          context.addIssue({
            code: "custom",
            message: "Change Drill previous instruction must match the confirmed proposal",
            path: ["instructions"],
          });
        }
        if (
          replacementInstruction === undefined ||
          replacementInstruction.status !== "confirmed" ||
          !sameInstructionCard(replacementInstruction, proposal.replacementInstruction)
        ) {
          context.addIssue({
            code: "custom",
            message: "Change Drill replacement instruction must match the confirmed proposal",
            path: ["instructions"],
          });
        }
        if (
          !sameStringSet(value.scenario.expectedRuleIds, [
            proposal.replacementInstruction.id,
          ])
        ) {
          context.addIssue({
            code: "custom",
            message: "Change Drill scenario must evaluate only the replacement instruction",
            path: ["scenario", "expectedRuleIds"],
          });
        }

        const requiredEvidence = [
          ...proposal.previousSourceEvidence,
          ...proposal.replacementInstruction.sourceEvidence,
        ];
        if (!sameStringSet(value.scenario.sourceEvidence, requiredEvidence)) {
          context.addIssue({
            code: "custom",
            message: "Change Drill scenario evidence must be exactly the old and new rule evidence",
            path: ["scenario", "sourceEvidence"],
          });
        }
        if (previousInstruction !== undefined) {
          validateEvidenceProvenance(
            new Set(proposal.previousSourceEvidence),
            value.sourceEvidence,
            {
              sourceConversationId: previousInstruction.sourceConversationId,
              sourceRevision: proposal.previousSourceRevision,
            },
            context,
          );
        }
        validateEvidenceProvenance(
          new Set(proposal.replacementInstruction.sourceEvidence),
          value.sourceEvidence,
          value.practiceSet,
          context,
        );
      }
    }

    const expectedActions: Record<z.output<typeof attemptResultSchema>, ReadonlySet<string>> = {
      covered: new Set(["continue", "complete"]),
      partial: new Set(["retry"]),
      missed: new Set(["retry"]),
      needsReview: new Set(["reviewSource"]),
    };
    if (!expectedActions[value.attempt.result].has(value.nextAction)) {
      context.addIssue({
        code: "custom",
        message: `nextAction is inconsistent with result ${value.attempt.result}`,
        path: ["nextAction"],
      });
    }
  });

export const compareSourceRequestSchema = z
  .object({
    sourceConversationId: uuidSchema,
    newSourceConversationId: uuidSchema,
    previousInstructionRevision: instructionRevisionSchema,
  })
  .strict()
  .refine(
    ({ newSourceConversationId, sourceConversationId }) =>
      newSourceConversationId !== sourceConversationId,
    {
      message: "comparison requires distinct source conversations",
      path: ["newSourceConversationId"],
    },
  );

export const compareSourceResponseSchema = z
  .object({
    previousSourceConversationId: uuidSchema,
    newSourceConversationId: uuidSchema,
    previousInstructionRevision: instructionRevisionSchema,
    changes: z.array(changeProposalSchema).max(TRANSPORT_COLLECTION_MAX),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.previousSourceConversationId === value.newSourceConversationId) {
      context.addIssue({
        code: "custom",
        message: "comparison requires distinct source conversations",
        path: ["newSourceConversationId"],
      });
    }

    const changeIds = value.changes.map(({ id }) => id);
    const previousInstructionIds = value.changes.map(({ previousInstructionId }) =>
      previousInstructionId,
    );
    const replacementInstructionIds = value.changes.map(
      ({ replacementInstruction }) => replacementInstruction.id,
    );
    for (const [ids, message, path] of [
      [changeIds, "change proposal IDs must be unique", "changes"],
      [previousInstructionIds, "previous instruction IDs must be unique", "changes"],
      [replacementInstructionIds, "replacement instruction IDs must be unique", "changes"],
    ] as const) {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: "custom", message, path: [path] });
      }
    }

    const references = new Set<string>();
    for (const [index, change] of value.changes.entries()) {
      for (const id of change.previousSourceEvidence) references.add(id);
      for (const id of change.replacementInstruction.sourceEvidence) references.add(id);

      if (change.status !== "needsReview") {
        context.addIssue({
          code: "custom",
          message: "compare responses may only contain proposals needing review",
          path: ["changes", index, "status"],
        });
      }
      if (change.replacementInstruction.sourceConversationId !== value.newSourceConversationId) {
        context.addIssue({
          code: "custom",
          message: "replacement instruction must belong to the new source conversation",
          path: ["changes", index, "replacementInstruction", "sourceConversationId"],
        });
      }
      validateEvidenceProvenance(
        new Set(change.previousSourceEvidence),
        value.sourceEvidence,
        {
          sourceConversationId: value.previousSourceConversationId,
          sourceRevision: change.previousSourceRevision,
        },
        context,
      );
      validateEvidenceProvenance(
        new Set(change.replacementInstruction.sourceEvidence),
        value.sourceEvidence,
        {
          sourceConversationId: value.newSourceConversationId,
          sourceRevision: change.sourceRevision,
        },
        context,
      );
    }
    validateEvidenceResolution(references, value.sourceEvidence, context);
  });

export const createOpenQuestionRequestSchema = z
  .object({
    sourceConversationId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    instructionId: uuidSchema.optional(),
    question: requiredLongTextSchema,
    sourceEvidence: sourceEvidenceReferencesSchema,
    shareConsent: z.boolean().default(false),
  })
  .strict();

export const createOpenQuestionResponseSchema = z
  .object({
    openQuestion: z
      .object({
        ...openQuestionSchema.shape,
        status: z.literal("open"),
      })
      .strict(),
  })
  .strict();

export const updateOpenQuestionRequestSchema = z
  .object({
    openQuestionId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    question: requiredLongTextSchema.optional(),
    status: openQuestionStatusSchema.optional(),
    shareConsent: z.boolean().optional(),
    resolution: requiredLongTextSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.question === undefined &&
      value.status === undefined &&
      value.shareConsent === undefined &&
      value.resolution === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "at least one open-question update is required",
      });
    }

    if (value.status === "resolved" && value.resolution === undefined) {
      context.addIssue({
        code: "custom",
        message: "resolving a question requires resolution",
        path: ["resolution"],
      });
    }
  });

export const updateOpenQuestionResponseSchema = z
  .object({
    openQuestion: openQuestionSchema,
  })
  .strict();

export const confirmChangeRequestSchema = z
  .object({
    changeId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
  })
  .strict();

export const confirmChangeResponseSchema = z
  .object({
    changeProposal: changeProposalSchema,
    previousInstruction: instructionCardSchema,
    replacementInstruction: instructionCardSchema,
    stalePracticeSetIds: z
      .array(uuidSchema)
      .max(TRANSPORT_COLLECTION_MAX)
      .refine(hasUniqueStrings, "stalePracticeSetIds must be unique"),
    changeDrill: z
      .object({
        practiceSet: practiceSetSchema,
        scenarios: z.array(scenarioSchema).length(1),
      })
      .strict(),
    sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.changeProposal.status !== "confirmed") {
      context.addIssue({
        code: "custom",
        message: "confirmed change response requires a confirmed proposal",
        path: ["changeProposal", "status"],
      });
    }
    if (value.previousInstruction.status !== "changed") {
      context.addIssue({
        code: "custom",
        message: "previous instruction must be changed",
        path: ["previousInstruction", "status"],
      });
    }
    if (value.replacementInstruction.status !== "confirmed") {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must be confirmed",
        path: ["replacementInstruction", "status"],
      });
    }
    if (value.stalePracticeSetIds.includes(value.changeDrill.practiceSet.id)) {
      context.addIssue({
        code: "custom",
        message: "the new Change Drill cannot be stale in the confirmation response",
        path: ["stalePracticeSetIds"],
      });
    }
    if (value.previousInstruction.id !== value.changeProposal.previousInstructionId) {
      context.addIssue({
        code: "custom",
        message: "previous instruction must match the confirmed proposal",
        path: ["previousInstruction", "id"],
      });
    }
    if (value.replacementInstruction.id !== value.changeProposal.replacementInstruction.id) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must match the confirmed proposal",
        path: ["replacementInstruction", "id"],
      });
    }
    if (!sameInstructionCard(value.replacementInstruction, value.changeProposal.replacementInstruction)) {
      context.addIssue({
        code: "custom",
        message: "replacement instruction must exactly match the confirmed proposal",
        path: ["replacementInstruction"],
      });
    }
    if (value.previousInstruction.sourceRevision !== value.changeProposal.previousSourceRevision) {
      context.addIssue({
        code: "custom",
        message: "previous instruction revision must match the confirmed proposal",
        path: ["previousInstruction", "sourceRevision"],
      });
    }
    if (
      !sameStringSet(
        value.previousInstruction.sourceEvidence,
        value.changeProposal.previousSourceEvidence,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "previous instruction evidence must match the confirmed proposal",
        path: ["previousInstruction", "sourceEvidence"],
      });
    }

    validatePracticeBundle(
      value.changeDrill.practiceSet,
      value.changeDrill.scenarios,
      context,
    );
    if (
      value.changeDrill.practiceSet.kind !== "changeDrill" ||
      value.changeDrill.scenarios[0]?.kind !== "changeDrill"
    ) {
      context.addIssue({
        code: "custom",
        message: "change confirmation must return a Change Drill",
        path: ["changeDrill"],
      });
    }
    if (value.changeDrill.practiceSet.status !== "ready") {
      context.addIssue({
        code: "custom",
        message: "new Change Drill practice set must be ready",
        path: ["changeDrill", "practiceSet", "status"],
      });
    }

    const drillScenario = value.changeDrill.scenarios[0];
    if (
      value.changeDrill.practiceSet.sourceConversationId !==
        value.replacementInstruction.sourceConversationId ||
      value.changeDrill.practiceSet.sourceRevision !== value.replacementInstruction.sourceRevision
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill must use the replacement instruction source provenance",
        path: ["changeDrill", "practiceSet", "sourceRevision"],
      });
    }
    if (
      drillScenario !== undefined &&
      (drillScenario.expectedRuleIds.length !== 1 ||
        drillScenario.expectedRuleIds[0] !== value.replacementInstruction.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Change Drill must evaluate the confirmed replacement instruction",
        path: ["changeDrill", "scenarios", 0, "expectedRuleIds"],
      });
    }

    const drillEvidence = new Set(drillScenario?.sourceEvidence ?? []);
    const requiredEvidence = [
      ...value.changeProposal.previousSourceEvidence,
      ...value.replacementInstruction.sourceEvidence,
    ];
    if (!sameStringSet([...drillEvidence], requiredEvidence)) {
      context.addIssue({
        code: "custom",
        message: "Change Drill evidence must be exactly the previous and replacement evidence",
        path: ["changeDrill", "scenarios", 0, "sourceEvidence"],
      });
    }

    validateEvidenceResolution(
      new Set([
        ...value.previousInstruction.sourceEvidence,
        ...value.replacementInstruction.sourceEvidence,
        ...drillEvidence,
      ]),
      value.sourceEvidence,
      context,
    );
    validateEvidenceProvenance(
      new Set(value.previousInstruction.sourceEvidence),
      value.sourceEvidence,
      {
        sourceConversationId: value.previousInstruction.sourceConversationId,
        sourceRevision: value.changeProposal.previousSourceRevision,
      },
      context,
    );
    validateEvidenceProvenance(
      new Set(value.replacementInstruction.sourceEvidence),
      value.sourceEvidence,
      {
        sourceConversationId: value.replacementInstruction.sourceConversationId,
        sourceRevision: value.changeProposal.sourceRevision,
      },
      context,
    );
  });

export type Uuid = z.infer<typeof uuidSchema>;
export type BeeId = z.infer<typeof beeIdSchema>;
export type SourceRevision = z.infer<typeof sourceRevisionSchema>;
export type InstructionRevision = z.infer<typeof instructionRevisionSchema>;
export type SourceEvidenceId = z.infer<typeof sourceEvidenceIdSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type CharacterId = z.infer<typeof characterIdSchema>;
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type BeeProcessingStatus = z.infer<typeof beeProcessingStatusSchema>;
export type InstructionStatus = z.infer<typeof instructionStatusSchema>;
export type PracticeStatus = z.infer<typeof practiceStatusSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type InputMode = z.infer<typeof inputModeSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type OpenQuestionStatus = z.infer<typeof openQuestionStatusSchema>;
export type ChangeProposalStatus = z.infer<typeof changeProposalStatusSchema>;
export type BeeSpeaker = z.infer<typeof beeSpeakerSchema>;
export type BeeUtterance = z.infer<typeof beeUtteranceSchema>;
export type BeeConversationSummary = z.infer<typeof beeConversationSummarySchema>;
export type BeeBridgeHealthResponse = z.infer<typeof beeBridgeHealthResponseSchema>;
export type BeeBridgeHealth = BeeBridgeHealthResponse;
export type BeeSource = z.infer<typeof beeSourceSchema>;
export type ExcludedRange = z.infer<typeof excludedRangeSchema>;
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type SourceConversation = z.infer<typeof sourceConversationSchema>;
export type InstructionCard = z.infer<typeof instructionCardSchema>;
export type PracticeSet = z.infer<typeof practiceSetSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type ChangeProposal = z.infer<typeof changeProposalSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type HealthRequestInput = z.input<typeof healthRequestSchema>;
export type HealthRequest = z.output<typeof healthRequestSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ListBeeConversationsRequestInput = z.input<typeof listBeeConversationsRequestSchema>;
export type ListBeeConversationsRequest = z.output<typeof listBeeConversationsRequestSchema>;
export type ListBeeConversationsResponse = z.infer<typeof listBeeConversationsResponseSchema>;
export type GetBeeConversationRequestInput = z.input<typeof getBeeConversationRequestSchema>;
export type GetBeeConversationRequest = z.output<typeof getBeeConversationRequestSchema>;
export type GetBeeConversationResponse = z.infer<typeof getBeeConversationResponseSchema>;
export type RecentBeeChangesRequestInput = z.input<typeof recentBeeChangesRequestSchema>;
export type RecentBeeChangesRequest = z.output<typeof recentBeeChangesRequestSchema>;
export type RecentBeeChangesResponse = z.infer<typeof recentBeeChangesResponseSchema>;
export type ImportConversationRequestInput = z.input<typeof importConversationRequestSchema>;
export type ImportConversationRequest = z.output<typeof importConversationRequestSchema>;
export type ImportConversationResponse = z.infer<typeof importConversationResponseSchema>;
export type RevokeConsentRequestInput = z.input<typeof revokeConsentRequestSchema>;
export type RevokeConsentRequest = z.output<typeof revokeConsentRequestSchema>;
export type RevokeConsentResponse = z.infer<typeof revokeConsentResponseSchema>;
export type ExtractInstructionsRequestInput = z.input<typeof extractInstructionsRequestSchema>;
export type ExtractInstructionsRequest = z.output<typeof extractInstructionsRequestSchema>;
export type ExtractInstructionsResponse = z.infer<typeof extractInstructionsResponseSchema>;
export type UpdateInstructionRequestInput = z.input<typeof updateInstructionRequestSchema>;
export type UpdateInstructionRequest = z.output<typeof updateInstructionRequestSchema>;
export type UpdateInstructionResponse = z.infer<typeof updateInstructionResponseSchema>;
export type CreatePracticeSetRequestInput = z.input<typeof createPracticeSetRequestSchema>;
export type CreatePracticeSetRequest = z.output<typeof createPracticeSetRequestSchema>;
export type CreatePracticeSetResponse = z.infer<typeof createPracticeSetResponseSchema>;
export type GetPracticeSetRequestInput = z.input<typeof getPracticeSetRequestSchema>;
export type GetPracticeSetRequest = z.output<typeof getPracticeSetRequestSchema>;
export type GetPracticeSetResponse = z.infer<typeof getPracticeSetResponseSchema>;
export type CreateAttemptRequestInput = z.input<typeof createAttemptRequestSchema>;
export type CreateAttemptRequest = z.output<typeof createAttemptRequestSchema>;
export type CreateAttemptResponse = z.infer<typeof createAttemptResponseSchema>;
export type CompareSourceRequestInput = z.input<typeof compareSourceRequestSchema>;
export type CompareSourceRequest = z.output<typeof compareSourceRequestSchema>;
export type CompareSourceResponse = z.infer<typeof compareSourceResponseSchema>;
export type CreateOpenQuestionRequestInput = z.input<typeof createOpenQuestionRequestSchema>;
export type CreateOpenQuestionRequest = z.output<typeof createOpenQuestionRequestSchema>;
export type CreateOpenQuestionResponse = z.infer<typeof createOpenQuestionResponseSchema>;
export type UpdateOpenQuestionRequestInput = z.input<typeof updateOpenQuestionRequestSchema>;
export type UpdateOpenQuestionRequest = z.output<typeof updateOpenQuestionRequestSchema>;
export type UpdateOpenQuestionResponse = z.infer<typeof updateOpenQuestionResponseSchema>;
export type ConfirmChangeRequestInput = z.input<typeof confirmChangeRequestSchema>;
export type ConfirmChangeRequest = z.output<typeof confirmChangeRequestSchema>;
export type ConfirmChangeResponse = z.infer<typeof confirmChangeResponseSchema>;

export interface BeeAdapter {
  readonly sourceKind: SourceKind;
  health(): Promise<BeeBridgeHealthResponse>;
  listCandidateConversations(
    input: ListBeeConversationsRequest,
  ): Promise<ListBeeConversationsResponse>;
  getConversation(id: BeeId): Promise<BeeSource>;
  getRecentChanges(input: RecentBeeChangesRequest): Promise<RecentBeeChangesResponse>;
}

export type BeeAdapterRegistry = Record<SourceKind, BeeAdapter>;

export const listSavedSourcesRequestSchema = z.object({ sourceKind: sourceKindSchema, cursor: uuidSchema.optional(), limit: pageLimitSchema.default(20) }).strict();
export const listSavedSourcesResponseSchema = z.object({ items: z.array(sourceConversationSchema).max(100), nextCursor: uuidSchema.nullable() }).strict();
export const getSourceSessionRequestSchema = z.object({ sourceConversationId: uuidSchema }).strict();
/** Current review state permits reviewed statuses; initial extraction stays strict. */
export const reviewSnapshotSchema = z.object(extractInstructionsResponseSchema.shape).strict().superRefine((value, context) => {
  const records = [...value.items, ...value.openQuestions];
  if (new Set(records.map((r) => r.id)).size !== records.length) context.addIssue({ code: "custom", message: "Review record IDs must be unique" });
  for (const record of records) if (record.sourceConversationId !== value.sourceConversationId || record.sourceRevision !== value.sourceRevision) context.addIssue({ code: "custom", message: "Review records must match their source" });
  const references = referencedEvidenceIds(records);
  validateEvidenceResolution(references, value.sourceEvidence, context);
  validateEvidenceProvenance(references, value.sourceEvidence, value, context);
});
export const sourceSessionResponseSchema = z.object({
  sourceConversation: sourceConversationSchema,
  source: beeSourceSchema,
  excludedRanges: z.array(excludedRangeSchema).max(100),
  extraction: reviewSnapshotSchema.optional(),
  practices: z.array(z.object({ practice: getPracticeSetResponseSchema, attempts: z.array(attemptSchema) }).strict()).max(100),
  changes: z.array(changeProposalSchema).max(100),
  sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX),
}).strict().superRefine((value, context) => {
  const source = value.sourceConversation;
  if (source.consentStatus !== "confirmed" || source.status !== "ready" || value.source.id !== source.beeSourceId || value.source.sourceKind !== source.sourceKind || value.source.revision !== source.sourceRevision || createTranscriptHash(value.source.transcript) !== source.transcriptHash) context.addIssue({ code: "custom", message: "Session source must match the consented immutable import", path: ["source"] });
  if (value.extraction && (value.extraction.sourceConversationId !== source.id || value.extraction.sourceRevision !== source.sourceRevision)) context.addIssue({ code: "custom", message: "Extraction must match the selected source", path: ["extraction"] });
  for (const [index, bundle] of value.practices.entries()) {
    const practice = bundle.practice;
    if (practice.practiceSet.learnerId !== source.learnerId || practice.practiceSet.sourceKind !== source.sourceKind || !practice.instructions.some((r) => r.sourceConversationId === source.id)) context.addIssue({ code: "custom", message: "Practice must belong to this learner and selected source", path: ["practices", index] });
    for (const attempt of bundle.attempts) {
      const scenario = practice.scenarios.find((s) => s.id === attempt.scenarioId);
      if (!scenario || attempt.sourceRevision !== practice.practiceSet.sourceRevision || attempt.instructionRevision !== practice.practiceSet.instructionRevision || !sameStringSet(attempt.sourceEvidence, scenario.sourceEvidence) || !sameStringSet([...attempt.matchedRuleIds, ...attempt.missedRuleIds], scenario.expectedRuleIds)) context.addIssue({ code: "custom", message: "Attempt must match the saved practice and evidence", path: ["practices", index, "attempts"] });
    }
  }
  const references = new Set(value.changes.flatMap((c) => [...c.previousSourceEvidence, ...c.replacementInstruction.sourceEvidence]));
  validateEvidenceResolution(references, value.sourceEvidence, context);
});
export type ListSavedSourcesRequest = z.output<typeof listSavedSourcesRequestSchema>;
export type ListSavedSourcesRequestInput = z.input<typeof listSavedSourcesRequestSchema>;
export type ListSavedSourcesResponse = z.output<typeof listSavedSourcesResponseSchema>;
export type SourceSessionResponse = z.output<typeof sourceSessionResponseSchema>;

/** Private intended-action dialogue; source/interpretation comparison never supplies a grade. */
export const understandingResponseSchema = z.object({ requestId: uuidSchema, responseText: requiredLongTextSchema, inputMode: z.enum(["voice", "text"]), applicability:z.array(z.boolean()).max(20), feedback: requiredLongTextSchema, comparison: z.enum(["consistent", "possibleMismatch", "uncertain"]), createdAt: isoUtcDateTimeSchema }).strict();
export const understandingInitialComparisonSchema = z.object({ answerQuote: requiredLongTextSchema, exceptionIndex: z.number().int().min(0).max(19).nullable() }).strict();
export const understandingCheckSchema = z.object({
  initialComparison: understandingInitialComparisonSchema,
  reviewHistory:z.array(z.object({action:z.enum(["disputed","reopened"]),version:z.number().int().positive(),createdAt:isoUtcDateTimeSchema}).strict()).max(100),
  id: uuidSchema, requestId: uuidSchema, instruction: instructionCardSchema, instructionRevision: instructionRevisionSchema,
  explanation: requiredLongTextSchema, inputMode: z.enum(["voice", "text"]), version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["clarifying", "readyForConfirmation", "readyToRehearse", "disputed"]), applicability: z.array(z.boolean().nullable()).max(20),
  responses: z.array(understandingResponseSchema).max(20), createdAt: isoUtcDateTimeSchema, updatedAt: isoUtcDateTimeSchema,
}).strict().superRefine((v, c) => {
  if (!v.explanation.includes(v.initialComparison.answerQuote) || (v.initialComparison.exceptionIndex !== null && !v.instruction.exceptions[v.initialComparison.exceptionIndex])) c.addIssue({ code:"custom", message:"Initial comparison must use the learner's exact words and an existing exception" });
  if (v.instruction.status !== "confirmed" || v.applicability.length !== v.instruction.exceptions.length) c.addIssue({ code: "custom", message: "Dialogue must match a confirmed instruction and all exceptions" });
  if ((v.status === "readyForConfirmation" || v.status === "readyToRehearse") && v.applicability.includes(null)) c.addIssue({ code: "custom", message: "Unknown context cannot enter rehearsal" });
  if (v.status === "clarifying" && !v.applicability.includes(null)) c.addIssue({ code: "custom", message: "Clarification requires unknown context" });
  if (new Set(v.responses.map(r => r.requestId)).size !== v.responses.length) c.addIssue({ code: "custom", message: "Response IDs must be unique" });
});
export const createUnderstandingRequestSchema = z.object({ instructionId: uuidSchema, sourceRevision: sourceRevisionSchema, instructionRevision: instructionRevisionSchema, requestId: uuidSchema, explanation: requiredLongTextSchema, inputMode: z.enum(["voice", "text"]) }).strict();
const understandingUpdateBase = { checkId: uuidSchema, expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) };
export const updateUnderstandingRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...understandingUpdateBase, action: z.literal("clarify"), applicability: z.array(z.boolean().nullable()).max(20) }).strict(),
  z.object({ ...understandingUpdateBase, action: z.literal("dispute") }).strict(),
  z.object({ ...understandingUpdateBase, action: z.literal("reopen") }).strict(),
  z.object({ ...understandingUpdateBase, action: z.literal("confirmInterpretation") }).strict(),
  z.object({ ...understandingUpdateBase, action: z.literal("rehearse"), requestId: uuidSchema, responseText: requiredLongTextSchema, inputMode: z.enum(["voice", "text"]) }).strict(),
]);
export const understandingBundleSchema = z.object({ historical:z.boolean().optional(), check: understandingCheckSchema, sourceEvidence: z.array(sourceEvidenceSchema).max(EVIDENCE_BUNDLE_MAX) }).strict().superRefine((v,c) => {
  const refs = new Set(v.check.instruction.sourceEvidence); validateEvidenceResolution(refs,v.sourceEvidence,c); validateEvidenceProvenance(refs,v.sourceEvidence,v.check.instruction,c);
});
const historicalReadSchema=z.preprocess(value=>value==="true"?true:value==="false"?false:value,z.boolean().optional());
export const listUnderstandingRequestSchema = z.object({ sourceConversationId: uuidSchema,historical:historicalReadSchema }).strict();
export const getUnderstandingRequestSchema=z.object({checkId:uuidSchema,historical:historicalReadSchema}).strict();
export const listUnderstandingResponseSchema = z.object({ items: z.array(understandingBundleSchema).max(100) }).strict();
export type UnderstandingCheck = z.infer<typeof understandingCheckSchema>;
export type UnderstandingResponse = z.infer<typeof understandingResponseSchema>;
export type UnderstandingBundle = z.infer<typeof understandingBundleSchema>;
export type CreateUnderstandingRequest = z.infer<typeof createUnderstandingRequestSchema>;
export type UpdateUnderstandingRequest = z.infer<typeof updateUnderstandingRequestSchema>;

/** Source point selections use utterance IDs; legacy intervals retain half-open overlap. */
type TranscriptSelection = { startMs: number; endMs: number; timing?: { basis: "reportedTimestamp" | "reportedTimestamps" } | undefined; id?: string | undefined; utteranceIds?: readonly string[] | undefined };
export function transcriptSelectionsOverlap(left: TranscriptSelection, right: TranscriptSelection): boolean {
  if (left.timing || right.timing) {
    if (!left.timing || !right.timing) return false;
    const leftIds = left.utteranceIds ?? (left.id ? [left.id] : []);
    const rightIds = right.utteranceIds ?? (right.id ? [right.id] : []);
    return leftIds.some(id => rightIds.includes(id));
  }
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

export function excludedRangeForUtterance(utterance: BeeUtterance): ExcludedRange {
  return { startMs: utterance.startMs, endMs: utterance.endMs, ...(utterance.timing ? { timing: { basis: "reportedTimestamps" as const }, utteranceIds: [utterance.id] } : {}) };
}

/** Bind reported selections to the immutable source before any processing. */
export function excludedRangesMatchSource(source: BeeSource, ranges: readonly ExcludedRange[]): boolean {
  return ranges.every(range => {
    if (!!range.timing !== !!source.utterances[0]?.timing) return false;
    if (!range.timing) return true;
    const selected = source.utterances.filter(u => range.utteranceIds?.includes(u.id));
    return selected.length === range.utteranceIds?.length &&
      selected.every((u, index) => u.id === range.utteranceIds?.[index]) &&
      range.startMs === selected[0]?.startMs && range.endMs === selected.at(-1)?.endMs;
  });
}

export function sourceEvidenceForUtterance(sourceConversationId: string, sourceRevision: string, utterance: BeeUtterance): SourceEvidence {
  const identity = { sourceConversationId, sourceRevision, startMs: utterance.startMs, endMs: utterance.endMs, utteranceIds: [utterance.id], ...(utterance.timing ? { timing: { basis: "reportedTimestamps" as const } } : {}) };
  return sourceEvidenceSchema.parse({ ...identity, id: createSourceEvidenceId(identity), quote: utterance.text, ...(utterance.speaker ? { speakerLabel: utterance.speaker.label } : {}) });
}

/** Local review annotations. Original instruction and evidence snapshots are never edited. */
export const correctionTargetSchema = z.object({ sourceConversationId: uuidSchema, sourceRevision: sourceRevisionSchema, instructionId: uuidSchema, instructionRevision: instructionRevisionSchema, instruction: instructionCardSchema, originalUtterances:z.array(beeUtteranceSchema).min(1).max(100), sourceEvidence: z.array(sourceEvidenceSchema).min(1).max(100) }).strict().superRefine((v,c)=>{
  if(v.instruction.id!==v.instructionId||v.instruction.sourceConversationId!==v.sourceConversationId||v.instruction.sourceRevision!==v.sourceRevision)c.addIssue({code:'custom',message:'Correction target must match the original instruction'});
  const ids=new Set(v.sourceEvidence.flatMap(e=>e.utteranceIds));if(ids.size!==v.originalUtterances.length||new Set(v.originalUtterances.map(u=>u.id)).size!==ids.size||v.originalUtterances.some(u=>!ids.has(u.id)))c.addIssue({code:'custom',message:'Original utterances must resolve the exact evidence selection'});
  validateEvidenceResolution(new Set(v.instruction.sourceEvidence),v.sourceEvidence,c);validateEvidenceProvenance(new Set(v.instruction.sourceEvidence),v.sourceEvidence,v.instruction,c);
});
export const correctionAnnotationSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('attribution'),speakerName:requiredShortTextSchema,speakerRole:requiredShortTextSchema,preparation:z.enum(['retain','withhold'])}).strict(),
  z.object({type:z.literal('transcription'),correctedText:requiredLongTextSchema}).strict(),
  z.object({type:z.literal('interpretation'),meaning:z.enum(['suggestion','uncertain','originalInstruction'])}).strict(),
  z.object({type:z.literal('newRule'),changeId:uuidSchema,laterSourceConversationId:uuidSchema,laterSourceRevision:sourceRevisionSchema}).strict(),
]);
export const previewCorrectionRequestSchema = z.object({requestId:uuidSchema,target:correctionTargetSchema,after:correctionAnnotationSchema,recognizedText:requiredLongTextSchema,inputMode:z.enum(['voice','text']),revisesId:uuidSchema.optional()}).strict();
export const correctionEffectsSchema = z.object({instructionIds:z.array(uuidSchema).min(1).max(100),practiceSetIds:z.array(uuidSchema).max(100),withholdGrading:z.boolean(),generation:z.number().int().nonnegative(),dependencyFingerprint:requiredShortTextSchema,consequence:requiredLongTextSchema}).strict();
export const updateCorrectionRequestSchema=z.object({correctionId:uuidSchema,requestId:uuidSchema,expectedVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),action:z.enum(['confirm','skip','reopen','undo']),dependencyFingerprint:requiredShortTextSchema.optional()}).strict().superRefine((v,c)=>{if(v.action==='confirm'&&!v.dependencyFingerprint)c.addIssue({code:'custom',message:'Confirmation requires the reviewed dependency fingerprint'});});
export const correctionReviewEventSchema=z.object({requestId:uuidSchema,action:z.enum(['preview','confirm','skip','reopen','undo','supersede']),version:z.number().int().positive(),learnerId:uuidSchema,createdAt:isoUtcDateTimeSchema,request:updateCorrectionRequestSchema.optional(),practiceSetIds:z.array(uuidSchema).max(100).optional()}).strict();
export const sourceCorrectionSchema=z.object({id:uuidSchema,learnerId:uuidSchema,request:previewCorrectionRequestSchema,beforeMeaning:requiredLongTextSchema,afterMeaning:requiredLongTextSchema,effects:correctionEffectsSchema,status:z.enum(['preview','confirmed','skipped','reopened','undone','superseded']),version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),confirmedBy:uuidSchema.optional(),confirmedAt:isoUtcDateTimeSchema.optional(),createdAt:isoUtcDateTimeSchema,updatedAt:isoUtcDateTimeSchema,reviewHistory:z.array(correctionReviewEventSchema).min(1).max(100)}).strict().superRefine((v,c)=>{
  if(v.reviewHistory.some(e=>e.learnerId!==v.learnerId)||v.reviewHistory[0]?.requestId!==v.request.requestId||v.reviewHistory.at(-1)?.version!==v.version||v.confirmedBy&&v.confirmedBy!==v.learnerId)c.addIssue({code:'custom',message:'Correction chronology must belong to the confirming owner'});
});
export const listCorrectionsRequestSchema=z.object({sourceConversationId:uuidSchema}).strict();
export const listCorrectionsResponseSchema=z.object({items:z.array(sourceCorrectionSchema).max(100)}).strict();
export type CorrectionTarget=z.infer<typeof correctionTargetSchema>;
export type CorrectionAnnotation=z.infer<typeof correctionAnnotationSchema>;
export type PreviewCorrectionRequest=z.infer<typeof previewCorrectionRequestSchema>;
export type UpdateCorrectionRequest=z.infer<typeof updateCorrectionRequestSchema>;
export type SourceCorrection=z.infer<typeof sourceCorrectionSchema>;

// Learner credentials are transported once and retained only in client RAM.
export const authTokenSchema = z.string().min(1).max(16384).regex(/^\S+$/u);
export const signInRequestSchema = z.object({email:z.string().email().max(254),password:z.string().min(1).max(1024)}).strict();
export const refreshSessionRequestSchema = z.object({refreshToken:authTokenSchema}).strict();
export const learnerCredentialsSchema = z.object({accessToken:authTokenSchema,refreshToken:authTokenSchema,expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),learnerId:uuidSchema}).strict();
export const signOutRequestSchema = z.object({}).strict();
export const signOutResponseSchema = z.object({ok:z.literal(true)}).strict();
export type LearnerCredentials=z.infer<typeof learnerCredentialsSchema>;
export type SignInRequest=z.infer<typeof signInRequestSchema>;
