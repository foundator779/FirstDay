# FirstDay MVP Design

## Goal

Build the narrow hackathon experience already defined by `README.md` and `spec.md`: turn a consented Bee onboarding conversation into evidence-backed instruction cards, three deterministic practice scenarios, grounded evaluation with retry, and a Change Drill when a later source updates a rule.

## Product shape

The primary product is an Expo React Native learner app with a distinctive FirstDay visual identity. A local Node.js Bee bridge owns Bee authentication and exposes normalized conversation data. A Node.js API owns consent, extraction, instruction decisions, scenario generation, attempts, revisions, and stale-state transitions. Supabase-compatible migrations define the durable model, while an in-memory repository and redacted fixtures make local development and judging deterministic without external credentials.

The first working experience is intentionally limited to one learner and one bookshop onboarding story. It includes one original guide/customer character system, one live-capable Bee adapter, one fixture adapter, three instruction cards, three scenarios, voice-or-text response, evidence-backed feedback, one changed instruction, and one Change Drill.

## Architecture

```text
Bee CLI or redacted fixture
  -> local bee-bridge
  -> FirstDay REST API
  -> consented source + transcript evidence
  -> learner-reviewed instruction revision
  -> deterministic scenario engine
  -> Expo mobile practice board
  -> bounded attempt evaluation
  -> retry, completion, or stale/change flow
```

The monorepo uses npm workspaces:

- `apps/mobile`: Expo Router application and fixture/live API client.
- `packages/contracts`: canonical Zod schemas and inferred TypeScript types.
- `packages/scenario-engine`: deterministic extraction fixtures, scenario creation, evaluation, and change comparison.
- `packages/firstday-ui`: shared design tokens and character metadata.
- `services/bee-bridge`: CLI-backed and fixture-backed Bee adapters plus a narrow HTTP service.
- `services/api`: REST API with an injectable repository and Supabase-ready persistence boundary.
- `supabase/migrations`: tables, indexes, and row-level security policies.
- `fixtures`: redacted source conversations and golden expectations.
- `tests`: end-to-end contract flow.

## Data and trust boundaries

`spec.md` is authoritative when prose examples disagree. JSON uses camelCase; database columns use snake_case. Every source-derived object carries a source revision and evidence identifier. Only server-side transitions can confirm instructions, complete practice sets, or classify attempts.

Bee credentials remain exclusively in the local bridge process. The mobile app receives normalized conversation summaries and compact source-backed learning records. Consent is required before import, fixture mode is visibly labeled, and unsupported or contradictory transcript content becomes review or an open question rather than a generated rule.

For local completeness, the API defaults to deterministic fixture data and an in-memory repository. Supabase environment variables enable the documented durable deployment path without making credentials a prerequisite for the demo.

## User flow

1. The learner sees Bee connection state and chooses a processed conversation.
2. The learner confirms permission, previews the transcript, and can exclude ranges.
3. Extraction returns reviewable cards with confidence and exact evidence spans.
4. The learner confirms, edits, rejects, or turns a card into an open question.
5. Three confirmed cards generate a three-scenario practice set.
6. The learner answers by text or device speech-to-text; both submit `responseText` to the same endpoint.
7. Evaluation reports covered and missed rules, cites evidence, and offers retry for critical misses.
8. A second source proposes a changed rule. Confirmation stales the old set and creates a Change Drill containing old and new evidence.

## Failure handling

- Bee unavailable or unauthenticated: show connection status and offer the explicitly labeled fixture.
- Source not ready: preserve picker state and allow retry.
- Missing consent: reject import with the canonical error envelope.
- No confirmed instructions: block scenario creation.
- Stale practice set: prevent grading and direct the learner to the Change Drill.
- Ambiguous extraction or evaluation: return `needsReview` with evidence.
- Network failure: keep the current screen usable and expose a retry action.

## Visual direction

FirstDay should feel like a calm first-shift field notebook rather than a corporate dashboard: warm paper surfaces, deep ink typography, coral action accents, mint confirmation states, tactile cards, an illustrated character portrait, clear transcript evidence chips, and a compact progress rail. The interface prioritizes the learner decision and its evidence over chat chrome.

## Testing

Contract schemas, extraction, scenario generation, evaluation, revision handling, API routes, and the complete fixture journey receive automated tests. The final verification includes install, formatting, lint/typecheck, unit and integration tests, production builds where supported, a rendered mobile-web smoke test, and screenshot capture at desktop and mobile widths.

## Completion boundary

The build is complete when the documented acceptance criteria work through the fixture path, the live Bee adapter and Supabase setup are present and documented, the UI demonstrates the full source-to-Change-Drill story, screenshots are captured, and any credential-dependent verification is recorded in `SETUP_BLOCKERS.md` without being misrepresented as passed.
