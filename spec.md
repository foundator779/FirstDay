# FirstDay Shared Build Specification

**Version:** 0.2.3
**Status:** Build contract for the hackathon MVP  
**Last updated:** 2026-09-11

This file is the shared technical contract for every Codex session working on FirstDay. Read it before writing code. The API names, payload shapes, state transitions, and source-evidence rules below are the source of truth.

## How to use this contract

At the start of every Codex session:

1. Read `README.md`, `spec.md`, `TASKS.md`, and `AGENTS.md`.
2. Report the current `Done`, `In progress`, `Blocked`, and `Next` tasks from `TASKS.md`.
3. Claim one task in `TASKS.md` before changing code.
4. Implement only against the contracts in this file. If a contract must change, update this file first and add a dated entry to the change log.
5. Run the smallest relevant verification command, then update the task status, verification result, and remaining work.

When asked “what work is left?”, inspect `TASKS.md` and report all incomplete tasks plus their dependencies. Do not infer completion from filenames alone.

## Product contract

FirstDay imports a consented, processed Bee conversation and turns explicit training instructions into source-backed practice scenarios. A learner reviews the extracted instructions, confirms or edits them, answers scenarios by voice or text, and receives feedback tied to the original transcript. A later conversation can change an instruction and generate a “what changed?” drill.

The MVP must prove this chain:

```text
Bee conversation → source evidence → confirmed instruction → generated scenario
→ learner response → evaluated evidence → retry or mastery state
```

The system must not generate a rule, scenario, or evaluation from an unsupported fact. An ambiguous transcript becomes `needsReview` or an `OpenQuestion`.

## Scope for the first working demo

- One learner account.
- One bookshop or café onboarding example.
- One real Bee conversation retrieved through the local bridge.
- One fixture transcript for offline development and demo recovery.
- Three confirmed instruction cards.
- Three generated scenarios.
- Voice response with text fallback.
- One changed instruction that creates a Change Drill.
- Original FirstDay character art and UI.

Out of scope: multi-tenant administration, a manager portal, background recording, automatic employment scoring, arbitrary occupations, an unrestricted chatbot, and direct raw-audio access from the Apple Watch.

## Architecture

```text
Apple Watch running Bee
  → Bee syncs and transcribes
  → Bee account
  → local bee-bridge on developer computer
  → FirstDay API
  → iOS app
  → extraction and confirmation
  → scenario engine
  → practice and evidence-backed results
```

The iOS app never stores Bee credentials. The local bridge owns authentication
for the pinned Bee CLI and exposes only the narrow endpoints listed below. A
production deployment may replace the bridge transport after the Bee
authentication model supports it, but that is not part of the MVP.

## Technology decisions

### Figma layout adaptation (2026-09-15)

Use the user-supplied medical UI kit (file r77BdScud0c2zezb2VVvSQ): Home 37:626, Message 14:453, and Complete appointments 18:47 as visual references. Adapt their white/blue/lavender palette, League Spartan font, rounded cards, message treatment and bottom navigation to FirstDay training content. Medical appointments, ratings, payment and diagnosis functions are not part of FirstDay. Bottom tabs expose Training, Practice, Questions and About; switching tabs preserves the current review/answer state. Search filters the actual conversation list. Source consent, human confirmation, evidence and grading contracts remain unchanged. Native system safe areas replace the reference's drawn status bar.

### Learner experience and uncertainty handling (2026-09-14)

The API now implements the existing compare and confirm-change endpoints through the repository. Comparison only proposes replacements linked to persisted previous confirmed instructions. Confirmation transactionally checks both sources' consent, the exact proposal snapshot and statuses; then changes the old instruction, confirms the replacement, stales affected practice sets and creates a one-scenario drill. Duplicate or racing confirmations fail without partial writes. Drill attempts require both source versions and the confirmed proposal. Revoking either source prevents further drill attempts.

The iPhone-first learner flow has four steps: choose training, select transcript passages and consent, review proposed rules, then rehearse. Source IDs and revision strings are secondary details, not primary learner navigation. A practice recap derives covered rules and retry counts from actual attempts; it must not claim workplace mastery or a measured learning improvement. Open questions remain private and appear in the recap. Change Drill compares old and new actions side by side, requires confirmation, stales earlier practice, and rehearses the updated rule with both sources visible.

Nova Pro (`us.amazon.nova-pro-v1:0`) is the selected accessible Bedrock model following account restrictions on Luna. Explicit uncertainty cues in included source utterances (for example "maybe", "not sure", "probably") force the affected content into an open question even if model output proposes a rule. The guard is conservative and incomplete; human review remains required. Questions already answered by an extracted clear procedure are not used as teaching rules. Provider and source-kind settings remain independent.

### Bedrock provider (2026-09-14)

The Bedrock repository uses grounded extraction validation: source revisions and prior lineage are checked against learner-owned, consented stored sources and exact evidence, without requiring the original bookshop fixture IDs or fixed timestamps. The deterministic fixture provider retains its strict bookshop validation. Both modes recheck the immutable extraction context at commit time; the model cannot select another learner's rule or bypass revoked consent.

`FIRSTDAY_AI_PROVIDER=bedrock` selects server-only Amazon Bedrock Converse with `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, and `BEDROCK_MODEL_ID` (default `us.amazon.nova-pro-v1:0`). The default remains `fixture`. AI provider and source kind are independent: fixture transcripts may exercise real inference while retaining fixture provenance and consent. Extraction, generation and grading are asynchronous. No API payload or state names change.

The model receives only included utterances for extraction and confirmed rules plus their evidence for practice. It proposes content and rule classifications; application code allocates IDs, binds exact source quotes/spans, requires review, derives result partitions, and controls persistence/progress. Invalid, unknown, truncated or failed responses fail closed without offline fallback or raw provider errors. A local Bedrock demo launcher loads the ignored root environment for the API, limits mobile environment values to public settings, and retains the offline launcher. The remote demo supports comparison, atomic change confirmation, stale practice and Change Drill with evidence from both sources.

### Synthetic development mode (2026-09-14)

Synthetic practice is a local, session-only development path with `sourceKind: "fixture"` throughout. It requires no Bee account or model credentials and must never claim live Bee authentication. The existing bookshop fixture remains available. Additional synthetic conversations exercise bounded conditional instructions (`When/If/Whenever <situation>, <action>.`) and explicit updates (`Update: When <same situation>, <new action>.`). This parser is not a general natural-language or live Bee extractor. Ambiguous conditional statements become private open questions.

The local demo uses the canonical import, extraction, review, practice, attempt, compare, and confirm-change shapes. Evidence is generated from the supplied utterance spans, not from fixed fixture IDs or memorized answers. Three confirmed cards create three scenarios. Conservative offline evaluation covers a normalized exact expected action (optionally prefixed by "I will" or "I would"); unfamiliar wording requests source review instead of inventing semantic correctness. Explicit changed rules require learner confirmation, stale every practice set using the old rule, and produce a one-scenario drill citing both source versions. Reloading the demo clears progress; durable Supabase persistence and live-provider wiring remain separate tasks.


- **Mobile:** Expo React Native, TypeScript, Expo Router.
- **Web companion:** Next.js, TypeScript, used for transcript/source inspection and demo support.
- **Bridge:** Node.js, TypeScript, authenticated `@beeai/cli@0.7.3` process.
- **API:** Node.js, TypeScript, REST JSON API.
- **Database:** Supabase Postgres with row-level security and private storage where needed.
- **Validation:** Zod at every process boundary.
- **LLM:** structured JSON extraction and bounded response classification. Amazon Bedrock is preferred when entering the AWS Builder mini-challenge; the app remains correct without model calls by using fixtures and deterministic rules.
- **Testing:** Vitest or Jest for contracts, extraction fixtures, scenario generation, and evaluator behavior.

## Shared identifiers and conventions

- API JSON uses `camelCase`.
- Database columns use `snake_case`.
- IDs are lowercase canonical UUID strings except Bee IDs and source-evidence
  IDs. UUID inputs are normalized to lowercase at the boundary before storage or
  evidence hashing. Bee CLI IDs may arrive as
  JSON numbers or strings; the bridge converts either form to an opaque, non-empty
  string before returning application JSON. No application schema accepts a
  numeric Bee ID.
- All timestamps are ISO 8601 UTC strings.
- Every mutable source-derived record includes `sourceRevision`. `BeeSource.revision`
  is the adapter-derived upstream change token; an imported record copies it to
  `sourceRevision`. Source and instruction revision strings are nonblank and at
  most 512 characters so the canonical `bee:<id>:<updatedAt>` token fits even
  when the opaque Bee ID reaches its 256-character bound.
- Every model-generated result includes `sourceEvidence` IDs.
- `null` means known empty; an omitted field means unavailable.
- Status values in application JSON are camelCase. In particular, the canonical
  value is `needsReview`, never `needs_review`.
- Time ranges are zero-based integer milliseconds and use half-open intervals
  `[startMs, endMs)`, with `endMs > startMs`.

## Domain schemas

The following TypeScript types are the canonical application contracts. Shared package code should export equivalent Zod schemas and inferred types.

```ts
type ConsentStatus = "pending" | "confirmed" | "revoked";
type SourceStatus = "processing" | "ready" | "failed";
type BeeProcessingStatus = "processing" | "processed" | "failed";
type InstructionStatus = "needsReview" | "confirmed" | "rejected" | "changed";
type PracticeStatus = "draft" | "ready" | "inProgress" | "complete" | "stale";
type AttemptResult = "covered" | "partial" | "missed" | "needsReview";
type NextAction = "continue" | "retry" | "reviewSource" | "complete";
type SourceEvidenceId = `evd_${string}`;
type SourceKind = "bee" | "fixture";
type CharacterId = "customer-rowan" | "guide-maya";

type BeeSpeaker = {
  label: string;
  name?: string;
};

type BeeUtterance = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: BeeSpeaker;
};

type BeeConversationSummary = {
  id: string;
  sourceKind: SourceKind;
  title: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: BeeProcessingStatus;
  revision?: string;
};

type BeeBridgeHealth = {
  authenticated: boolean;
  lastSyncAt?: string;
};

type BeeSource = {
  id: string;
  sourceKind: SourceKind;
  title: string;
  startedAt: string;
  endedAt?: string;
  status: "processed";
  transcript: string;
  utterances: BeeUtterance[];
  sourceUrl?: string;
  revision: string;
  speakers?: BeeSpeaker[];
};

type ExcludedRange = {
  startMs: number;
  endMs: number;
  reason?: string;
};

type SourceEvidence = {
  id: SourceEvidenceId;
  sourceConversationId: string;
  sourceRevision: string;
  startMs: number;
  endMs: number;
  quote: string;
  utteranceIds: string[];
  speakerLabel?: string;
};

type SourceConversation = {
  id: string;
  learnerId: string;
  beeSourceId: string;
  sourceKind: SourceKind;
  title: string;
  startedAt: string;
  endedAt?: string;
  transcriptHash: string;
  sourceRevision: string;
  consentStatus: ConsentStatus;
  consentConfirmedAt?: string;
  consentRevokedAt?: string;
  status: SourceStatus;
  importedAt: string;
  updatedAt: string;
};

type InstructionCard = {
  id: string;
  sourceConversationId: string;
  sourceRevision: string;
  text: string;
  situation: string;
  expectedAction: string;
  exceptions: string[];
  sourceEvidence: SourceEvidenceId[];
  confidence: number;
  status: InstructionStatus;
  supersedesId?: string;
  createdAt: string;
  updatedAt: string;
};

type PracticeSet = {
  id: string;
  learnerId: string;
  sourceConversationId: string;
  sourceRevision: string;
  sourceKind: SourceKind;
  title: string;
  kind: "standard" | "changeDrill";
  instructionRevision: string;
  status: PracticeStatus;
  scenarioIds: string[];
  createdAt: string;
  updatedAt: string;
};

type Scenario = {
  id: string;
  practiceSetId: string;
  sourceRevision: string;
  kind: "standard" | "changeDrill";
  characterId: CharacterId;
  prompt: string;
  context: string;
  expectedRuleIds: string[];
  acceptableSignals: string[];
  criticalMisses: string[];
  retryPrompt: string;
  sourceEvidence: SourceEvidenceId[];
  order: number;
};

type Attempt = {
  id: string;
  scenarioId: string;
  sourceRevision: string;
  instructionRevision: string;
  responseText: string;
  inputMode: "voice" | "text";
  matchedRuleIds: string[];
  missedRuleIds: string[];
  sourceEvidence: SourceEvidenceId[];
  result: AttemptResult;
  feedback: string;
  createdAt: string;
};

type OpenQuestion = {
  id: string;
  sourceConversationId: string;
  sourceRevision: string;
  instructionId?: string;
  question: string;
  sourceEvidence: SourceEvidenceId[];
  status: "open" | "resolved" | "dismissed";
  shareConsent: boolean;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
};

type ChangeProposal = {
  id: string;
  previousInstructionId: string;
  previousSourceRevision: string;
  previousSourceEvidence: SourceEvidenceId[];
  replacementInstruction: InstructionCard;
  sourceRevision: string;
  status: "needsReview" | "confirmed";
  createdAt: string;
  updatedAt: string;
};
```

Consent audit fields follow the one-way state machine: `pending` has neither
decision timestamp, `confirmed` has only `consentConfirmedAt`, and `revoked` has
both timestamps with revocation no earlier than confirmation. These timestamps
are written by the server.

`SourceEvidence.id` has the stable format `evd_<64 lowercase hexadecimal
characters>`. The digest is SHA-256 over the UTF-8 bytes of the canonical string
`<lowercase canonical sourceConversationId>\n<sourceRevision>\n<startMs>\n<endMs>`
with no trailing newline. The exported factory computes this digest synchronously, and
`sourceEvidenceSchema` recomputes it rather than accepting an arbitrary
well-formed digest. Evidence IDs are therefore stable for the same imported
source revision and span, while a changed
source revision necessarily produces a different ID. `quote` is the exact text
covered by the span; `utteranceIds` lists every overlapping `BeeUtterance.id`.
Evidence and excluded ranges use the same millisecond timeline, and extraction
must not emit evidence that overlaps an excluded range. Every response evidence
bundle contains each referenced evidence record exactly once and no unreferenced
records, preventing unrelated transcript ranges from being disclosed. Evidence
reference arrays are unique, as are entity IDs within list, extraction, practice,
and compare response collections. Draft practice sets have no scenarios; every
non-draft standard set has exactly three, and every non-draft Change Drill has
exactly one.
Evidence-reference and general transport collections contain at most 100 items;
scenario rule/signal arrays and instruction exception arrays contain at most 20.
Evidence response bundles contain at most 500 records, while a full Bee source
contains at most 10,000 utterances and 100 speakers. These limits are boundary
guards, not targets for MVP payload size.
The MVP cast IDs are limited to `customer-rowan` and `guide-maya`; new IDs enter
the contract only when matching shared UI metadata and art are implemented.
`BeeSource.utterances` has unique IDs, is ordered by `(startMs, endMs)`, and
`transcript` is the exact newline join of utterance `text` values without speaker
prefixes or whitespace normalization. `BeeSource.sourceUrl`, when present, is
an absolute HTTP or HTTPS URL. Source and summary `endedAt` values cannot precede
`startedAt`; persisted `SourceConversation` records enforce the same chronology.
Every exported schema parser, including `sourceEvidenceSchema.safeParse`, is
total for malformed input and reports validation failure instead of throwing.

## API contract

All application endpoints return JSON and require the FirstDay learner session
except `/health` and the local bridge health check. The API must use the error
envelope below for non-2xx responses. `packages/contracts` exports the following
Zod request/response schemas and their inferred TypeScript types:

### API runtime and trust semantics

The FirstDay API is a separate trust boundary from the local Bee bridge. Every
`/api/*` request, other than an allowed CORS preflight, carries
`Authorization: Bearer <learner-session-token>`. A server-injected
`SessionVerifier` derives `learnerId` exclusively from that token; route, query,
and body values can never supply or override learner identity. Missing,
malformed, expired, or unverifiable sessions return `UNAUTHENTICATED`.

Production/hosted authentication uses a fetch-based Supabase Auth verifier with
`SUPABASE_URL` and `SUPABASE_ANON_KEY`; it calls the Auth user endpoint with the
presented bearer token and accepts only a canonical UUID user ID from a
successful response. This verifier does not use, expose, or require a Supabase
service-role key. A fixed local demo session may be enabled only when both
`NODE_ENV` is not `production` and `FIRSTDAY_DATA_MODE=fixture`. Its token is
explicitly public development data, is unrelated to
`FIRSTDAY_BEE_BRIDGE_TOKEN`, and must not enable live or durable data access.
Neither the Bee bridge token nor a Supabase service-role key may appear in a
mobile bundle, public response, log, or error detail.

The API emits manual CORS headers only for configured, exact serialized origins.
Requests without `Origin` are allowed for native and server clients. An allowed
`OPTIONS` preflight is unauthenticated and returns the configured origin,
`Vary: Origin`, allowed headers `Authorization, Content-Type`, and allowed
methods `GET, POST, PATCH, OPTIONS`. A non-allowed origin receives no CORS grant.
The local Bee bridge remains a no-CORS loopback service.

Each handler validates one flattened request object assembled from its route
parameters, query, and JSON body. Duplicate query keys, non-scalar path/query
transport values, non-object bodies, unknown fields, and key collisions between
path, query, or body fail with `VALIDATION_ERROR`; canonical JSON arrays and
nested objects inside a request body remain intact for the route schema. GET
requests reject bodies. Mutation bodies use exactly `application/json`, with an
optional single case-insensitive `charset=utf-8` parameter, are limited to 64 KiB,
and malformed JSON is a canonical validation failure.
Request URLs are limited to 20 KiB so the bounded opaque cursor remains usable;
malformed percent escapes, invalid percent-encoded UTF-8, and longer URLs return
`VALIDATION_ERROR` after learner-session authentication. Unknown routes and
unsupported methods return `RESOURCE_NOT_FOUND`. Every non-2xx response,
including router, parser, authentication, malformed dependency-output, and
unexpected failures, is a validated `errorEnvelopeSchema` value with a fresh
UUID request ID and empty safe details. It never includes a raw dependency body,
token, SQL text, stack, executable path, or internal exception message; each
error code always uses its fixed canonical public message.

`buildApiServer(dependencies)` is side-effect free and receives the session
verifier, Bee gateway, repository, instruction extractor, scenario-engine
facade, clock, UUID source, and allowed origins. Direct execution validates
configuration and binds only to `127.0.0.1`; importing the module never starts a
listener. The local deterministic runtime uses a serialized, copy-on-write
in-memory repository. The SQL migration remains the durable Supabase contract,
but this MVP has no Supabase persistence adapter: setting `SUPABASE_*` enables
hosted session verification only and must not be described as durable API
persistence. The repository interface stays learner-scoped and Supabase-ready.

The API talks to exactly one loopback Bee HTTP gateway. It forwards normalized
`sourceKind`, `query`, `cursor`, and `limit` values without re-filtering or
rewriting them, authenticates with the server-only bridge token, validates every
bridge response, and correlates returned list kinds and detail kind/ID to the
request. Bridge not-found, not-ready, unauthenticated/unavailable, transport,
timeout, and malformed-output conditions map to the canonical public errors
without relaying bridge response text. Health treats a successful bridge
authentication state as `authenticated` or `unauthenticated`, and all transport,
timeout, or malformed-output failures as `unavailable`.

| Route | Request schema | Response schema |
| --- | --- | --- |
| `GET /health` | `healthRequestSchema` | `healthResponseSchema` |
| `GET /api/bee/conversations` | `listBeeConversationsRequestSchema` | `listBeeConversationsResponseSchema` |
| `GET /api/bee/conversations/:beeSourceId` | `getBeeConversationRequestSchema` | `getBeeConversationResponseSchema` |
| `POST /api/imports` | `importConversationRequestSchema` | `importConversationResponseSchema` |
| `POST /api/source-conversations/:sourceConversationId/consent/revoke` | `revokeConsentRequestSchema` | `revokeConsentResponseSchema` |
| `POST /api/source-conversations/:sourceConversationId/extract` | `extractInstructionsRequestSchema` | `extractInstructionsResponseSchema` |
| `PATCH /api/instructions/:instructionId` | `updateInstructionRequestSchema` | `updateInstructionResponseSchema` |
| `POST /api/practice-sets` | `createPracticeSetRequestSchema` | `createPracticeSetResponseSchema` |
| `GET /api/practice-sets/:practiceSetId` | `getPracticeSetRequestSchema` | `getPracticeSetResponseSchema` |
| `POST /api/scenarios/:scenarioId/attempts` | `createAttemptRequestSchema` | `createAttemptResponseSchema` |
| `POST /api/source-conversations/:sourceConversationId/compare` | `compareSourceRequestSchema` | `compareSourceResponseSchema` |
| `POST /api/open-questions` | `createOpenQuestionRequestSchema` | `createOpenQuestionResponseSchema` |
| `PATCH /api/open-questions/:openQuestionId` | `updateOpenQuestionRequestSchema` | `updateOpenQuestionResponseSchema` |
| `POST /api/changes/:changeId/confirm` | `confirmChangeRequestSchema` | `confirmChangeResponseSchema` |

Each `*RequestSchema` parses one flattened, normalized request object assembled
from route parameters, query values, and JSON body before application logic runs.
Consequently, mutation request schemas include their route ID even though that ID
arrives in the HTTP path. Each request schema exports a `*RequestInput` type using
`z.input` for unparsed client/HTTP values and a `*Request` type using `z.output`
for validated handler and adapter inputs. Response and domain types use validated
schema output.

### Health

`GET /health`

Request: an empty object after HTTP request normalization.

Response:

```json
{
  "ok": true,
  "service": "firstday-api",
  "version": "0.2.0",
  "beeBridge": "authenticated"
}
```

`beeBridge` is one of `authenticated`, `unauthenticated`, or `unavailable`.
The API version in this response is exactly `0.2.0` for this MVP runtime.

### List Bee conversations

`GET /api/bee/conversations?sourceKind=<bee|fixture>&query=<text>&cursor=<opaque>&limit=<number>`

Response:

```json
{
  "items": [
    {
      "id": "bee-conversation-123",
      "sourceKind": "bee",
      "title": "Bookshop onboarding",
      "startedAt": "2026-09-10T16:00:00Z",
      "endedAt": "2026-09-10T16:32:00Z",
      "durationMs": 1920000,
      "status": "processed"
    }
  ],
  "nextCursor": null
}
```

List items are `BeeConversationSummary` values and never contain `transcript` or
`utterances`. `sourceKind` is required; `query` and `cursor` are optional,
`limit` is an integer from 1 to 100, and `nextCursor` is either an opaque,
nonblank string of at most 16 KiB or `null`; response pages contain at most 100
unique conversation IDs. The FirstDay API forwards the normalized request and
forwards list inputs to the local bridge. The bridge owns filtering, ordering,
deduplication, and cursor pagination; neither the API nor mobile client re-filters
the returned page.

### Get a Bee conversation

`GET /api/bee/conversations/:beeSourceId`

Request: `{ "beeSourceId": "bee-conversation-123", "sourceKind": "bee" }`,
assembled from the route parameter and required query value. The source kind
selects the adapter and disambiguates opaque IDs shared by live and fixture data.

Response: `{ "conversation": BeeSource }` with the complete processed transcript
and timestamped `utterances`. A list result is never valid extraction input.

### Import a conversation

`POST /api/imports`

Request:

```json
{
  "beeSourceId": "bee-conversation-123",
  "sourceKind": "bee",
  "sourceRevision": "bee-revision-7",
  "consent": {
    "confirmed": true
  }
}
```

Response: `201 Created`

`{ "sourceConversation": SourceConversation }`.

The server fetches the complete source through the bridge, stores a transcript
hash, copies `BeeSource.revision` to `sourceRevision`, and rejects imports without
literal `consent.confirmed: true`. A false or missing confirmation returns
`CONSENT_REQUIRED`, not a successful pending import. `sourceKind` selects the
live or fixture adapter. The selected adapter's returned `BeeSource.sourceKind`
must equal the request, and that returned value is persisted; the server never
trusts an unsupported client label. `consentConfirmedAt` is server-authored and
is not accepted in the request. `sourceRevision` binds consent to the exact
previewed transcript; if the bridge fetch returns a different revision, import
returns `REVISION_CONFLICT` and requires a new preview/confirmation.
Every successful import response contains `consentStatus: "confirmed"` and
`status: "ready"`; `processing` is reserved for a future asynchronous import
workflow. `transcriptHash` is the lowercase hexadecimal SHA-256 digest of the
exact UTF-8 bytes of `BeeSource.transcript`. A source identity is the tuple
`(learnerId, sourceKind, beeSourceId, sourceRevision)`. Reimporting the same
identity with the same digest is idempotent, while the same identity with a
different digest is an integrity failure and must return `REVISION_CONFLICT`.
Import is the only idempotent mutation. The handler checks the literal consent
shape before ordinary request-schema parsing, so missing or false
`consent.confirmed` returns `CONSENT_REQUIRED` with HTTP 400 even when other
fields are malformed.

### Revoke source consent

`POST /api/source-conversations/:sourceConversationId/consent/revoke`

Request:

```json
{
  "sourceConversationId": "11111111-1111-4111-8111-111111111111",
  "sourceRevision": "bee-revision-7",
  "reason": "I no longer want this conversation used."
}
```

Response contains the updated `sourceConversation`, whose `consentStatus` is
`revoked`, and at most 100 unique `stalePracticeSetIds`. Revocation prevents all later extraction,
scenario generation, and attempt evaluation from the source. It does not silently
erase compact source, instruction, scenario, attempt, question, change, or consent
audit metadata. In the same transaction that records revocation, persistence
deletes the source's private raw transcript/material and extraction-input rows,
marks every affected non-stale practice set stale (including a completed set),
and blocks every later write of private raw or derived extraction material for
that source. The request's `sourceRevision` is an optimistic concurrency guard.
`consentRevokedAt` is server-authored and is not accepted in the request.

### Extract instruction cards

`POST /api/source-conversations/:sourceConversationId/extract`

Request:

```json
{
  "sourceConversationId": "11111111-1111-4111-8111-111111111111",
  "sourceRevision": "bee-revision-7",
  "excludedRanges": []
}
```

Response:

`{ "sourceConversationId": UUID, "sourceRevision": string,
"instructionRevision": string, "items": InstructionCard[],
"openQuestions": OpenQuestion[], "sourceEvidence": SourceEvidence[] }`.

Extraction may be asynchronous later, but the MVP may return synchronously for one short conversation. The response must never omit source evidence.
`excludedRanges` contains `ExcludedRange` values. `sourceEvidence` contains the
resolvable evidence records referenced by returned instructions and questions.
Extractor strategy is server-derived from the persisted source kind and service
configuration; clients cannot request a live or demo extraction mode.
Every newly extracted card has `status: "needsReview"`, and every newly
extracted question has `status: "open"` and `shareConsent: false`; extraction
cannot bypass learner review or opt a learner into sharing. An extracted
question's optional instruction link must resolve to an instruction owned by the
same learner and source revision. Before committing any extraction records, the
repository resolves every evidence span against the exact persisted source
utterances, including ordered utterance IDs, full span boundaries, exact quote,
and speaker label, and rejects evidence overlapping an excluded range. A failed
check rolls the entire extraction back. The server retains an immutable copy of
the parsed exclusions, passes the extractor a separate copy, and records every
UUID issued through its extractor allocator. Extracted instruction/question IDs
must be server-issued and their creation/update timestamps must equal the exact
server clock snapshot; dependency mutation or substitution is rejected before
persistence.
Extraction is allowed exactly once per imported source snapshot. The fixture
extractor is deterministic and is the implemented AI-001 strategy; a future live
structured-output provider is injected behind `InstructionExtractor`. Until one
is configured, extracting a live `sourceKind: "bee"` record returns
`INVALID_STATE` with HTTP 409 and that code's canonical public message. It never
silently applies the fixture extractor to live data. A fixture policy-update extraction receives the
learner's prior confirmed instruction context so the replacement can set the
exact `supersedesId`; lineage is derived from immutable source evidence and
snapshot identity, never learner-editable instruction text, situation, action, or
exceptions. The prior context carries repository-resolved evidence plus the
persisted source kind, Bee source ID, and revision; the fixture update accepts
only the exact onboarding fixture identity, so a different source with a
lookalike transcript or revision cannot enter the lineage. Its new instruction
snapshot links to the prior snapshot. Preparation is not continuing
authorization: the server retains an immutable lineage snapshot before calling
the extractor and gives the extractor only a separate deep copy. In the same
transaction that saves the extraction, the repository must bind every returned
`supersedesId` to that trusted snapshot and re-resolve the prior instruction,
its extraction revision, immutable evidence, and exact persisted source
identity. The prior source must still be `ready` with confirmed consent at
commit time. A dependency-substituted or context-mutated lineage is rejected as
malformed dependency output with no partial writes; consent revoked after
preparation but before commit returns `CONSENT_REVOKED` and also rolls the new
extraction back.

### Decide an instruction

`PATCH /api/instructions/:instructionId`

Request:

```json
{
  "instructionId": "33333333-3333-4333-8333-333333333333",
  "sourceRevision": "bee-revision-7",
  "status": "confirmed",
  "text": "Reservations last five days.",
  "expectedAction": "Check the reservation date before continuing."
}
```

Allowed statuses: `confirmed`, `rejected`, and `needsReview`. The request may edit
`text`, `situation`, `expectedAction`, or `exceptions` while making the decision,
and must include at least a status or one editable field. `sourceRevision` is
required and cannot be edited. Response: `{ "instruction": InstructionCard }`;
the returned status is `confirmed`, `rejected`, or `needsReview`. Ordinary
instruction edits cannot return `changed`, which is reserved for confirmed
change-proposal transitions.
A confirmed instruction is the only instruction eligible for scenario generation.
Instruction content and provenance may be edited only while its current status is
`needsReview`; after a card becomes `confirmed`, `rejected`, or `changed`, those
fields are immutable. Ordinary instruction review cannot install or confirm the
replacement attached to a change proposal. Only the atomic change-confirmation
operation may transition the previous card from `confirmed` to `changed` and its
replacement from `needsReview` to `confirmed`.
Same-state decisions are invalid transitions. Rejection is terminal in persisted
state; a client may offer only an unsaved local undo before sending the PATCH.
Repeated extraction or standard-practice creation for the same snapshot is
`INVALID_STATE`, not an idempotent success.

### Generate a practice set

`POST /api/practice-sets`

Request:

```json
{
  "sourceConversationId": "11111111-1111-4111-8111-111111111111",
  "sourceRevision": "bee-revision-7",
  "instructionIds": [
    "33333333-3333-4333-8333-333333333333",
    "36333333-3333-4333-8333-333333333333",
    "37333333-3333-4333-8333-333333333333"
  ],
  "title": "Bookshop first shift"
}
```

Response: `201 Created` with
`{ "practiceSet": PracticeSet, "scenarios": Scenario[], "sourceEvidence": SourceEvidence[] }`.

The scenario generator receives only confirmed instruction IDs. It must produce
three scenarios for the MVP and cite at least one source evidence ID per scenario.
For each scenario, those evidence IDs are exactly the union of immutable source
evidence on that scenario's expected instructions; a globally valid evidence
bundle cannot be reassigned between scenarios. The server, not the generator,
allocates the practice-set ID, ordered scenario IDs, and creation timestamp. The
repository checks the generated bundle against that exact allocation before an
atomic save, so malformed output leaves no partial set and can be retried.
The resulting `PracticeSet.sourceKind` is copied from its imported source so a
resumed or deep-linked fixture practice remains clearly labeled.

### Read a practice set

`GET /api/practice-sets/:practiceSetId`

Request: `{ "practiceSetId": "44444444-4444-4444-8444-444444444444" }`, populated from the route
parameter.

Response: `{ "practiceSet": PracticeSet, "scenarios": Scenario[],
"instructions": InstructionCard[], "changeProposal"?: ChangeProposal,
"sourceEvidence": SourceEvidence[],
"progress": { "completed": number, "total": number } }`. Scenario and
instruction IDs are unique, each expected rule resolves to a returned confirmed
instruction for an active set, and all bundle records are revision-consistent.
A stale set may instead return its historical expected instructions as `changed`;
active `draft`, `ready`, `inProgress`, and `complete` sets still require
`confirmed`. Standard responses
omit `changeProposal`. Change Drill responses include their confirmed proposal,
exactly the previous `changed` card and confirmed replacement card, and only the
old/new evidence linked by that proposal. `ready` sets have zero completed
scenarios; `inProgress` sets retain at least one incomplete scenario; `complete`
sets have completed all scenarios. `progress.completed` is the number of distinct
scenarios in the practice set that have at least one persisted `covered` attempt.
Retries and multiple covered attempts for the same scenario never increment
progress more than once.

### Submit an attempt

#### Spoken rehearsal (2026-09-15)

The learner may play the situation aloud, then explicitly start and stop speech
recognition. Microphone/speech permissions are requested only after Start speaking.
Recognition uses the operating system/browser speech service, which may process
audio remotely; explain this before recording. FirstDay does not persist raw audio.
The recognized transcript remains editable and is submitted only when the learner
chooses Check my answer, through the existing attempt endpoint with inputMode voice.
Manual text editing marks the answer as text. Empty transcripts cannot be submitted.
Text input remains available after denied permissions, unavailable recognition,
silence, or an interrupted recording; a failed recording preserves the prior draft.
Only finalized/stopped recognition may be submitted. Ignore callbacks from canceled
sessions, stop audio when leaving practice/backgrounding/resetting/changing scenario,
and never listen during prompt playback. Recognition is limited to 60 seconds.
Native keyboard-aware scrolling keeps the focused response/editor visible.
Spoken prompts use the current scenario text without inventing additional policy.
Offline grading remains conservative exact-action matching; semantic evaluation
still requires the configured Bedrock API. Speech recognition alone does not change
grading semantics or source provenance.

`POST /api/scenarios/:scenarioId/attempts`

Request:

```json
{
  "scenarioId": "55555555-5555-4555-8555-555555555555",
  "sourceRevision": "bee-revision-7",
  "instructionRevision": "instruction-revision-1",
  "responseText": "I would ask for the reservation phone number and check the date.",
  "inputMode": "voice"
}
```

Response: `{ "practiceSet": PracticeSet, "scenario": Scenario, "attempt": Attempt,
"instructions": InstructionCard[], "changeProposal"?: ChangeProposal,
"sourceEvidence": SourceEvidence[], "nextAction": NextAction }`.

`nextAction` is one of `continue`, `retry`, `reviewSource`, or `complete`. Voice
and text use this same request. Attempt records and responses always use the field
name `sourceEvidence`; the legacy field name `evidence` is not valid.
Both revisions are optimistic concurrency guards and are persisted on the
attempt. The response scenario belongs to and is listed by `practiceSet`; its
kind, source revision, and list position match that set. The attempt's scenario
ID, source revision, and instruction revision match the returned scenario and
practice set;
`matchedRuleIds` and `missedRuleIds` partition `scenario.expectedRuleIds`; and
the attempt's evidence IDs are exactly `scenario.sourceEvidence`. The evidence
bundle resolves those IDs exactly once and cannot include unrelated records.
For a standard scenario, `changeProposal` is omitted and `instructions` contains
exactly the confirmed expected rules. Those instructions share the practice
set's source conversation and revision, and their evidence union exactly
explains the scenario; each evidence record matches that source provenance. For
a Change Drill, `changeProposal` is required and confirmed,
`instructions` contains exactly its previous `changed` card and confirmed
replacement card, the scenario evaluates only the replacement, and its evidence
is exactly the proposal's old and new evidence with matching provenance. The
practice set uses the replacement instruction's source provenance.
`covered` therefore matches every expected rule and has no missed rules;
`partial` and `missed` require at least one missed rule.
Attempt creation rejects `draft`, `stale`, `complete`, or source-revoked practice
sets and rejects a scenario that already has a covered attempt. A covered
attempt moves a ready set to `inProgress` unless it covers the final unfinished
scenario, in which case it moves directly to `complete`; a one-scenario ready
Change Drill therefore completes on its first covered attempt. Partial, missed,
and needs-review attempts leave an otherwise-ready set ready.

### Detect changed instructions

`POST /api/source-conversations/:sourceConversationId/compare`

Request:

```json
{
  "sourceConversationId": "11111111-1111-4111-8111-111111111111",
  "newSourceConversationId": "12111111-1111-4111-8111-111111111111",
  "previousInstructionRevision": "instruction-revision-1"
}
```

Response: `{ "previousSourceConversationId": UUID,
"newSourceConversationId": UUID, "previousInstructionRevision": string,
"changes": ChangeProposal[], "sourceEvidence": SourceEvidence[] }`.

Both sources must already have been imported with confirmed consent; both the
request and response require distinct source conversation IDs, even when no
changes are found, and comparison never performs an implicit import.
Both sources must also already have persisted extraction snapshots, and the new
snapshot must descend from the supplied previous instruction revision.
Each returned `ChangeProposal` and replacement
instruction is persisted before the response, so both IDs can be used in the next
request.

### Confirm a changed instruction

`POST /api/changes/:changeId/confirm`

Request:

```json
{
  "changeId": "88888888-8888-4888-8888-888888888888",
  "sourceRevision": "bee-revision-8"
}
```

The response contains the confirmed `changeProposal`, the old instruction with
status `changed`, the replacement instruction with status `confirmed`, every
`stalePracticeSetId`, and a `changeDrill` containing one practice set and exactly
one scenario. The Change Drill scenario cites both the previous and replacement
`sourceEvidence` IDs. Confirmation is atomic: either all instruction/practice
transitions and the drill persist, or none do. The drill is `ready`, uses the
replacement source revision, has contiguous order starting at one, and evaluates
the confirmed replacement instruction. The duplicated top-level replacement
instruction is byte-for-byte equivalent to the proposal's nested replacement;
the previous instruction revision and evidence match the proposal's old side.
The newly created drill ID cannot appear among the stale practice-set IDs.
All decision timestamps are server-authored and are not request fields.

### Create and update an open question

`POST /api/open-questions`

Request fields are `sourceConversationId`, `sourceRevision`, optional
`instructionId`, `question`, one or more `sourceEvidence` IDs, and
`shareConsent` (default `false`). Response: `{ "openQuestion": OpenQuestion }`;
the newly created question always has `status: "open"`.

`PATCH /api/open-questions/:openQuestionId`

The normalized request requires `openQuestionId`, `sourceRevision`, and at least
one of `question`, `status`, `shareConsent`, or `resolution`. `status` is `open`,
`resolved`, or `dismissed`; `resolution` is required when setting `resolved`. Response:
`{ "openQuestion": OpenQuestion }`.
Question text, sharing consent, resolution, and status may be updated only while
the current question is `open`. `resolved` and `dismissed` are terminal states.
An update that leaves the question in the same status without another actual
field change, or attempts any update after a terminal status, is `INVALID_STATE`.

All persisted-object lookups are learner-scoped. A valid identifier belonging to
another learner is indistinguishable from a missing identifier and returns
`RESOURCE_NOT_FOUND`, never `FORBIDDEN`; this prevents identifier enumeration.

## Error contract

Every non-2xx response uses:

```json
{
  "error": {
    "code": "BEE_BRIDGE_UNAVAILABLE",
    "message": "The local Bee bridge is not reachable.",
    "details": {},
    "requestId": "99999999-9999-4999-8999-999999999999"
  }
}
```

Required error codes:

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `UNAUTHENTICATED` | 401 | FirstDay learner session is missing or expired. |
| `FORBIDDEN` | 403 | The learner cannot access this source or practice set. |
| `BEE_BRIDGE_UNAVAILABLE` | 503 | Local Bee bridge is offline or unauthenticated. |
| `BEE_SOURCE_NOT_FOUND` | 404 | The requested Bee conversation no longer exists. |
| `CONSENT_REQUIRED` | 400 | Import was attempted without explicit consent. |
| `SOURCE_NOT_READY` | 409 | Bee has not finished processing the conversation. |
| `NO_CONFIRMED_INSTRUCTIONS` | 409 | Scenario generation has no confirmed rules. |
| `STALE_PRACTICE_SET` | 409 | The practice set uses an old instruction revision. |
| `VALIDATION_ERROR` | 422 | The request failed schema validation. |
| `RESOURCE_NOT_FOUND` | 404 | A FirstDay source, instruction, practice set, scenario, question, or change does not exist. |
| `REVISION_CONFLICT` | 409 | A supplied source or instruction revision is no longer current. |
| `CONSENT_REVOKED` | 409 | The source may no longer be processed because its consent was revoked. |
| `INVALID_STATE` | 409 | The requested domain transition is not allowed from the current state. |
| `INTERNAL_ERROR` | 500 | An unexpected server failure occurred; details must not expose secrets. |

## Local Bee bridge contract

The bridge runs on the developer computer and authenticates with the locally
installed `@beeai/cli@0.7.3`. That pinned release is the only live transport
contract for this MVP. The bridge should support:

```ts
interface BeeAdapter {
  readonly sourceKind: SourceKind;
  listCandidateConversations(
    input: ListBeeConversationsRequest,
  ): Promise<ListBeeConversationsResponse>;
  getConversation(id: string): Promise<BeeSource>;
  getRecentChanges(
    input: RecentBeeChangesRequest,
  ): Promise<RecentBeeChangesResponse>;
  health(): Promise<BeeBridgeHealth>;
}

type BeeAdapterRegistry = Record<SourceKind, BeeAdapter>;
```

The bridge HTTP handler is the sole owner of the adapter registry. It chooses
`registry[request.sourceKind]`, rejects any response whose `sourceKind` differs
from the selected adapter, and never silently substitutes fixture data. The
FirstDay API forwards the normalized `sourceKind`, then revalidates the response;
it does not keep a second adapter registry.

The local HTTP bridge binds only to loopback at
`http://127.0.0.1:${FIRSTDAY_BEE_BRIDGE_PORT}` and exposes these internal routes:

| Internal route | Request schema | Response schema |
| --- | --- | --- |
| `GET /v1/health` | `healthRequestSchema` | `beeBridgeHealthResponseSchema` |
| `GET /v1/conversations` | `listBeeConversationsRequestSchema` | `listBeeConversationsResponseSchema` |
| `GET /v1/conversations/:beeSourceId` | `getBeeConversationRequestSchema` | `getBeeConversationResponseSchema` |
| `GET /v1/changes` | `recentBeeChangesRequestSchema` | `recentBeeChangesResponseSchema` |

Every bridge route requires
`Authorization: Bearer <FIRSTDAY_BEE_BRIDGE_TOKEN>`. The token is shared only
with the FirstDay API process, never embedded in mobile or returned in JSON.
Non-2xx bridge responses use `errorEnvelopeSchema`. The public `/api/bee/*`
routes remain separate learner-authenticated API proxies and revalidate bridge
responses.

`listCandidateConversations` and `getRecentChanges` use opaque cursors; an ISO
`since` timestamp is not part of the adapter contract. The bridge owns query
filtering and pagination. The public adapter inputs above are parsed outputs;
transport callers use the matching `*RequestInput` types before boundary
validation. Each adapter instance owns a fixed-capacity process-local
continuation store. A returned cursor is only a short versioned handle
authenticated with a process-local secret; the actual upstream cursor, buffered
items or IDs, complete seen-ID history, and operation boundary stay in an
immutable server-side snapshot. The store binds every handle to its operation,
`sourceKind`, and normalized query, and does not consume a snapshot when it is
read. The first successful page produced for a cursor and requested limit is
cached under that handle, so retrying the same valid request returns the
identical page without repeating mutable CLI work. Concurrent identical retries
share one in-flight computation, and an active handle is pinned while its
successor and cached page are recorded. A cached replay retains every successor
handle it returns while that replay remains reachable, so a cache hit never
returns a continuation already evicted from the same store; failed computations
are removed rather than poisoning later retries. The store holds at most 128
snapshots, rejects any serialized snapshot larger than 64 KiB, and uses FIFO
eviction to keep aggregate serialized snapshots and cached pages at or below
4 MiB; an oversized snapshot fails safely with `BEE_BRIDGE_UNAVAILABLE`. Cursor
text remains within the 16 KiB schema limit. Caller-supplied state, modified
handles, handles issued by another adapter instance, and handles missing after
process restart or bounded-store eviction fail with `VALIDATION_ERROR` before
any buffered value can be emitted or used to bypass CLI retrieval. After a
restart or eviction error, clients restart pagination without a cursor.

The current Bee CLI output is not the application contract. The live adapter
invokes the executable with an argument array, never through a shell, and maps
command failures to canonical errors without exposing command output, paths,
environment values, or authentication material. It normalizes CLI 0.7.3 output
as follows before Zod validation:

- positive numeric conversation and utterance IDs become strings with
  `String(rawId)`; fixture and future opaque string IDs stay unchanged. The live
  full-conversation command accepts only positive-integer ID syntax because that
  is the identifier form supported by CLI 0.7.3;
- every live summary and source gets `sourceKind: "bee"`; the fixture adapter
  emits `sourceKind: "fixture"`;
- numeric epoch timestamps are normalized to ISO UTC (`>= 10^12` is
  milliseconds, otherwise seconds), while `null` becomes an omitted field;
- title uses the first nonblank line of detail `short_summary`, then `summary`,
  trimmed deterministically to 256 characters, then `Bee conversation <id>`;
- raw states `ready`, `processed`, `complete`, or `completed` normalize to
  `processed`; `failed` or `error` normalize to `failed`; every other state is
  `processing`;
- because the CLI exposes no revision field, a full source revision is the
  deterministic adapter-derived upstream change token
  `bee:<id>:<normalized updated_at>`; list summaries may omit `revision` when
  upstream omits `updated_at`;
- detail normalization selects the first non-realtime transcription, falling
  back to the first transcription, matching the CLI's finalized-transcript
  presentation rather than its raw all-transcriptions JSON flattening;
- utterance timestamps become conversation-relative integer milliseconds.
  Every nonblank utterance must have finite exact `start` and `end` values with
  `end > start`; `spoken_at` alone never fabricates a span. If a nonblank
  utterance lacks a valid exact range, full-source normalization fails with
  `SOURCE_NOT_READY` rather than silently dropping transcript evidence;
- the transcript joins timestamp-ordered, validated utterance text with newline
  separators and preserves the exact utterance text. Speaker labels come from
  upstream or use the literal fallback `unknown`. `sourceUrl` is omitted unless
  Bee supplies an absolute HTTP or HTTPS conversation URL.

The upstream conversations-list command has cursor/limit but no query. For a
query—or whenever the requested FirstDay limit exceeds one upstream page—the
bridge walks upstream pages, filters normalized titles
case-insensitively, fills up to the requested FirstDay limit, and returns an
opaque authenticated handle for the server-side continuation snapshot. Mobile
and the API never receive buffered records and never re-filter this page.

Recent changes use `bee changed [--cursor <cursor>] --json` rather than an ISO
timestamp. Because that command includes heterogeneous change sections and has
no limit, the bridge ignores non-conversation sections, fetches full conversation
details to recover current state/revision, applies the requested limit locally,
and stores its upstream cursor, buffered conversation IDs, and complete seen-ID
history behind the opaque authenticated FirstDay cursor handle.

Health invokes plain `bee status` and uses its exit result; CLI 0.7.3 does not
offer a JSON status contract. The adapter has no separate transcript or realtime
stream operation. It always fetches a selected source through the complete
conversation command, and discovers updates by polling `bee changed` plus a
periodic conversations-list reconciliation. No MCP command equivalence is
assumed by this contract.

These mappings track the official Bee CLI conversation and changed-command
implementations: [conversations](https://github.com/bee-computer/bee-cli/blob/main/sources/resources/conversations/index.ts)
and [changed](https://github.com/bee-computer/bee-cli/blob/main/sources/commands/changed/index.ts).
The bridge's own `GET /v1/health` response and `BeeAdapter.health()` result are
validated by `beeBridgeHealthResponseSchema`; this is distinct from the FirstDay
API's aggregate `healthResponseSchema`. Cursor requests and pages returned by
`getRecentChanges` use `recentBeeChangesRequestSchema` and
`recentBeeChangesResponseSchema`. Recent-change schemas belong to the bridge
adapter boundary and do not add a public FirstDay API route.

Documented CLI commands:

```bash
npm install -g @beeai/cli@0.7.3
bee login
bee status
bee conversations list --limit 20 --json
bee conversations list --limit 20 --cursor <cursor> --json
bee conversations get <positive-integer-id> --json
bee changed --json
bee changed --cursor <cursor> --json
```

The bridge must:

- keep Bee credentials out of the iOS bundle;
- fetch the complete conversation after a learner selects it;
- preserve the Bee source ID, timestamps, speaker labels, and transcript;
- deduplicate by Bee source ID plus revision or transcript hash;
- poll changes and run a pull-and-resync pass so unavailable realtime events
  cannot leave FirstDay stale;
- expose a fixture adapter with the same interface for tests and demo recovery.

## Generation and evaluation rules

The extraction prompt must require JSON and enforce these rules:

- extract explicit instructions, conditions, exceptions, and decision points;
- attach a source span to every proposed instruction;
- distinguish instruction from opinion, small talk, and speculation;
- emit `needsReview` when a speaker, condition, or exception is unclear;
- emit an open question when sources contradict each other;
- never resolve contradictions by guessing.

The scenario generator receives only confirmed instructions and returns a finite state machine. It must not become an unrestricted chatbot. The evaluator first uses deterministic matching against expected signals and critical misses. A model may classify paraphrases, but the final result must include matched rules, missed rules, source evidence, and a bounded feedback string.

## Persistence contract

The relational schema separates learner-visible compact records in `public` from
raw transcript-derived material in an unexposed `private` schema. The normalized
public model contains `source_conversations`, `instruction_revisions`,
`source_evidence`, `instructions`, `instruction_evidence`, `change_proposals`,
`practice_sets`, `practice_set_instructions`, `scenarios`, `scenario_rules`,
`scenario_evidence`, `attempts`, `attempt_rule_results`, `open_questions`, and
`open_question_evidence`. Private storage contains `source_materials`,
`extraction_inputs`, and append-only `consent_events`.

`instructionRevision` identifies an extraction snapshot for one imported source.
It remains stable while the learner edits or decides the snapshot's review cards
before practice. Confirming a proposed source change creates the next instruction
revision, preserves the previous revision and evidence, and never rewrites the
old snapshot's provenance.

Every learner-scoped table carries `learner_id`. Relationships use composite
learner-aware unique keys and foreign keys so a row can never connect one
learner's source, instruction, scenario, attempt, question, evidence, or change
record to another learner's row. Server writes run through the trusted service
boundary. Client roles receive no mutation privileges. Each exposed public table
has RLS enabled and grants authenticated learners `SELECT` only through an
own-row policy using `(select auth.uid()) = learner_id`; `anon` has no table
access. The `private` schema and all of its objects revoke access from `PUBLIC`,
`anon`, and `authenticated` and are available only to the trusted server role.
Grants and RLS are both required and are tested independently.

Raw transcript text is stored only in `private.source_materials` and never copied
into learner-readable compact rows. `private.extraction_inputs` may retain only
the bounded raw/model input necessary for a consented extraction. The database
rejects private source or extraction material for a source whose consent is not
currently `confirmed`; revocation atomically deletes existing private material
and stales all affected practice sets while retaining the compact audit trail.

## State transitions

```text
source: processing → ready | failed
consent: pending → confirmed → revoked
instruction: needsReview → confirmed | rejected
instruction: confirmed → changed
practiceSet: draft → ready → inProgress → complete
practiceSet: ready | inProgress | complete → stale   (when its instruction revision changes)
practiceSet: draft | ready | inProgress | complete → stale   (when source consent is revoked)
attempt: created → covered | partial | missed | needsReview
openQuestion: open → resolved | dismissed
changeProposal: needsReview → confirmed
```

No client may grant itself a confirmed instruction, completion state, or mastery result. State transitions are accepted by the API after validating the learner identity and current revision.

## Security and privacy requirements

- Require explicit consent before importing a conversation.
- Make the default visibility learner-private.
- Store raw transcripts separately from compact instruction/scenario records.
- Do not expose unrelated transcript ranges in a scenario.
- Allow the learner to exclude transcript ranges before extraction.
- Do not use the app for medical, legal, financial, hazardous-equipment, or employment-evaluation decisions in the demo.
- Provide a clearly labeled fixture mode; never present fixture data as live Bee data.

## Acceptance criteria

The MVP is complete when all of the following are true:

- A real Bee conversation appears in the FirstDay picker through the local bridge.
- The selected conversation can be imported only after consent.
- At least three instruction cards are extracted with transcript evidence.
- The learner can confirm, edit, reject, or flag a card as a question.
- Three scenarios are generated only from confirmed cards.
- Voice and text responses reach the same attempt endpoint.
- The evaluator returns matched rules, missed rules, source evidence, and feedback.
- A later source changes one rule, stales the old practice set, and creates a Change Drill.
- The fixture adapter supports development when Bee is unavailable.
- Contract tests cover every endpoint and the main state transitions.
- The README contains setup and demo instructions, while `TASKS.md` accurately reports remaining work.

## Change log

| Date | Change | Author/session |
| --- | --- | --- |
| 2026-09-15 | Defined permission-gated spoken rehearsal, editable transcript review, voice/text attempt parity, cancellation/privacy behavior and native keyboard focus. Existing API payloads remain unchanged. | Codex `/root` |
| 2026-09-15 | Adapted the supplied Figma Home, Message and appointment layouts to native training, practice and recap screens; added functional search and four tabs that retain in-session review and answer drafts. API contracts remain unchanged. | Codex `/root` |
| 2026-09-14 | Defined the iPhone-first review/rehearsal/recap flow and conservative source-level uncertainty handling; selected accessible Nova Pro for the Bedrock demo. | Codex `/root` |
| 2026-09-14 | Added explicit Bedrock provider configuration, asynchronous AI operations, evidence validation and a remote fixture demo mode; canonical API and state contracts remain unchanged. | Codex `/root` |
| 2026-09-14 | Added explicitly synthetic, session-only API-shaped review/practice/change behavior, bounded conditional transcript parsing, conservative offline grading, and portable exact transcript hashing; live and durable integration remain separate. | Codex `/root/synthetic_demo` |
| 2026-09-11 | Made extraction preparation a non-authorizing snapshot: the server retains immutable prior lineage, and extraction persistence transactionally re-resolves exact prior instruction/source/evidence identity plus current consent before accepting any `supersedesId`. | Codex `/root/api_backend` |
| 2026-09-11 | Made extraction exclusions an immutable server snapshot and bound extracted record IDs and timestamps to values issued by the injected server allocator and clock. | Codex `/root/api_backend` |
| 2026-09-11 | Scoped fixture update lineage to repository-resolved prior evidence and the exact persisted onboarding source kind, Bee ID, and revision, excluding candidate-relative lookalike sources. | Codex `/root/api_backend` |
| 2026-09-11 | Bound each generated scenario to its own expected rules' immutable evidence and required standard-practice persistence to match exact server-allocated IDs, order, and timestamps. | Codex `/root/api_backend` |
| 2026-09-11 | Bound extraction persistence to exact private-source utterances and exclusions, kept extractor-created questions private and source-consistent, and made fixture update lineage depend only on immutable evidence/snapshot identity. | Codex `/root/api_backend` |
| 2026-09-11 | Clarified scalar-only path/query transport handling versus nested JSON bodies, exact mutation media types, authenticated malformed percent/UTF-8 rejection, and fixed per-code public error messages including an unconfigured live extractor. | Codex `/root/api_backend` |
| 2026-09-11 | Defined the learner-session boundary, exact-origin CORS, flattened request limits, sanitized router/dependency errors, loopback runtime, in-memory persistence scope, Bee gateway correlation, consent precedence and import identity, deterministic fixture/live-extractor split, terminal review states, attempt progression, extracted-source comparison lineage, and privacy-preserving learner lookups for the FirstDay API. | Codex `/root/api_backend` |
| 2026-09-11 | Defined normalized learner-scoped persistence, exact transcript/source identity hashing, extraction-snapshot instruction revisions, immutable reviewed cards and terminal questions, distinct-scenario progress, explicit authenticated read-only RLS, private raw-material isolation, and atomic revocation cleanup/staling including completed sets. | Codex `/root/database_rls` |
| 2026-09-11 | Replaced caller-decodable state-bearing Bee cursors with authenticated process-local continuation handles; bound stored immutable state to adapter operation, source kind, and normalized query; retained complete seen-ID history and cached-page successors; and defined restart/eviction recovery. | Codex `/root/bee_adapter` |
| 2026-09-11 | Pinned the live bridge boundary to `@beeai/cli@0.7.3`; replaced unsupported ping, separate-transcript, stream, and assumed MCP commands with verified status, list, get, and changed operations; and defined safe process execution, live numeric IDs, polling, and reconciliation limits. | Codex `/root/bee_adapter` |
| 2026-09-10 | Capped consent-revocation stale-set IDs and added practice, instruction, and change context so standard and Change Drill attempt responses prove that scenarios, rules, and evidence come from the claimed source records. | Codex `/root/contracts` |
| 2026-09-10 | Made evidence parsing total; bounded revisions and collections; restricted source URLs and conversation chronology; allowed historical `changed` rules in stale-set reads; and bound attempt rule, revision, and evidence results to the returned attempted scenario. | Codex `/root/contracts` |
| 2026-09-10 | Reconciled README bridge/application routes, summary/full Bee shapes, source kind, cursor, and camelCase status guidance; clarified response invariants so ordinary instruction PATCH responses cannot be `changed`, open-question creation returns only `open`, and compare responses require distinct source IDs even for an empty result. | Codex `/root/contracts` |
| 2026-09-10 | Canonicalized camelCase statuses; split Bee list summaries from full sources; defined live/fixture provenance, millisecond utterance/exclusion ranges, verified stable evidence IDs, exact evidence bundles, source revisions, server-owned consent timestamps, cursor pagination, internal bridge routing/auth, complete endpoint schemas and errors, consent revocation, open-question mutations, and persisted compare/confirm Change Drill flow. | Codex `/root/contracts` |
| 2026-09-10 | Initial shared contract for Bee import, grounded extraction, scenario generation, and Change Drill. | Codex |
