# Design and idea validation

## Implemented

The latest Figma-based iOS layout and its verification are recorded in
[Figma and iOS validation](figma-ios-validation.md). The earlier 402-test run
below predates that adaptation; the latest run has 404 passing tests.

FirstDay helps a new worker rehearse a training conversation and adapt when an
instruction changes. The key demonstration is a changed instruction invalidating
old practice and creating a short, source-backed rehearsal of the new action.

The learner flow has four steps: Training, Transcript, Instructions, Practice.
It uses one instruction/situation at a time, source quotes beside decisions,
large controls, keyboard avoidance, accessible labels and live loading/feedback.
The recap records covered instructions and retries. Questions stay private.
Synthetic examples are labeled throughout; source details are available on demand.

## What the next user test must establish

Test with three people unfamiliar with FirstDay. These are planned checks,
not completed research or claims of improved learning.

1. Ask what the app does after 10 seconds. Can they describe rehearsal of training?
2. Ask them to exclude a passage and explain what gets sent for AI processing.
3. Ask them to confirm one rule and explain why the tentative rule is a question.
4. Let them answer one situation incorrectly, recover, and interpret their recap.
5. Show the update. Can they identify the new action and why the old practice is stale?

Record completion, time, assistance required and misunderstandings. Aim for all
three participants to complete the five tasks without coaching. Revise any step
where two people hesitate or misunderstand. Do not convert these observations
into a judging score or claim of workplace readiness.

Repeat on a real iPhone with a consented Bee recording before submission. Check
keyboard behavior, large text, VoiceOver focus, safe areas and network failures.
The current responsive browser review is not a substitute for those device checks.

## Recorded verification (September 15, 2026)

- 402 automated tests pass; workspace typecheck, build and lint pass.
- Web and iOS JavaScript/Hermes exports pass. No native install was performed.
- Phone-size (390 by 844) picker, practice and comparison layouts were visually
  inspected; desktop comparison was also inspected.
- Live library API smoke covers extraction through changed-rule grading.
- Live studio browser walkthrough covers consent, three confirmations, wrong
  answer, paraphrased retry, remaining situations, accurate recap, comparison,
  old-practice staleness, updated action and final recap.
- Credential scan found neither backend credential in repository/exported files.
