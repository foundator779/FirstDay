# FirstDay Improvements Implementation Plan

**Goal:** Implement and validate all app improvements approved from Improvement.txt, preserving evidence, consent, revision and learner isolation guarantees.

**Architecture:** Extend the existing contracts, repository, bounded providers and native learner screens. Keep original sources immutable, separate learner explanations/corrections from transcript evidence, and validate dependent state at each transaction. Use the existing Supabase schema for durable server state; authenticated server reads restore progress rather than trusting a cached client result.

**Tech stack:** Existing Expo/React Native, TypeScript, Zod, Fastify, Supabase Postgres, Bedrock/Nova Pro and Vitest. No worktrees, commits or additional production dependencies without authorization.

**Scope update (2026-09-29):** The user deferred participant research and hosted Supabase provisioning. Local persistence validation remains in scope. The user authorized using iPhone Mirroring and installing FirstDay on available physical devices. Real recordings must be selected with recording consent confirmed; physical speech validation requires direct phone use because Mirroring does not expose its microphone.

## 1. Supported instruction selection and update review — FLOW-001

- Add failing mobile behavior tests for zero, fewer than three and more than three confirmed instructions. Show actionable recovery and select exactly three supported cards; recap only rehearsed rules.
- Add tests for selecting a second processed source of the same kind, reviewing its transcript, exclusions and explicit consent, and recovering from empty or multiple change proposals.
- Implement in `apps/mobile/src/practice-panel.tsx`, reusable update-selection components and workflow helpers, using existing client methods.
- Run focused mobile tests/typecheck, then inspect rendered phone/desktop UI.

## 2. Durable server state and session restoration — DB-002

- Verify current Supabase RPC/transaction and auth documentation. Extend `spec.md` before changing schema/API.
- Implement a server-only adapter over the normalized checked-in schema with atomic import/extraction/review/practice/attempt/change/revocation operations. Preserve the existing repository validation and verify restart, concurrent writes and consent races.
- Add authenticated source/session reads for extraction, attempts and active practice; restore server-validated review and practice after reload. Retain only necessary client draft/checkpoint data and clear it on sign-out/reset/revocation.
- Verify against a dedicated local Supabase database plus repository and route tests. Never expose service-role/Bee/bridge credentials to mobile.

## 3. Understanding checks — UNDERSTAND-001

- Define explanation, source comparison, possible mismatch, missing-context and clarification contracts before implementation.
- Ask what the learner would do, show their answer beside exact evidence, and identify a specific conditional distinction. Explicitly request unknown context; unresolved/disputed policy cannot enter grading.
- Allow source correction and saving a private trainer question. Generate focused rehearsal only from confirmed resolved instructions, preserving original source evidence and revision.
- Test the old/new reservation exception example, false/unsupported model outputs, text/voice parity, revisions, other learners, revocation and interrupted clarification.

## 4. Evening corrections — CORRECT-001

- Define separate, versioned correction provenance and confirmation/undo/dispute/invalidation contracts, including original quote/span, confirming learner and before/after meaning.
- Offer optional review of up to three uncertainties. Support attribution, transcription, interpretation and actual new-rule changes with distinct handling.
- Preview the dependent consequences; require confirmation, withhold affected practice during dispute, regenerate after resolution, preserve historical attempts and support reopening/undo.
- Test contradictory/ambiguous target corrections, misunderstood speech, repeated requests, interruption, other conversations and revocation/deletion. Verify Pioneer note import separately if supported; never promise direct Pioneer dialogue routing.

## 5. Live connection and native reliability — CONNECT-001, IOS-001, APP-004, BEE-001, TEST-001

- Provide an actual learner sign-in/session flow and reproducible bridge/API/mobile launcher with a safe phone connection. Keep fixture fallback visibly labeled.
- Use a selected consented real recording; complete capture/import/review/explain/rehearse and a second actual conversation change twice.
- Verify keyboard, large text, VoiceOver, microphone permissions/cancellation, transcript review and text fallback. Automated/simulator checks supplement required physical-device evidence.

## 6. Usefulness and demonstration — VALIDATE-001, DEMO-001

- Prepare matched notes/transcript baseline and FirstDay study procedures, record observations/denominators without invented participant results. Preserve ADHD positioning as a hypothesis until actual research supports it.
- Validate the full visible flow at phone/desktop sizes, reload/restart and source revocation, network/model failures, corrections and changed-rule recovery.
- Update user-facing setup, asset provenance, product feedback/friction evidence, and the under-three-minute demo around the implemented misunderstanding example.
- Verify repository/video/submission access only with available account authorization. Public posting, contacting participants and submission require their own authorization.

## Completion audit

For every improvement, record implementation and direct verification in TASKS.md. Keep physical capture, device checks and observed participant outcomes incomplete until actual evidence exists. Green fixture tests do not satisfy those gates. Review the final diff, run focused checks followed by relevant full tests/typecheck/lint/build/exports, and mark the goal complete only when all requirements are proven.
