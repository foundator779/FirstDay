# Observed development friction

Recorded September 30, 2026. These observations come from FirstDay development
and acceptance checks. They are not participant research or a product efficacy
study. No feedback has been submitted to a vendor. Private transcripts,
credentials and raw provider logs are excluded from this document.

## Bee reported timing

- **Task and steps:** Authenticate the Bee CLI, list processed conversations,
  fetch one with `bee conversations get <id> --json`, then import through the
  FirstDay local bridge.
- **Expected:** Preserve every original passage and its reported time without
  inventing an audio interval.
- **Observed:** The initial FirstDay adapter rejected the actual data because
  it assumed epoch interval endpoints. The observed payload had small
  `start`/`end` values, wall-time `spoken_at`, a zero duration, tied points and
  a point outside the reported conversation interval.
- **Impact:** High: real-source import was blocked. This was an incompatible
  FirstDay assumption; the observation does not prove a Bee SDK defect.
- **Resolution:** Preserve raw timing metadata and exact ordered text. Represent
  reported points explicitly, including ties; never guess a duration or clamp
  a point to the conversation interval. Two actual sources subsequently
  imported, extracted and restored from the local database.
- **Suggestion:** Bee developer examples would help if they specified the units,
  origin and guarantees of all three timing fields, including completed versus
  realtime transcripts, ties and zero-duration cases.

## Extraction retained a constraint outside the action

- **Task and steps:** Run real Nova extraction on the fictional Bookshop
  transcript, review its three procedures and generate practice.
- **Expected:** The action preserves five calendar days and the set-aside day
  counting as day one.
- **Observed:** An earlier result included the counting basis in its rule text
  but omitted duration from the action used for rehearsal. An unconditional
  counting basis was also classified as an exception.
- **Impact:** High: source-backed grading could rehearse an incomplete action.
  This is a FirstDay provider-integration failure, not evidence about model
  accuracy across other tasks.
- **Resolution:** Require numeric windows, calendar/business-day distinctions,
  counting origin, order and applicability in the action; reserve exceptions
  for actual conditional variations. Transport regressions reproduced the
  gap before the prompt repair. Two final Bookshop journeys and three unfamiliar
  fictional journeys passed extraction, scenario generation, negative answers
  and supported actions. Earlier failing receipts were retained.
- **Suggestion:** Keep constraint preservation checks alongside structured
  output validation; valid JSON alone cannot establish faithful procedure text.

## An equivalent counting phrase failed the smoke harness

- **Task and steps:** Extract the unfamiliar fictional Costume policy and check
  its inclusive four-day window.
- **Expected:** Accept an action that includes the request day in the count.
- **Observed:** The provider wrote “including the day the hold is requested.”
  A temporary smoke assertion expected literal day-one wording and failed.
- **Impact:** Medium: a validation false failure obscured a faithful result.
  The owner was the FirstDay test harness.
- **Resolution:** Accept equivalent inclusive-origin wording while retaining
  the numeric window and calendar-day assertions. Preserve the initial failed
  receipt and distinguish that rerun from a first-attempt success.
- **Suggestion:** Review semantic assertions against their source requirement;
  do not strengthen product claims by silently excluding failed runs. The five
  final fictional journeys are a small regression sample, not an accuracy rate.

## Native launch and accessibility text

- **Task and steps:** Build a custom Release, install on the paired iPhone and
  launch; separately set Simulator Larger Accessibility Sizes to its maximum
  and inspect the training/review screens.
- **Expected:** Launch successfully; fixed navigation and controls remain
  readable, with source content scalable and scrollable.
- **Observed:** The initial physical build had a scene-lifecycle launch failure.
  Earlier Simulator screenshots also showed oversized fixed headings and
  clipped navigation, source selectors and progress labels.
- **Impact:** High for launch; medium for fixed control usability.
- **Resolution:** Use the supported Expo SDK patch and `enableSceneSupport`
  plugin configuration. Bound font scaling only for fixed chrome, preserve
  full accessibility labels and touch targets, and allow policy/input content
  to grow. Rebuilt native screenshots verified normal and maximum text sizes;
  the signed-in Simulator header and sign-out control also fit. Restore the
  original text setting after checks.
- **Suggestion:** Keep Release launch and largest-text checks in the native
  acceptance route. These results do not establish a full VoiceOver pass.

## Default-timeout authentication checks under concurrent work

- **Task and steps:** Run `npm test` with the documented isolated local SQL,
  GoTrue and PostgREST integration settings while native capture/input is active.
- **Expected:** The authentication journey finishes within its existing
  five-second test timeout.
- **Observed:** Two full runs at different stages exceeded that timeout in the
  actual authentication integration test. The isolated check and settled full
  reruns passed; the final full run passed 691 tests in 61 files in 12.30 seconds.
- **Impact:** Medium: inconsistent development verification. Concurrent load
  is a plausible contributor; its exact cause has not been established.
- **Workaround:** Finish heavy capture/export/build work before the settled
  authentication suite. Retain failures; do not increase timeouts to claim a pass.
- **Suggestion:** If this recurs in CI, record bounded step durations for the
  broker/database journey and diagnose the slow step before changing thresholds.

The commit-time recheck produced additional five-second timeouts: one parallel
run failed the authentication journey, and another failed authentication plus
the understanding repository integration. Authentication passed independently.
The complete suite then passed all 691 tests in 61 files with
`npm test -- --maxWorkers=1` in 35.76 seconds, retaining the same per-test
timeouts. This verifies the full suite under reduced concurrency; it does not
prove that the default parallel-run instability is resolved.

## Simulator automation and video capture

- **Task and steps:** Use RocketSim accessibility snapshots to select controls
  and type, then record a native walkthrough.
- **Expected:** Reported targets are visible and actionable; the finalized video
  fits the command transport.
- **Observed:** Some off-canvas controls remained in compact snapshots. Focusing
  a covered input could leave the previous input active. A 150-second recording
  at 30 fps exceeded the tool's IPC size limit and produced no usable output.
- **Impact:** Medium for automation accuracy and demo capture. These are tooling
  or agent-workflow issues; they are not Bee defects.
- **Workaround:** Check current frames/screenshots, scroll targets into view and
  verify focus before typing. A shorter 10 fps retry produced a decoded,
  69.205-second fictional correction clip; it covers only part of the workflow.
- **Suggestion:** Enforce visible target/focus checks in the RocketSim workflow
  and expose the capture size limit before recording. A direct output-file
  recording option could avoid large finalized media passing through IPC.

## Remaining acceptance constraints

The two available real recordings contain one and zero reviewable instructions.
They verified conservative import/extraction and durable restoration, but cannot
prove a three-procedure training followed by an actual later rule update.
Physical launch is currently denied by the locked phone, and the Mac is locked
for Mirroring. The remaining source pair, physical keyboard/cancellation/editing,
VoiceOver and private HTTPS requirements are in the
[live setup guide](live-demo.md#remaining-device-and-recording-input).

Figma source attribution is recorded in the asset README. The installed League
Spartan package contains `LICENSE_FONT` with an OFL 1.1 notice. Figma kit
redistribution permission has not been verified; attribution is not a substitute
for that evidence. Public video/repository/submission access also remains
unverified. Participant research and hosted provisioning remain deferred.

The local private validation directory retains the original failures and final
receipts. `TASKS.md` records implementation and acceptance separately.
