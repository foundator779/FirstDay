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

### Physical iOS 27 build compatibility (2026-09-29)

Physical builds made with Xcode 27 require UIKit scene lifecycle support. Keep
Expo SDK 57, require Expo patch 57.0.23 or newer, and configure the official
`expo-build-properties` build-time plugin with `ios.enableSceneSupport: true`.
Generated native projects remain ignored; prebuild must reproduce the scene
manifest and factory-provider wiring. No Bee credentials or server tokens enter
the device bundle. Validate launch on the paired physical device after rebuilding.

### Supported practice selection and second-source review (2026-09-29)

Standard practice continues to require exactly three confirmed instructions from
one source snapshot. The learner screen always explains this requirement. With
fewer than three it shows the number still needed and recovery actions; with
more than three it lets the learner choose exactly three. Recaps describe only
instructions actually used by the generated scenarios. Recap attempt counts include
only scenarios in the currently displayed practice set. Restored instruction
snapshots apply only while that restored practice ID remains current. Choosing
fresh practice clears local attempts, feedback and prior comparison state; the
server retains earlier scenarios and attempts as immutable history.

Change Drill selection uses the existing learner-authenticated conversation list
and get endpoints for either source kind. The learner chooses a distinct,
processed second conversation of the same source kind, reviews its utterances,
may exclude private ranges, and explicitly confirms consent before import and
extraction. Compare and confirm retain their existing transactional contracts.
Every returned proposal is individually reviewable; an empty comparison offers
recovery rather than failing or inventing a change. Model/network failure keeps
the selected source, exclusions and successful import/extraction checkpoints so
retry cannot repeat a completed extraction. This is learner-selected comparison,
not automatic live synchronization.

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
- Metadata timestamps are ISO 8601 UTC strings; typed reported transcript points use literal epoch milliseconds.
- Every mutable source-derived record includes `sourceRevision`. `BeeSource.revision`
  is the adapter-derived upstream change token; an imported record copies it to
  `sourceRevision`. Source and instruction revision strings are nonblank and at
  most 512 characters so the canonical `bee:<id>:<updatedAt>` token fits even
  when the opaque Bee ID reaches its 256-character bound.
- Every model-generated result includes `sourceEvidence` IDs.
- `null` means known empty; an omitted field means unavailable.
- Status values in application JSON are camelCase. In particular, the canonical
  value is `needsReview`, never `needs_review`.
- Legacy time ranges are zero-based integer milliseconds and use half-open intervals
  `[startMs, endMs)`, with `endMs > startMs`. Typed reported timestamp selections
  use exact utterance IDs and point bounds, including zero width.

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
  timing?: { basis: "reportedTimestamp"; rawStart?: number | null; rawEnd?: number | null };
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
  timing?: { basis: "reportedTimestamps" };
  utteranceIds?: string[]; // required only for reported timestamp selection
  startMs: number;
  endMs: number;
  reason?: string;
};

type SourceEvidence = {
  timing?: { basis: "reportedTimestamps" };
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

Live final transcripts preserve the existing relative interval normalization when every nonblank utterance has a valid absolute start/end interval. If that interpretation fails, all nonblank final utterances must instead provide a nonnegative finite safe integer `spoken_at` with `0 <= spoken_at <= 8640000000000000` in the existing timestamp domain. Do not infer seconds, relative timing units, origin, duration or bounds. In this uniform mode `startMs === endMs === spoken_at`, `timing.basis` is `reportedTimestamp`, and finite numeric/null raw start/end fields are retained uninterpreted. Invalid or ambiguous metadata and realtime-only transcripts fail closed. Conversation start/end metadata remains unchanged even when a reported point is outside those bounds. Exact nonblank text is retained, IDs are unique, and order is start/end/ID. Full point-source revisions append a SHA-256 fingerprint of the normalized utterance timing, IDs, exact text and speaker; legacy source revisions stay unchanged. Picker summaries may have the legacy revision; preview/get/import must bind the full revision.

Evidence and exclusions for this mode carry `timing: { basis: "reportedTimestamps" }` and exact ordered unique utterance IDs. Their start/end equal the minimum/maximum reported timestamp of that selection; a zero width is permitted only with this discriminator. Selection, exclusion and highlighting use IDs, preserving coincident points independently. Validation binds the discriminator, ordered IDs, span, exact quote and speaker to the immutable source. Point evidence hashes extend the legacy canonical string with `\nreportedTimestamps\n` and JSON serialization of the ordered ID array. Interval evidence retains its original four-field hash and overlap behavior. The database stores optional evidence timing JSONB, validates both hash forms and binds point evidence bounds, ordered IDs, exact quote and speaker to private source material. Display reported wall timestamps with “duration unavailable”; never show them as elapsed offsets or invent duration.

`SourceEvidence.id` has the stable format `evd_<64 lowercase hexadecimal
characters>`. The digest is SHA-256 over the UTF-8 bytes of the canonical string
`<lowercase canonical sourceConversationId>\n<sourceRevision>\n<startMs>\n<endMs>`
with no trailing newline. The exported factory computes this digest synchronously, and
`sourceEvidenceSchema` recomputes it rather than accepting an arbitrary
well-formed digest. Evidence IDs are therefore stable for the same imported
source revision and span, while a changed
source revision necessarily produces a different ID. `quote` is the exact text
covered by the span; legacy `utteranceIds` lists every overlapping `BeeUtterance.id`,
while reported evidence lists exactly the selected ordered IDs.
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
`BeeSource.utterances` has unique IDs, is ordered by `(startMs, endMs)` (with
lexicographic ID tie-breaking for reported points), and
`transcript` is the exact newline join of utterance `text` values without speaker
prefixes or whitespace normalization. `BeeSource.sourceUrl`, when present, is
an absolute HTTP or HTTPS URL. Source and summary `endedAt` values cannot precede
`startedAt`; persisted `SourceConversation` records enforce the same chronology.
Every exported schema parser, including `sourceEvidenceSchema.safeParse`, is
total for malformed input and reports validation failure instead of throwing.

## API contract

All application endpoints return JSON and require the FirstDay learner session
except `/health`, the defined sign-in/refresh routes, and the local bridge health check. The API must use the error
envelope below for non-2xx responses. `packages/contracts` exports the following
Zod request/response schemas and their inferred TypeScript types:

### API runtime and trust semantics

The FirstDay API is a separate trust boundary from the local Bee bridge. Every
`/api/*` request, other than the defined public sign-in/refresh routes and an
allowed CORS preflight, carries
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
`FIRSTDAY_BEE_BRIDGE_TOKEN`, and must not enable live data or hosted durable
storage access. An explicit `FIRSTDAY_STORAGE_MODE=supabase` with a loopback
database endpoint is available only for isolated fixture persistence validation.
Every runtime Supabase storage origin uses the strict origin validator; fixture
storage remains restricted to actual loopback hosts. HTTP fixture storage also
requires both `NODE_ENV=development` and `FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP=1`.
Direct injected repository helpers retain their isolated test seams.
Neither the Bee bridge token nor a Supabase service-role key may appear in a
mobile bundle, public response, log, or error detail.

### CONNECT-001 learner session and live owner boundary

Live production startup requires `FIRSTDAY_BEE_OWNER_ID`, a trusted canonical UUID,
server Supabase durable storage and Bedrock configuration. Every authenticated
application route is owner-only: the Auth `/auth/v1/user` response UUID must match
that server UUID before Bee, model or repository access. Email, user metadata,
request fields and decoded client JWT claims never establish ownership.
`buildApiServer` may retain explicit dependency injection for isolated tests.
Public `/health` returns the existing coarse source-free shape and in live mode
performs no Bee/model/repository request. The mobile picker retains this coarse
health result separately from `authenticatedList`, a boolean set only after a
successful list request through the current generation-bound live client.
`picker/loadSucceeded` carries this explicit signal; absent/false retains the
existing fixture/bridge-health behavior. Authenticated list success makes a Bee
picker `ready` when selectable results exist, or `empty` otherwise, even while
public health reports `unavailable`. Starting or failing a load clears the
signal, selection and items. A suppressed unauthenticated list never sets it;
a failed or stale-session list cannot claim success.

Auth broker routes are fixed, JSON-only, uncached, reject all query parameters,
and use the canonical error
envelope. `POST /api/auth/sign-in` accepts exactly `{email,password}` (email at
most254 characters, password1..1024). `POST /api/auth/refresh` accepts exactly
`{refreshToken}` (one non-whitespace token1..16384). Both return exactly
`{accessToken,refreshToken,expiresAt,learnerId}`: bounded opaque tokens, positive
integer Unix seconds expiry and the server-verified UUID. No other Auth fields
are returned. `POST /api/auth/sign-out` requires the owner bearer and exactly
`{}`; it returns `{ok:true}` only after GoTrue logout of the current session
(`scope=local`) succeeds; other device sessions are not targeted. Sign-in and
refresh are the only unauthenticated application routes (plus allowed preflight).
Wrong owner and all upstream credential failures return generic
`UNAUTHENTICATED`, before any returned credentials. Unknown auth routes require
normal authentication. Auth request bodies are at most20KiB; upstream JSON is
at most64KiB, bounded while streaming, with a5-second timeout and redirects
rejected. Upstream URLs are constructed only from validated server configuration;
there is no caller-selected URL. No passwords/tokens/upstream bodies are logged.

Supabase origin configuration is HTTPS with no userinfo/path/query/fragment.
Genuine HTTP Auth and PostgREST on an actual loopback hostname (`127.0.0.1`,
`localhost`, `[::1]`) is allowed only when `NODE_ENV=development` and
`FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP=1`; confusing numeric/encoded host aliases
are rejected. No protocol rewrite is used. Mobile live APIs require HTTPS;
HTTP is permitted only for actual loopback with the explicit
`EXPO_PUBLIC_FIRSTDAY_ALLOW_LOOPBACK_HTTP=1` developer configuration. A physical
phone requires an already trusted private HTTPS API origin; the launcher creates
no tunnel, listener exposure or network configuration.

Live mobile access/refresh credentials exist only in RAM. Static
`EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN` remains fictional fixture data only.
A session controller serializes refresh before expiry, never retries a failed
mutation automatically, and binds every request/result to its generation.
Sign-out, authentication failure or account switch synchronously invalidate
credentials and old results, unmount all learner/source state, cancel speech,
and clear device drafts before a new account becomes active. Late operations
cannot write prior drafts or send them using a new session. Draft writes use a
session lease invalidated before clearing; blocked clears prevent new sign-in.
Network mutation failures retain the same UUID for explicit correction and
understanding receipt recovery. Failed upstream logout still clears RAM and
reports a generic failure. GoTrue access JWTs may remain valid until expiry;
FirstDay does not claim immediate global access-token invalidation.

`npm run demo:live` validates mode/auth/storage/owner/Bedrock/ports before
starting loopback bridge/API. Expo inherits no `AWS_`, `BEDROCK_`, `SUPABASE_`,
`FIRSTDAY_`, `BEE_` or `EXPO_PUBLIC_` variables; it uses `EXPO_NO_DOTENV=1` and
only explicit public mode/API/developer-loopback settings. API CORS permits the
two exact local web origins at the selected Expo port. No live JWT is
accepted or bundled. Synthetic/Bedrock launchers apply the same inherited public
variable filtering. Bridge environment is a small explicit whitelist of runtime
and Bee configuration, with no Supabase/Bedrock credentials.

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
facade, clock, UUID source, allowed origins, and optional trusted-owner/auth
broker dependencies. Direct execution validates
configuration and binds only to `127.0.0.1`; importing the module never starts a
listener. The local deterministic runtime uses a serialized, copy-on-write
in-memory repository in fixture mode. Live mode requires the normalized Supabase
adapter and its server-only service-role key. Learner-scoped security-invoker
RPC transactions use a lock and version check; production state survives API
restart. The checked-in migrations retain the schema, RLS and state guards.

The API talks to exactly one loopback Bee HTTP gateway. It forwards normalized
`sourceKind`, `query`, `cursor`, and `limit` values without re-filtering or
rewriting them, authenticates with the server-only bridge token, validates every
bridge response, and correlates returned list kinds and detail kind/ID to the
request. Bridge not-found, not-ready, unauthenticated/unavailable, transport,
timeout, and malformed-output conditions map to the canonical public errors
without relaying bridge response text. Fixture/injected health treats a successful bridge
authentication state as `authenticated` or `unauthenticated`, and all transport,
timeout, or malformed-output failures as `unavailable`.

| Route | Request schema | Response schema |
| --- | --- | --- |
| 2026-09-29 | Defined explicit supported three-card selection/recovery, source-kind-preserving real update selection, transcript exclusions and consent, multiple/empty comparison handling and retry checkpoints. Existing endpoint contracts remain unchanged. | Codex `/root` |
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
- legacy metadata and absolute interval epoch timestamps are normalized to ISO UTC (`>= 10^12` is
  milliseconds, otherwise seconds), while `null` becomes an omitted field;
- title uses the first nonblank line of detail `short_summary`, then `summary`,
  trimmed deterministically to 256 characters, then `Bee conversation <id>`;
- raw states `ready`, `processed`, `complete`, or `completed` normalize to
  `processed`; `failed` or `error` normalize to `failed`; every other state is
  `processing`;
- because the CLI exposes no revision field, a full source revision is the
  deterministic adapter-derived upstream change token
  `bee:<id>:<normalized updated_at>` for valid legacy intervals. Reported point
  sources append `:reported:<normalized utterance SHA-256>`; list summaries may
  omit `revision` when upstream omits `updated_at` and never replace the full revision;
- detail normalization requires exactly one final non-realtime transcription;
  malformed realtime metadata, ambiguous multiple final records and realtime-only
  transcripts fail closed. Reported mode requires explicit `realtime: false`;
- utterance timestamps retain conversation-relative integer intervals when all
  nonblank final utterances have valid absolute start/end values. Otherwise every
  nonblank utterance must have a valid literal epoch-millisecond `spoken_at`, and
  the entire source uses the reported point mode defined above. Missing or invalid
  reported timestamps fail with `SOURCE_NOT_READY`. Do not fabricate durations,
  infer units, rebase/clamp points or drop nonblank transcript evidence;
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

- extract explicit instructions, conditions, exceptions, and decision points, including actionable declarative operating policies as well as imperative procedures;
- retain distinct time-window or eligibility policies separately from collection identity procedures unless the source explicitly combines them; preserve stated numbers, calendar/business-day basis, counting origin, order, conditions and exceptions without adding unstated actions or targeting a fixed number of cards;
- keep every mandatory action and quantitative constraint in `expectedAction`, including stated numbers/units, calendar or business-day basis, counting origin and required order; `text` or `situation` alone cannot carry requirements omitted from that action;
- reserve `exceptions` for genuine conditional modifiers or exemptions; an unconditional counting basis belongs to the ordinary `expectedAction`, never to an exception;
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

## Understanding checks and focused rehearsal

An understanding check is a private, persisted explanation dialogue bound to the learner, immutable instruction snapshot, source revision and instruction revision. It does not assign a mastery score or change the exactly-three standard-practice contract. The learner explains their intended action by voice or text. FirstDay shows that explanation beside exact source evidence and the confirmed action and exceptions, with a **possible mismatch**, never a guessed diagnosis. A bounded provider may select one existing exception by index; it cannot invent a condition, quote or policy. The application supplies the clarification question: whether that exact exception applies. If applicability is unknown, or the learner disputes the source interpretation, grading and rehearsal remain unavailable. For multiple exceptions every applicability must be resolved before rehearsal.

Routes (authenticated owner and current consent required):

- `POST /api/understanding-checks` creates a dialogue from `instructionId`, `sourceRevision`, `instructionRevision`, `explanation`, `inputMode` and a client-generated UUID `requestId` for interrupted-request recovery. Repeating the same request ID with identical content returns the existing record; altered reuse conflicts.
- `GET /api/source-conversations/:sourceConversationId/understanding-checks` lists that owner's bounded current dialogues and resolved evidence, revalidating source/instruction revisions. Revoked sources are rejected; stale instruction snapshots cannot continue.
- `PATCH /api/understanding-checks/:checkId` takes `expectedVersion` and an action: `clarify` (all exception applicability booleans or null/unknown), `dispute`, `confirmInterpretation` (explicit learner acceptance only after all context is known), `reopen` (explicit return from dispute after source review, resetting context to unknown), or `rehearse` (voice/text response plus idempotent `requestId`). Optimistic version guards prevent interrupted or concurrent clarification from silently overwriting another result. A dispute hands back to source/correction review and blocks all grading of that instruction, including existing practice. Linked unresolved private trainer questions also withhold grading; resolving a question records a private clarification through the existing question endpoint and never edits source policy. It cannot be cleared by creating another dialogue or ordinary explanation grading. The original check must be explicitly reopened after review; its dispute/reopen event history and earlier rehearsal answers with their own context snapshots remain recorded.

Initial Nova selection is restricted to an exact learner substring and an existing exception index. Supply explicit indexed source-clause choices and a request-specific tool schema whose permitted indexes are exactly those choices or null; never reinterpret a model's invalid one-based index. Application-owned comparison displays that intended action against the exact confirmed action and exception, with a specific context question for the canonical old/new reservation distinction. The offline mode uses the full learner explanation and shows all clauses without claiming semantic diagnosis.

Live extraction preserves a contiguous, explicit new-reservation duration and grandfathered existing-reservation clause directly from trusted source text. Binding requires a uniquely identifiable reservation-window card; a mixed utterance containing collection or refund procedures cannot transfer those clauses to unrelated cards. Mixed-source normalization retains the card's other action obligations. Ambiguous reservation bindings are withheld from extracted instructions and represented by private source-linked review questions, so they cannot be confirmed or graded as an incomplete policy. A source passage containing an explicit exception marker (such as unless, except, otherwise or grandfathered) cannot produce an exception-free instruction unless the bounded clause normalizer accounts for it; unresolved decomposition also requires source review.

When the entire passage contains only the two canonical window clauses, its source establishes the window topic for one uniquely bound reservation-status candidate; conflicting collection/damage candidates are withheld. Mixed passages retain the narrower target test. Remove only exact canonical matched spans before checking for remaining exception markers; one matched policy cannot exempt another unrepresented condition in the same utterance.

At the Nova extraction boundary only an omitted `exceptions` field defaults to an empty array, accommodating procedures with no exception while retaining the source-condition gate above. Present null, string, object or invalid array values remain invalid dependency output. All other required extraction fields remain required and strict; the returned shared instruction contract always includes `exceptions`.

State is `clarifying`, `readyForConfirmation`, `readyToRehearse`, or `disputed`. Initial explanations and clarification are ungraded. Focused rehearsal uses an application-generated prompt with the confirmed situation, explicit learner-provided exception applicability, and asks for the action. The response loop displays source-bound feedback and exact evidence and retains chronological attempts. Offline checking remains conservative and visibly synthetic; Nova Pro supports paraphrase comparison through the same bounded evaluator. Neither model suggestions nor private trainer-question resolutions can edit confirmed source rules. Questions use the existing private `open_questions` route with `shareConsent:false`; source corrections use the explicit correction-review flow. The screen provides exact original-source review and private question resolution/dismissal through the existing question PATCH route. Closing a question records the learner’s clarification and leaves the source policy unchanged; a disputed dialogue still requires explicit reopening and fresh context. Original source evidence is immutable.

Focused Nova comparison receives each exact exception beside its learner-supplied applicability. An applicable exception modifies only conflicting parts of the ordinary action; all unaffected obligations remain required. Conditions on the ordinary action restrict its scope, so an older-reservation answer need not repeat a rule explicitly scoped to new reservations. The echoed full source-action string remains an immutable provenance reference, not a demand to perform every conditional branch simultaneously. Unknown or conflicting meaning remains uncertain; the model cannot add situation facts or policy.

The application supplies a shared active comparison action to Nova, offline comparison and the rehearsal screen. Only the strict canonical sentence `New reservations last <duration> days.` may be removed when one exact applicable `Reservations already made keep their original <duration>-day window.` exception establishes the older context. Preserve every other ordinary-action sentence and applicable exception. Durations come from the confirmed clauses; no fixed demo numbers are substituted. Ambiguous or generic exceptions retain the full ordinary action. Keep the immutable full policy and original quotes visible. Focused inference receives only the application-owned active action and learner answer. Its strict output first contains a nonblank `actionComparison` brief policy/proposed-action comparison (maximum1000 characters), then the classification and exact answer quote. Distinguish a situation's elapsed time from the policy duration. Inference requires an exact nonempty learner-answer quote for every classification, using a plain object schema with minimum quote length1. Validate that quote before returning a comparison; map uncertain quotes to the existing empty application quote after validation. Do not substitute arbitrary quotes for positive comparisons. Discard this untrusted brief comparison; never store/display it or use it to create policy. The provider adapter attaches the known full source-action reference in application code; the model cannot invent or echo it. Unknown applicability or an unconfirmed/disputed stage produces no active action and is rejected before inference.

`public.understanding_checks` stores normalized owner/source/instruction/source-revision/instruction-revision identity, plus a bounded schema-validated dialogue JSONB payload. Its owner-only SELECT policy follows existing authenticated RLS; only the backend service can mutate it through the existing CAS repository RPC. Reads and writes re-resolve current consent, confirmed instruction status, exact instruction content and evidence at commit, including provider races. Device drafts use a distinct understanding context bound to learner/source/instruction/revisions and explanation/rehearsal phase (plus check ID for rehearsal). Restore them only after current authenticated source/check reads validate consent and confirmed instructions; use the existing dual-generation draft store and owner/sign-out/revocation clearing. Source revocation denies dialogue access; raw audio and credentials are never saved. At most100 dialogues per source and20 focused responses per dialogue; max4000 characters per explanation/response. Source evidence is returned as its original exact quote/span rather than model-generated text.

Understanding drafts also retain the request UUID allocated for that exact answer. Persist and verify the draft/UUID before a create/rehearse request; a persistence failure prevents submission. Reopening compares its UUID, trimmed text and input mode with the current source-bound check/response receipts, clears an already committed draft and displays its saved record without another provider call. Uncommitted retries reuse the UUID, even when a server response was lost. Allocate a new UUID only for a changed/new answer. Legacy understanding drafts without UUID remain readable and receive a UUID before their first submission; standard-practice draft format remains unchanged.

## Source correction review

Optional evening review presents up to three learner-selected uncertainties from consented sources. The learner speaks or types, reviews the recognized text, selects an exact source, instruction and original evidence span, previews the meaning and consequences, then explicitly confirms or skips. No policy, source, instruction, grading or practice effect occurs during preview. Sources and evidence are immutable; annotations never become verbatim evidence or trainer policy.

`POST /api/source-corrections/preview` accepts a UUID `requestId`, exact `target` (sourceConversationId/sourceRevision/instructionId/instructionRevision, original instruction snapshot, ordered full SourceEvidence snapshots and original selected utterances with exact speaker objects and timing metadata), correction type and reviewed `after` annotation, recognized text and input mode. The server validates all originals and derives before/after meanings, affected instruction IDs, practice IDs and current dependency fingerprint. Persisting the preview stores review metadata only. `GET /api/source-conversations/:sourceConversationId/corrections` returns owner-bound previews and append-only chronology under active consent. `PATCH /api/source-corrections/:correctionId` accepts UUID requestId, expectedVersion, preview fingerprint and action `confirm`, `skip`, `reopen` or `undo`. Every commit revalidates consent, exact originals, canonical lineage, overlapping annotations and preview-bound dependency state. Idempotent repeated UUIDs reconcile receipts; changed reuse conflicts. Revise creates a new preview with an explicit `revisesId` pointing to a reopened annotation; confirm replaces it atomically. All four types support revise. A revised new-rule annotation may only update local reviewed wording/input mode for the same still-current confirmed canonical change, immutable original target, actual later source and exact replacement lineage. Preview has no preparation effects. Confirmation atomically supersedes the reopened annotation and may create a fresh deterministic current drill after all gates and both consents are checked; it never reexecutes canonical policy replacement. A superseded replacement or revoked/deleted source rejects revised preview/confirmation. Reopening a confirmed annotation reimposes its review gate immediately. Skip has no effects for a new preview; skipping reopened work retains its gate. Undo removes the annotation gate but never restores a historically stale practice or a canonically changed rule. If reopening a confirmed new-rule annotation staled its current canonical Change Drill, undo may create a fresh deterministic drill under that same reviewed canonical version. Revalidate both source consents, latest replacement status/lineage and every active grading gate; a replacement superseded by another later confirmed change cannot regenerate an outdated drill. Retain old scenarios/attempts and record new drill IDs in the append-only undo event. No extra model call is made.

Types remain distinct: `attribution` annotates this conversation's speaker name/role separately from the original speaker and can withhold inappropriate preparation; `transcription` records corrected wording separately, disputes third-party policy and withholds affected grading; `interpretation` annotates suggestion/ambiguity rather than instruction and withholds or decommissions affected preparation; `newRule` requires a selected actual later consented source and an existing canonical ChangeProposal. Its confirmation executes the existing confirmChange transition and retains the exact change ID; typed recollection alone is rejected. Reopening/undo of local new-rule provenance cannot revert canonical change. Local annotations do not retrain models, assign another user's work, message anyone or write back to Bee.

Confirmed or reopened local withholding annotations block generation, standard and focused rehearsal/evaluation of their exact affected instructions across all routes, checks and existing attempts. Unrelated rules remain usable. Contradictory overlapping active annotations require reopening/revising or undo before confirmation. A transcription dispute remains nongraded until undone after source review or an actual source-backed canonical change supplies a replacement instruction. No remembered text creates a graded instruction. Prepared generation, evaluation, initial understanding and focused rehearsal contexts carry a shared correction review fingerprint and only confirmed, nonwithholding annotations for the exact owner/source/revision/instruction target. A canonical new-rule review contributes to fingerprints for its verified original and replacement source/instruction lineage; annotation text is projected only to its original target. Reopen/undo of that review invalidates replacement inference even if the replacement policy text remains unchanged. Retained attribution is explicitly user-corrected conversation-local context; it is never an independent quote or policy. Commits recheck this fingerprint after every provider await, including a confirm followed by undo during inference. Bedrock understanding comparison still receives only activeAction and learnerAnswer; application-owned provenance and approved context are bound outside that model call. Practice generations use a monotonically changing source correction generation bound into preparation and commit. A stale affected set permits a fresh exactly-three set after review; unaffected sets keep their current status. Older scenarios and standard/Change Drill attempts remain historical. If fewer than three eligible rules remain, the existing instruction-selection flow must ask the learner to select adequate confirmed source rules.

Practice GET and understanding GET/list require active consent for every dependent original source, including both sources of a historical Change Drill. Revocation retains stored history but denies retrieval through API and offline/direct repository reads. Understanding GET/list support explicit historical reads retaining original instruction/evidence, explanations, context, responses and review chronology under active source consent. Historical bundles are labeled historical and cannot continue or rehearse. Current mutations still require the exact current instruction and no active correction gate. Device correction drafts contain only learner/source/revisions, exact selected IDs, correction text/input mode/request UUID and pending/skipped metadata; no original transcript cache, tokens or raw audio. Restore after authenticated source and correction reads, reconcile committed UUIDs, preserve up to three pending/skipped items and clear on sign-out/revocation. History lifecycle actions reserve/reuse a device slot bound to their exact owner, source/revisions and correction request UUID; unrelated pending/skipped items cannot be overwritten or cleared. If all three uncertainties are occupied, fail before sending the history request. Clearing a resolved receipt checks its matching UUID atomically. Explicit revision may reuse that correction's own slot with a new request UUID. Preview receipt persistence uses the captured submitted text/annotation/target/UUID, never mutable editing state after an await; all meaning controls are disabled during API or speech work, while final recognized speech delivery remains accepted outside an API operation. Ordinary practice/understanding draft eviction cannot evict correction entries: reserve their bounded capacity within the20-entry store, reject capacity overflow rather than discarding their UUIDs, and clear them only on resolution or explicit clear.

`public.source_corrections` is normalized by owner, source/revision, instruction/revision, request UUID and status/version, with a bounded validated payload and append-only review chronology. Authenticated SELECT for source evidence, instructions, private questions, understanding, correction payloads, changes, practice, scenarios and attempts requires active consent to every original dependent source. Standard practice requires its full instruction set; Change Drill and new-rule payloads require both original and later sources. Acyclic security-invoker policies preserve owner isolation without exposing service repository functions. Plain nontranscript identity/link metadata may remain owner-readable. Owner SELECT requires active consent including selected later source. Only the service CAS repository RPC writes. SQL constraints retain original evidence linkage, instruction identity, bounds, chronology and version guards; relational projection must explicitly whitelist and encode/decode the table. Immutable original instructions/evidence stay in their existing records.

## Change log

| 2026-09-30 | VALIDATE-001 practice recap | Scope recap rules and attempts to current practice identity/scenarios after stale restoration and fresh selection; clear local rehearsal state while preserving server history. |

| 2026-09-30 | VALIDATE-001 action constraints | Require all mandatory quantitative/calendar/counting/order constraints in ordinary expectedAction and reserve exceptions for genuinely conditional modifications; unconditional counting basis is part of the action. |

| 2026-09-30 | VALIDATE-001 extraction coverage | Clarify actionable declarative operating-policy coverage and distinct time-window/eligibility decisions, preserving exact source detail and existing evidence/uncertainty/review guards without a fixed extraction count. |

| 2026-09-30 | CORRECT quality repairs | Preserve unrelated correction drafts during history lifecycle actions and bind preview receipt storage to captured request identity; guard meaning controls during active work. |

| 2026-09-30 | CORRECT review repairs | Bind canonical replacement review generations, require active consent for authenticated derivative reads, protect pending correction UUID capacity, support safe same-canonical new-rule revision, and expose radio checked state. |

| 2026-09-30 | Defined explicit source correction previews/confirmation, four separate annotation types, canonical new-rule lineage, historical understanding reads, source-bound generation/CAS and durable owner-only provenance. | Codex `/root/corrections` |

| 2026-09-30 | BEE-001 reported timestamps | Preserve uninterpreted raw timing and exact transcript selection when final Bee utterances only establish reported wall timestamps; uniform fail-closed normalization, fingerprinted full revision, typed point evidence/exclusion IDs, matching database constraints and visible unavailable duration. |

| 2026-09-29 | DB-002 source permission | The learner can review and revoke permission for the currently imported source from About. Show the exact source title/revision and consequences before the existing revoke API is called. Clear that learner's device drafts, reset the visible source/review/practice, and refresh saved training after success. A failed device clear is visible and can be retried through Clear local answer drafts. |

| 2026-09-29 | DB-002 fixture drill parity | The prepared bookshop API uses the existing finite bookshop Change Drill template when confirmed under its fixture extractor. Bedrock-backed and grounded extraction use the general source-backed drill. Persisted drills must use the same evaluator family that generated them; tests must submit both an outdated answer and a corrected answer through the HTTP boundary. |

| 2026-09-29 | DB-002 device drafts | Store only the learner's unsubmitted answer, input mode, learner/source/practice/scenario IDs and exact revisions in a bounded local draft cache. Native storage uses the existing Expo filesystem runtime; web uses origin-local storage. Retain two checked generations to recover interrupted writes. Rehydrate a draft only after authenticated server recovery validates the current non-stale practice, learner, scenario and revisions. Never cache tokens, original transcripts or audio. Clear drafts after submission, offline reset, sign-out and source revocation; failed local persistence is visibly reported. |

| 2026-09-29 | DB-002 restore ordering | Internal `practice_sets.recorded_order` and `attempts.recorded_order` identity columns preserve commit order when clocks tie. Session restore chooses the most recent usable saved practice, restores the current failed-answer feedback or next uncovered situation, and shows completed practice as a recap. If all related practice is stale, show its history and update-review recovery while withholding the answer composer. |

| 2026-09-29 | DB-002 proposal review | Add immutable `change_proposals.replacement_snapshot` JSONB containing the exact bounded instruction reviewed when the proposal was created. Database confirmation changes only its controlled status/time. Runtime hydration uses this snapshot; subsequent edits or later changes to the instruction cannot silently replace what the learner reviewed. |

| 2026-09-29 | DB-002 session reads | `GET /api/source-conversations?sourceKind=bee&cursor=<saved-source-uuid>&limit=20` lists the authenticated learner's confirmed saved sources, newest import first with UUID tie-breaker (maximum 100/page). `GET /api/source-conversations/:sourceConversationId/session` returns `sourceConversation`, its immutable `source` preview, `excludedRanges`, optional current `extraction`, and `practices` (up to 100 bundles with `practice` and all chronological `attempts`), plus `changes` (up to 100) and their exact `sourceEvidence`. Attempts are not truncated or limited to 500; retry history must not make a saved practice unreadable or erase an earlier covered result. Session reads reject revoked or unavailable selected sources and omit practice whose dependent source consent was revoked. Existing practice statuses preserve stale history; resumed stale sets cannot be graded. No repeated extraction is required. |

| 2026-09-30 | CONNECT-001 picker review repair | Separate successful authenticated live listing from coarse public health in picker state/action; preserve fixture and suppressed unauthenticated readiness semantics and clear listing proof on load start/failure. |
| 2026-09-30 | CONNECT-001 review repair | Applied the strict origin and explicit development HTTP opt-in contract to every runtime Supabase storage configuration, including fixture storage; retain fixture actual-loopback restriction and direct injected helper seams. |
| 2026-09-30 | CONNECT-001 | Defined fixed-origin bounded sign-in/refresh/logout broker, trusted server UUID live owner gate, RAM sessions with generation/draft invalidation, strict explicit local HTTP validation and secret-filtered loopback launcher. |
| 2026-09-29 | DB-002 | Durable repository uses normalized existing public/private tables. Server-only security-invoker RPCs load one learner's records and commit validated relational deltas under a learner lock and optimistic version check. Change confirmation and revocation use existing controlled database operations; practice children are created while draft and made ready atomically. No service key or private material is exposed through the database client. Fixture memory mode remains explicit; live runtime requires server Supabase storage configuration. Authenticated session restoration returns current imported sources, extraction/review state, practice and historical attempts after checking consent and revisions. |

| Date | Change | Author/session |
| 2026-09-30 | Require a nonempty exact learner quote in every focused inference classification; clear a validated uncertain quote for the unchanged application contract. | Codex `/root/understanding` |
| 2026-09-30 | Focused inference uses only the application-owned active action and learner answer; discard a bounded brief comparison before binding exact full source provenance. Understanding device drafts persist retry UUIDs before submission and reconcile committed create/rehearse receipts after interruption. | Codex `/root/understanding` |
| 2026-09-30 | Resolve only the explicit canonical older/newer reservation branch in shared active comparison, preserve all other obligations/full policy, fail closed for remaining unmatched source exceptions, and align offline private-question grading guards. | Codex `/root/understanding` |
| 2026-09-30 | Make focused Nova comparison apply conditional source scope without requiring incompatible branches, preserving unaffected ordinary obligations and the exact full policy reference. | Codex `/root/understanding` |
| 2026-09-30 | Normalize only absent Nova extraction exception arrays; reject malformed values and retain source-exception review gates. | Codex `/root/understanding` |
| 2026-09-30 | Bind explicit reservation-window exceptions to exact trusted clauses, retain unrelated obligations in mixed utterances, and withhold ambiguous bindings for private source review. | Codex `/root/understanding` |
| 2026-09-30 | Defined persisted private understanding dialogue, exact source comparison, complete exception-context clarification, explicit interpretation confirmation and non-scored focused voice/text rehearsal with revision/consent guards. | Codex `/root/understanding` |
| --- | --- | --- |
| 2026-09-29 | Require the supported Expo SDK 57 scene lifecycle backport for physical iOS 27/Xcode 27 builds, using a build-only configuration plugin and reproducible prebuild output. | Codex `/root` |
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
