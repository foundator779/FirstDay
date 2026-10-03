# FirstDay

## New: FirstDay Go (runs in Expo Go)

`expo-go-app/` is a standalone, ADHD-first app with a hand-drawn minimalist UI.
It covers everything the Bee app does: capture, summaries, to-dos, reminders,
memories and chat. It also adds FirstDay's work training: confirm instructions
against the quote, role-play practice, Check what I understood, Change Drill,
Ask your trainer and Evening review. Run `cd expo-go-app && npm install && npx expo start`.
See [its README](expo-go-app/README.md).

## Run with your Bee recordings

`npm run demo:live -- --env-file=/absolute/private.env` starts the local Bee
bridge, durable authenticated API and learner sign-in screen. See the
[live setup guide](docs/live-demo.md) for private configuration, local database
setup, phone connectivity and the remaining validation gates.

## Run with Amazon Bedrock

With the backend credentials in the ignored root `.env`, run
`npm run demo:bedrock` and open `http://localhost:8083`. This mode sends the
included synthetic transcript passages and learner answers to Bedrock for
instruction extraction, practice generation, semantic grading and Change Drill using Amazon Nova Pro. It keeps
fixture provenance, consent, review and source-evidence checks intact.
See [the Bedrock demo guide](docs/bedrock-demo.md) for setup, validation and limits.

## Current learner experience

Four clear steps lead from a conversation to rehearsal. Review one instruction at
a time beside its source quote, retry with evidence-backed feedback, and review
what you covered. Change Drill compares an updated instruction with its earlier
version, marks old practice stale, and rehearses the new action. Tentative
language stays in private trainer questions.

**Check what I understood** compares your intended action with the exact source,
asks about exceptions before rehearsal, and keeps unresolved context outside
grading. **Evening review** lets you review, confirm, revise or undo a correction
to attribution, transcription or interpretation, or confirm an actual later
rule. Original quotes remain visible and unchanged. Connected training restores
server-saved progress; offline examples remain temporary.

The target is an Expo React Native iOS app, with a responsive web preview.
Physical iPhone fictional practice and user-reported speech checks passed.
Authenticated import, extraction and restoration of two actual Bee recordings
passed against the dedicated local database. The complete real training/update
journey and full VoiceOver check remain open. See
[design validation](docs/design-validation.md) for the planned user test.

The current layout adapts the supplied Figma kit: League Spartan typography,
blue navigation, lavender training cards, message-style practice and a card-based
recap. Training, Questions, About and Practice tabs retain unfinished review and
answer drafts. See [Figma and iOS validation](docs/figma-ios-validation.md).

Practice now supports **Hear the situation → Start speaking → Stop speaking →
review the transcript → Check my answer**. Typing stays available. Speech uses
the device/browser recognition service, which may process audio online; FirstDay
does not save raw audio. Leaving practice cancels recording. Unedited transcripts
are submitted as voice answers; editing switches the answer to text.

Native speech needs a custom iOS build containing `expo-speech-recognition`;
Expo Go falls back to typing. Appetize can check the interface but does not
support microphone input or iOS audio. Test actual speech on a physical iPhone
with the custom build, or in a supported browser at the local preview. Offline
grading still expects the confirmed action wording; Bedrock supports paraphrases.

For the native offline preview, run `npm run demo:ios` and open its Expo QR code
on an iPhone with a compatible Expo Go app on the same Wi-Fi network. This runs
the React Native app with fictional examples; it does not require a Bedrock key
on the phone. Physical speech was verified by the user in a custom Release
build; see the [current validation record](docs/live-demo.md#validation-and-limits).

## Run the synthetic demo now

From this repository, run `npm ci`, then `npm run demo:synthetic`. Open
`http://localhost:8081`. No Bee account, API server, Supabase project, or model
credentials are needed for this offline demo. The script explicitly selects
fixture mode.

Choose **Library welcome desk - synthetic training**, review its transcript,
enable the permission switch, and confirm the three instruction cards. Start
the scenarios, try an incorrect answer, and retry using the confirmed action.
After all three are covered, open the synthetic policy update, compare its
evidence, confirm the change, and complete the new drill. The earlier practice
becomes stale. Art-studio and bookshop examples are also available.

Synthetic mode is visibly labeled and session-only: resetting or reloading
clears its progress. Its bounded offline parser and conservative text evaluator
are development tools, not a claim that live Bee extraction is complete.
See [the synthetic demo guide](docs/synthetic-demo.md) for supported inputs,
example answers, verification, and the remaining live-integration work.

## Shared build files

For multi-Codex development, read [spec.md](spec.md) for the exact data and API contract, [TASKS.md](TASKS.md) for ownership and remaining work, and [AGENTS.md](AGENTS.md) for the team workflow. Each Codex session should claim a task before editing and update the ledger after verification.

## Design principle

FirstDay is a standalone product. Its characters, training interaction, API layer,
data model and brand identity are created for this app. Its current screen layout,
palette and navigation icons adapt the user-supplied Figma medical app UI kit;
the source attribution is in `apps/mobile/assets/figma/README.md`.

## Product brief

FirstDay turns a real training conversation into a playable practice session.

Someone wears Bee while a manager, teacher, teammate, or mentor explains how a task is done. FirstDay imports that consented Bee conversation, extracts the instructions that were actually said, asks the learner to confirm them, and turns the confirmed instructions into short branching scenarios. The learner practises with an original FirstDay role-play character acting as the customer, coworker, or problem they will face in real life.

The product promise is:

> Practise your second day before you have to live it.

This gives Bee a job beyond being a searchable memory. Bee supplies the learner's real source material; FirstDay turns that material into an active learning loop.

### Example

On a first shift at a bookshop, a manager says:

- reservations last five days;
- a customer needs the reservation name and phone number;
- damaged books go to the back-room cart before a refund is issued.

FirstDay shows those as three instruction cards with links back to the Bee transcript. The learner then hears:

> “A customer says their reserved book is missing. What do you do?”

The learner answers by voice or text. The app explains the result using the confirmed instruction and points to the source moment. If the manager later says “reservations now last seven days,” FirstDay marks the old rule as changed and generates a new practice situation.

### Why this matters

Training is often delivered once, under pressure, and then remembered imperfectly. In a small-business discussion, an owner described answering the same onboarding questions repeatedly after spending a full day explaining the process; the replies repeatedly recommended accessible procedures and practice ([discussion](https://www.reddit.com/r/smallbusiness/comments/1nvbyg9/spent_a_whole_day_training_someone_yesterday/)). Bee users describe the opposite problem: valuable captured conversations become a growing pile of facts whose practical benefit is hard to see ([Bee discussion](https://www.reddit.com/r/Bee_computer/comments/1vyk3j2/5_month_review/)).

FirstDay connects those two problems. It converts a memory into an action the learner can rehearse, while preserving the source so the app does not silently invent policy. The concept maps directly to the hackathon's Bee priorities of education and personal productivity ([hackathon brief](https://amazonappdev2026.devpost.com/)).

This is not a claim that the broad expert-training category is empty. Products such as [Retrace](https://www.retracelab.com/) already coach field technicians from recorded procedures. FirstDay is deliberately narrower: personal onboarding, character-driven rehearsal, source-backed answers, and visible rule changes.

## Core experience

### 1. Capture and choose

The learner chooses a consented Bee conversation, such as “Tuesday onboarding with Maya.” FirstDay shows its date, participants when available, and transcript coverage. A learner can exclude a section before processing it.

### 2. Extract instruction cards

The extraction service proposes a small set of cards. Each card contains:

- the instruction in plain language;
- the situation where it applies;
- the expected action;
- an optional exception;
- the exact source conversation and transcript span;
- a confidence and status: `needs review`, `confirmed`, or `changed`.

Nothing becomes a game rule until the learner confirms it. Ambiguous statements become a question to ask the trainer rather than a guessed answer.

### 3. Build the practice board

Confirmed cards become a short “shift” of three to five scenarios. FirstDay's own cast provides the roles: a customer, coworker, supervisor, or unexpected situation. The interface adapts the supplied message layout for source-backed practice. The success condition is evidence of understanding, not a generic chatbot conversation.

### 4. Practise in the moment

Each scenario has one decision point. The learner responds by speaking or typing. The evaluator compares the response to the confirmed rule set and returns:

- what the answer covered;
- what it missed;
- the source instruction that supports the explanation;
- a retry when the learner missed a critical step.

The evaluator must never mark an answer correct using a fact that has no confirmed source.

### 5. Keep the practice current

When a later Bee conversation changes a confirmed instruction, FirstDay creates a proposed change. After confirmation, old scenarios are marked stale and a “what changed?” drill is generated. This is the memorable product behavior: the game changes because the user's real world changed.

## Product ideas around the core

The following ideas are extensions of the same product, not separate launch promises:

1. **Change Drill** — a two-minute session for one updated rule. “What changed since last week?”
2. **Ask the Trainer** — unresolved or contradictory instructions become a concise question with transcript evidence, ready to share.
3. **Handoff Pack** — a manager can review the learner's confirmed cards and unresolved questions before the next shift. The learner owns the conversation by default; sharing is explicit.
4. **Confidence Map** — show which instructions are mastered, shaky, or never practised. This is a learning aid, not an employment score.
5. **Audio rehearsal mode** — a safe, audio-first practice session that lets a learner rehearse while preparing for a shift, with the same source-backed feedback as the main flow.

### Recommended hackathon scope

Build only the core experience plus Change Drill:

- one bookshop or café onboarding example;
- one real Bee conversation imported through the Bee CLI/MCP;
- three confirmed instruction cards;
- three branching scenarios;
- voice or text response, with text fallback for demo reliability;
- transcript-backed explanations;
- one changed instruction that produces a new scenario;
- one original role-play character and one alternate character, drawn specifically for FirstDay.

Cut from the first demo: multi-user accounts, manager dashboards, arbitrary occupations, background recording, automatic location triggers, employment analytics, and an open-ended chatbot. Those features dilute the story and make unsupported claims about Bee or learning quality.

## Demo narrative

The video should make the transformation visible within three minutes:

1. **0:00–0:20 — Problem.** “I was trained once. Tomorrow I have to do it alone.”
2. **0:20–0:45 — Live Bee data.** Pull one consented onboarding conversation through the local Bee bridge and show its source identity.
3. **0:45–1:10 — Grounding.** FirstDay extracts three cards. Confirm one, edit one, and flag one as a question. Each card opens its transcript span.
4. **1:10–1:55 — Play.** A FirstDay role-play character presents a customer situation. The learner answers. FirstDay explains the answer from the confirmed rule and lets the learner retry.
5. **1:55–2:25 — Reality changes.** Import a second Bee conversation containing the updated reservation window. Confirm the change. The old scenario becomes stale and a new “what changed?” scenario appears.
6. **2:25–2:55 — Outcome.** Show the learner's confidence map, unresolved question, and source-backed handoff pack.

The opening line should be “Bee heard the training. FirstDay lets me practise it.”

## Technical stack

### Client applications

- **Expo React Native + TypeScript** for the iOS learner app. Native components adapt the supplied Figma layout to FirstDay's training, character, evidence and response flows.
- **Next.js + TypeScript** for a lightweight desktop/demo companion. It is useful for transcript review, source-span inspection, and showing the extracted rule graph during the video.
- **React Native voice input with text fallback.** Voice is the showcase path; typed responses keep the demo deterministic if microphone permissions or transcription latency fail.

### Product services

- **Node.js + TypeScript Bee bridge.** A local process uses the authenticated Bee CLI/MCP to list conversations, fetch transcript spans, and optionally consume the Bee stream. It exposes a loopback-only `/v1` API to the FirstDay API process and never puts Bee credentials in the mobile bundle.
- **Supabase Auth, Postgres, and Storage.** Use an isolated FirstDay project with its own account identity, row-level security, source records, scenario state, migrations, and private transcript-derived artifacts.
- **Postgres JSONB plus relational IDs.** Keep the normalized entities relational (`source_conversation`, `instruction`, `scenario`, `attempt`) while storing model extraction payloads and evaluator evidence as versioned JSONB.
- **Zod shared contracts.** Validate every Bee bridge response, extraction result, scenario payload, and evaluator result at the boundary.
- **Structured-output LLM service.** Use an Amazon Bedrock model if entering the AWS Builder mini-challenge; otherwise use the project-approved model provider. The model extracts and evaluates against supplied source text, but deterministic application code owns confirmation, versioning, stale detection, scoring, and permissions.
- **Vitest or Jest plus fixture transcripts.** Test extraction and scenario evaluation against fixed, consent-safe transcripts without requiring a live Bee device for every test.

### Bee integration contract

The Apple Watch is the capture surface. FirstDay does not read raw audio directly from the watch and does not depend on an undocumented WatchConnectivity or HealthKit conversation API. Bee first syncs and processes the conversation through the Bee app/account. FirstDay then retrieves the processed conversation through a trusted local Bee bridge.

```text
Apple Watch running Bee
  → Bee syncs and transcribes the conversation
  → Bee account
  → local Bee CLI/MCP bridge
  → FirstDay import API
  → iOS conversation picker
  → confirmed instruction cards
  → auto-generated scenarios
```

#### Developer setup

The bridge runs on the developer computer during the hackathon demo. The Bee iOS app must have Developer Mode enabled by opening Bee settings and tapping the app Version row five times. Then install and authenticate the CLI:

```bash
npm install -g @beeai/cli
bee login
bee status
bee ping
```

The bridge can verify connectivity with `bee status` before showing the import screen. The user records a training conversation on the Apple Watch, waits for Bee to finish syncing and processing it, and then opens FirstDay's **Choose Bee Conversation** screen.

#### Conversation retrieval

For the initial implementation, the bridge uses the CLI's JSON output. The equivalent MCP tools can be used when the bridge is implemented as an MCP client:

```bash
# List candidate conversations for the picker
bee conversations list --json --limit 20

# Fetch the complete selected conversation and transcript
bee conversations get <conversation-id> --json

# Fetch only transcript utterances when polling an active conversation
bee conversations transcript <conversation-id> --json
```

The CLI provides the same capabilities through `bee_list_conversations`, `bee_get_conversation`, and `bee_get_conversation_transcript`. The bridge must preserve the Bee conversation ID, timestamps, speaker labels when available, and transcript text so every generated instruction can link back to its source.

#### Bridge and app APIs

The bridge exposes a small authenticated API on loopback for the FirstDay API
process only. The `/v1` bridge routes are:

```text
GET /v1/health
GET /v1/conversations?sourceKind=bee&query=onboarding&cursor=<opaque>&limit=20
GET /v1/conversations/:beeSourceId?sourceKind=bee
GET /v1/changes?sourceKind=bee&cursor=<opaque>&limit=20
```

The iOS app never calls those routes or receives the bridge bearer token. It
uses the separate learner-authenticated FirstDay routes, including:

```text
GET  /health
GET  /api/bee/conversations?sourceKind=bee&query=onboarding&cursor=<opaque>&limit=20
GET  /api/bee/conversations/:beeSourceId?sourceKind=bee
POST /api/imports
POST /api/source-conversations/:sourceConversationId/extract
```

The conversation picker receives summaries only. After the learner selects one,
the bridge calls `bee conversations get <id> --json` and normalizes the complete
result separately:

```ts
type SourceKind = "bee" | "fixture";
type BeeProcessingStatus = "processing" | "processed" | "failed";

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

type BeeSpeaker = { label: string; name?: string };

type BeeUtterance = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: BeeSpeaker;
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
```

List pages contain `BeeConversationSummary` values and never contain
`transcript` or `utterances`; only the get route returns a full `BeeSource`.
Every list/get request carries `sourceKind` so live and fixture IDs cannot be
confused. The API validates the bridge result, stores the selected source
metadata and transcript hash, and returns only the transcript or compact
instruction/scenario data required by the current learner flow.

#### Live updates

For the showcase, the bridge may listen for Bee events:

```bash
bee stream --json
```

When the stream emits a new or updated conversation event, the bridge should fetch the full conversation again, compare its transcript hash/revision, and enqueue extraction only when the content changed. Treat stream events as refresh hints, not durable data: reconnect, persist the last successful cursor if available, and run a periodic list/reconciliation pass so a dropped event cannot leave FirstDay stale. The full conversation fetched from Bee remains the source of truth.

#### Import behavior in the iOS app

1. Show a **Connect Bee** status card with authenticated, unavailable, or retrying states.
2. Show a **Choose Bee Conversation** list with title, date, duration, and processing state.
3. Require the learner to select the conversation and confirm that they have permission to use it.
4. Show an import progress state while the bridge retrieves and stores the source.
5. Display the transcript preview before extraction; allow the learner to exclude unrelated sections.
6. Run structured instruction extraction and show cards with transcript evidence.
7. Generate scenarios only from confirmed instructions.

If the bridge is unavailable, offer a clearly labeled fixture transcript for development and judging fallback. Never pretend a fixture is live Bee data.

The first adapter has four canonical operations:

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
```

Implement the adapter with a pull-and-resync model as the source of truth. The `getConversation` method should call the complete-conversation command, not rely on a partial list result. Deduplicate by Bee source ID plus transcript revision or transcript hash. Keep the bridge process local and authenticated; do not proxy stored Bee credentials through a public web endpoint.
Both list and recent-change operations use opaque cursors; `getRecentChanges`
does not accept an ISO `since` timestamp. The bridge owns query filtering,
ordering, deduplication, and cursor pagination, so the API and mobile app do not
re-filter a returned page.

## Proposed repository layout

```text
ProjectB/
├── apps/
│   ├── mobile/                 # Expo learner app; original FirstDay UI
│   └── web/                    # Next.js transcript and demo companion
├── packages/
│   ├── contracts/              # Zod schemas and shared TypeScript types
│   ├── scenario-engine/        # Rule matching, branching, stale detection
│   └── firstday-ui/            # Original characters and scenario primitives
├── services/
│   ├── api/                    # Authenticated app API and persistence
│   └── bee-bridge/             # Local Bee CLI/MCP adapter
├── supabase/
│   ├── migrations/              # Tables, indexes, and RLS policies
│   └── seed/                    # Safe demo organization and scenario seed
├── fixtures/
│   ├── transcripts/             # Redacted transcript fixtures
│   └── expected-scenarios/      # Golden extraction/evaluation outputs
└── README.md
```

## Data model

The smallest useful model is:

```text
source_conversation
  id, bee_source_id, title, started_at, transcript_hash, revision, consent_status

instruction
  id, source_conversation_id, text, situation, expected_action,
  source_start, source_end, confidence, status, supersedes_id

practice_set
  id, learner_id, title, instruction_revision, status

scenario
  id, practice_set_id, character_id, prompt, expected_rule_ids, branch_config

attempt
  id, scenario_id, response_text, matched_rule_ids, missed_rule_ids,
  evidence, result, created_at

open_question
  id, instruction_id, question, status, share_consent
```

Every instruction and evaluator result carries source IDs and an instruction revision. That makes it possible to explain a result and prevent a stale rule from silently grading a new session.

## Main data flow

```text
Bee device
  → Bee CLI/MCP
  → local bee-bridge
  → source_conversation
  → structured extraction
  → learner confirmation/edit
  → instruction revision
  → scenario-engine
  → mobile practice session
  → evaluator evidence
  → results, retry, or open question
```

### Extraction rules

The extraction prompt should require JSON only and include these hard rules:

- quote or point to the exact source span for every proposed instruction;
- separate explicit instructions from suggestions, opinions, and small talk;
- emit `needsReview` when the speaker, condition, or exception is unclear;
- emit contradiction records when two sources disagree;
- never resolve a conflict by guessing.

### Scenario rules

The scenario generator receives only confirmed instructions. It produces a finite state machine, not an unrestricted chat prompt:

```ts
type Scenario = {
  prompt: string;
  expectedRuleIds: string[];
  acceptableSignals: string[];
  criticalMisses: string[];
  retryPrompt: string;
  sourceEvidence: string[];
};
```

The evaluator returns matched rules, missed critical rules, and source evidence. A response can be “partially covered”; the app should explain the gap instead of pretending there is one perfect sentence.

## Implementation guideline

### Phase 1 — Foundation

1. Create the monorepo structure and shared Zod contracts.
2. Add the Bee bridge with a mock adapter and a live CLI/MCP adapter behind the same interface.
3. Add one redacted transcript fixture and an import screen.
4. Create the source conversation and instruction tables with RLS.

**Checkpoint:** a developer can select a Bee conversation or fixture and see its transcript with stable source IDs.

### Phase 2 — Grounded instruction cards

1. Implement extraction into a strict schema.
2. Render cards with “confirm,” “edit,” and “ask trainer” actions.
3. Store transcript offsets and instruction revisions.
4. Add a contradiction/stale-state display.

**Checkpoint:** every confirmed card visibly opens the exact transcript evidence that created it.

### Phase 3 — FirstDay practice loop

1. Create the original FirstDay character set: one warm guide, one demanding customer, and one supervisor. Keep character art simple and expressive so the user response remains the focus.
2. Build original scenario cards for situation, response, feedback, and retry.
3. Generate three deterministic scenarios from confirmed cards.
4. Add voice response plus text fallback.
5. Implement rule-based evaluation first; add model assistance only inside the bounded evaluator contract.

**Checkpoint:** the same answer produces the same result in fixture tests, and the learner can retry a critical miss.

### Phase 4 — Change Drill

1. Import a second Bee source with one changed instruction.
2. Detect the changed instruction by semantic comparison plus learner confirmation.
3. Mark scenarios based on the old revision as stale.
4. Generate one “what changed?” scenario and show both source spans.

**Checkpoint:** the demo can visibly move from old rule → confirmed change → new practice scenario.

### Phase 5 — Demo hardening

1. Add a local fixture mode so the demo still works if Bee authentication or network access fails.
2. Add source and privacy labels throughout the UI.
3. Add loading, empty, permission, and stale-source states.
4. Test on the named iOS simulator and one real Bee-connected environment.
5. Record the three-minute demo only after the live data path and fixture fallback both pass.

## Quality and safety boundaries

- Obtain explicit consent before importing a conversation and show the selected source before processing it.
- Keep raw transcript access separate from the compact instruction cards. Do not expose unrelated conversation content in a scenario.
- Treat Bee transcripts as fallible. Source-backed does not mean perfectly transcribed; every card can be edited or rejected.
- Avoid medical, legal, financial, hazardous-equipment, and employment-evaluation claims in the demo.
- Do not call a learner “qualified.” Say that they practised, covered, or missed the confirmed instruction.
- Make sharing a deliberate action. The default is learner-private.
- If Bee is unavailable, show a clearly labeled fixture transcript rather than fabricating a live result.

## Success criteria

The hackathon build is ready when:

- a live Bee source is used in the recorded demo;
- one source conversation yields at least three reviewable instruction cards;
- every confirmed card has source evidence;
- a learner completes three practice scenarios with a retry path;
- one changed source instruction invalidates an old scenario and creates a new one;
- the mobile UI has a recognizable FirstDay identity while the product outcome is learning/productivity;
- the public repository contains setup instructions, an open-source license, fixture data, and a clear Bee authentication path;
- the submission explains what was newly built for the hackathon and includes product feedback for every Bee/AWS tool used.

## Product risks and decisions

| Risk | Decision |
| --- | --- |
| Bee transcript is incomplete or misattributed | Require confirmation, expose evidence, and support rejection. |
| LLM invents policy | Generate only from confirmed instructions and validate output with schemas. |
| Live Bee access is fragile during judging | Keep a fixture mode, while the video still shows a real Bee source. |
| A generic role-play UI feels like a chatbot wrapper | Use a clear source → rule → situation → response → evidence loop and make the character react to the learner's decision. |
| Scope grows into a full LMS | Ship one occupation, one source revision, three scenarios, and one change drill. |

## Build order for the team

The highest-value path is `Bee bridge → source-backed cards → deterministic scenarios → practice feedback → change drill → polish`. Do not start with a generalized agent, a manager portal, or a large content library. The showcase depends on the audience seeing one real conversation become one useful rehearsal in a few seconds.
