# FirstDay MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the complete FirstDay fixture-backed hackathon MVP, live Bee/Supabase integration boundaries, automated verification, setup documentation, and product screenshots.

**Architecture:** An npm-workspace TypeScript monorepo separates canonical Zod contracts, deterministic scenario logic, a local Bee adapter/bridge, an injectable REST API, and an Expo Router learner application. The fixture and in-memory paths are first-class deterministic implementations; live Bee and Supabase paths use the same contracts and are activated by environment configuration.

**Tech Stack:** TypeScript, npm workspaces, Zod, Vitest, Fastify, Expo React Native, Expo Router, React Native Web, Supabase Postgres migrations, Bee CLI, Playwright.

---

### Task 1: Bootstrap the TypeScript workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/mobile/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/scenario-engine/package.json`
- Create: `packages/firstday-ui/package.json`
- Create: `services/api/package.json`
- Create: `services/bee-bridge/package.json`

**Step 1:** Add workspace manifests and root scripts for `test`, `typecheck`, `lint`, `build`, and `dev`.

**Step 2:** Run `npm install`.

Expected: dependencies install and one lockfile is created.

**Step 3:** Run `npm run typecheck`.

Expected: workspace packages resolve; empty-package configuration is valid.

**Step 4:** Update `BOOT-001` verification in `TASKS.md` and commit the bootstrap.

### Task 2: Implement canonical contracts test-first

**Files:**
- Create: `packages/contracts/src/index.test.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tsconfig.json`
- Modify: `spec.md`

**Step 1:** Write failing Vitest cases for Bee summaries/sources, imports, instruction decisions, practice sets, attempts, changes, source evidence, excluded ranges, and the error envelope.

**Step 2:** Run `npm test --workspace @firstday/contracts`.

Expected: FAIL because schemas are not exported.

**Step 3:** Implement Zod schemas and inferred types using the canonical camelCase statuses in `spec.md`. Resolve missing contract details in the spec change log before code where necessary.

**Step 4:** Re-run the contract tests and typecheck.

Expected: PASS.

**Step 5:** Mark `CONTRACT-001` done and commit.

### Task 3: Build the deterministic scenario engine test-first

**Files:**
- Create: `packages/scenario-engine/src/index.test.ts`
- Create: `packages/scenario-engine/src/index.ts`
- Create: `packages/scenario-engine/tsconfig.json`
- Create: `fixtures/transcripts/bookshop-onboarding.json`
- Create: `fixtures/transcripts/bookshop-policy-update.json`
- Create: `fixtures/expected-scenarios/bookshop.json`

**Step 1:** Write failing tests proving extraction emits evidence-backed review cards, generation rejects unconfirmed rules and produces exactly three scenarios, evaluation returns covered/partial/missed outcomes, and comparison identifies the reservation-window change.

**Step 2:** Run `npm test --workspace @firstday/scenario-engine`.

Expected: FAIL because engine functions do not exist.

**Step 3:** Implement deterministic fixture extraction, finite scenario generation, bounded signal evaluation, and revision comparison.

**Step 4:** Re-run tests and typecheck.

Expected: PASS with stable golden outputs.

**Step 5:** Mark `ENGINE-001` done and commit.

### Task 4: Implement the Bee adapter and local bridge test-first

**Files:**
- Create: `services/bee-bridge/src/adapter.test.ts`
- Create: `services/bee-bridge/src/adapter.ts`
- Create: `services/bee-bridge/src/server.test.ts`
- Create: `services/bee-bridge/src/server.ts`
- Create: `services/bee-bridge/src/index.ts`
- Create: `services/bee-bridge/tsconfig.json`

**Step 1:** Write failing tests for fixture health/list/get/recent changes, CLI JSON normalization, source revision/hash preservation, HTTP routes, and credential-safe responses.

**Step 2:** Run `npm test --workspace @firstday/bee-bridge`.

Expected: FAIL because adapters and server are missing.

**Step 3:** Implement fixture and CLI adapters behind `BeeAdapter`, inject command execution for tests, and expose `/health`, `/api/bee/conversations`, and detail routes.

**Step 4:** Run tests, typecheck, and scan the mobile tree for Bee credentials.

Expected: PASS; no credential material appears outside the bridge.

**Step 5:** Mark `BEE-001` and `BEE-002` done and commit.

### Task 5: Define Supabase persistence and policies

**Files:**
- Create: `supabase/migrations/202609100001_firstday_schema.sql`
- Create: `supabase/seed/demo.sql`
- Create: `services/api/src/repository.ts`
- Create: `services/api/src/repository.test.ts`

**Step 1:** Write failing repository behavior tests for learner isolation, consent, source revisions, instruction decisions, attempts, open questions, and stale practice sets.

**Step 2:** Run `npm test --workspace @firstday/api -- repository`.

Expected: FAIL because repository interfaces are missing.

**Step 3:** Implement the typed in-memory repository and SQL migration with tables, indexes, private transcript separation, and RLS policies matching the behavior.

**Step 4:** Run repository tests and SQL static checks.

Expected: PASS.

**Step 5:** Mark `DB-001` done and commit.

### Task 6: Implement the FirstDay API test-first

**Files:**
- Create: `services/api/src/server.test.ts`
- Create: `services/api/src/server.ts`
- Create: `services/api/src/index.ts`
- Create: `services/api/tsconfig.json`

**Step 1:** Write failing injected-request tests for health, Bee conversations, consent-gated import, extraction, instruction decisions/open questions, practice generation/read, attempts, compare/change confirmation, stale protection, and canonical errors.

**Step 2:** Run `npm test --workspace @firstday/api`.

Expected: FAIL because routes are missing.

**Step 3:** Implement Fastify routes with Zod boundary validation and dependency-injected adapter/repository/engine.

**Step 4:** Re-run API tests and typecheck.

Expected: PASS for success paths, state transitions, and required errors.

**Step 5:** Mark `API-001` through `API-004` and `AI-001` done and commit.

### Task 7: Build the FirstDay visual system and mobile experience

**Files:**
- Create: `packages/firstday-ui/src/index.ts`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/src/api.ts`
- Create: `apps/mobile/src/fixture-client.ts`
- Create: `apps/mobile/src/state.ts`
- Create: `apps/mobile/src/state.test.ts`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/assets/*`

**Step 1:** Write failing state/client tests for connection, consent, card review, scenario progress, retry, source evidence, and changed-rule flow.

**Step 2:** Run `npm test --workspace @firstday/mobile`.

Expected: FAIL because the state model and clients are missing.

**Step 3:** Implement shared visual tokens, character metadata, fixture/live clients, and a responsive single-route Expo experience that exposes every MVP state without dead controls.

**Step 4:** Add browser-accessible speech recognition when available and a text fallback that reaches the same client attempt method.

**Step 5:** Run mobile tests, typecheck, and Expo web export.

Expected: PASS and a renderable web build.

**Step 6:** Mark `APP-001` through `APP-004` done and commit.

### Task 8: Add end-to-end fixture verification

**Files:**
- Create: `tests/fixture-flow.test.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/firstday.spec.ts`

**Step 1:** Write a failing integration test that performs import, extraction, confirmation, three scenarios, retry, completion, policy comparison, and Change Drill creation through real API injection.

**Step 2:** Run `npm test -- tests/fixture-flow.test.ts`.

Expected: FAIL until all composed services expose the required behavior.

**Step 3:** Add only the integration wiring required to make the complete flow pass.

**Step 4:** Write and run Playwright browser tests against the Expo web build for the same visible journey and responsive layout.

Expected: PASS with no console or page errors.

**Step 5:** Mark `CHANGE-001` and `TEST-001` done and commit.

### Task 9: Complete setup and blocker documentation

**Files:**
- Modify: `README.md`
- Create: `SETUP_BLOCKERS.md`
- Create: `LICENSE`

**Step 1:** Document prerequisites, installation, fixture start, live Bee setup, Supabase setup, environment variables, test/build commands, simulator/device notes, and the three-minute demo route.

**Step 2:** Record credential/device-dependent checks that cannot run locally, the exact unblock steps, and the evidence required to close them.

**Step 3:** Run every documented non-credential command from a clean install state.

Expected: commands succeed as written.

**Step 4:** Commit documentation separately from implementation.

### Task 10: Visual QA, screenshots, and final verification

**Files:**
- Create: `docs/screenshots/firstday-desktop.png`
- Create: `docs/screenshots/firstday-mobile.png`
- Modify: `TASKS.md`

**Step 1:** Run the Expo web app and API/fixture services.

**Step 2:** Exercise every interactive control in Playwright at desktop and mobile widths, fixing failures with a failing regression test first.

**Step 3:** Capture polished desktop and mobile screenshots after reaching the practice/change states.

**Step 4:** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`, and a secret/debug-code scan.

Expected: all locally executable gates pass with clean output.

**Step 5:** Update every completed task and verification result in `TASKS.md`; leave only genuinely credential-dependent items documented as such.

**Step 6:** Request a final code review, inspect the complete diff, commit remaining changes, push `codex/firstday-mvp`, and verify the remote commit.
