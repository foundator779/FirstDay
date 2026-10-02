# Live Bee setup and current validation

## Start the connected app

Use the repository's Node/npm versions and install with `npm ci`. Authenticate
the installed Bee CLI on the Mac and check `bee status`. Apply the checked-in
Supabase migrations to a dedicated FirstDay database. Hosted provisioning is
deferred; the implementation was tested with an isolated local stack.

Copy `.env.example` to a private, ignored environment file outside public
artifacts and restrict it with `chmod 600 /absolute/private.env`. Set:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `development` for owned local validation |
| `FIRSTDAY_DATA_MODE` | `live` |
| `FIRSTDAY_STORAGE_MODE` | `supabase` |
| `FIRSTDAY_AI_PROVIDER` | `bedrock` |
| `FIRSTDAY_BEE_OWNER_ID` | The existing Supabase Auth learner's UUID |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | The dedicated server's configuration |
| `FIRSTDAY_BEE_BRIDGE_TOKEN` | A private random token of at least 32 characters |
| `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_MODEL_ID` | Backend Bedrock configuration |
| `FIRSTDAY_MOBILE_API_URL` | Trusted private HTTPS origin for the FirstDay API |
| `FIRSTDAY_EXPO_PORT` | An unused local port; default `8087` |

The owner UUID binds this single-learner demo to the Mac's Bee account. Sign in
with that learner's existing email/password. Other authenticated learners cannot
read or mutate its Bee data. Access and refresh tokens remain in app RAM;
sign-out clears learner state and queued device drafts. Reopening the app
requires sign-in, then **Resume saved training** reads server-validated progress.

For desktop or Simulator development only, use
`FIRSTDAY_MOBILE_API_URL=http://127.0.0.1:3000` and
`FIRSTDAY_ALLOW_LOOPBACK_API_HTTP=1`. Genuine local Supabase HTTP also requires
`FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP=1` and development mode. A phone's localhost
refers to the phone, so the physical live build needs its own reachable trusted
HTTPS origin. Configure private connectivity separately; the launcher does not
create a tunnel or certificate.

With the API, bridge and Expo ports free:

```bash
npm run demo:live -- --env-file=/absolute/private.env --check
npm run demo:live -- --env-file=/absolute/private.env
```

Open `http://localhost:8087` when using the default Expo port. The bridge and API
bind to loopback. Only the FirstDay API should be reachable through approved
private HTTPS; keep the bridge and database local. Expo receives an allowlist of
public app configuration, with private credential families removed. No live
session token belongs in an `EXPO_PUBLIC_*` variable.

The iOS custom build needs speech recognition and scene support from the
checked-in Expo configuration. Expo Go provides typing fallback. Build with
the same public API origin; root Bedrock, Bee and service-role credentials must
stay outside the mobile build environment.

## Three-minute demonstration route

1. Show the source identity and **real Bee** or **fictional example** label.
   Review included passages and confirm permission before extracting.
2. Confirm supported instruction cards. Choose exactly three for standard
   practice, or choose another conversation when fewer than three are clear.
3. Open **Check what I understood**. In the fictional Reservation exceptions
   example, explain: “Tomorrow I will cancel anything held for four days.”
   Show the original three-day rule and seven-day exception together.
4. Leave the date unknown to show paused rehearsal, then confirm whether the
   reservation predates the change. Rehearse the action for that context.
5. Open **Evening review**, choose one exact source target, review recognized
   words, preview and confirm an annotation. Show the unchanged original quote,
   correction history and undo. Use a separately imported source for an actual
   later rule; compare both sources before confirming Change Drill.
6. In connected mode, reopen saved training to show restored progress.

The locally recorded native fallback uses fictional content and temporary
offline progress. It does not establish a complete real capture/update demo.

## Validation and limits

Observed September 30, 2026:

- Final automated verification passed 691 tests across 61 files, workspace
  typecheck/lint/build, the live web export and both native Release builds.
  The 50-file web/native credential scan found no private credentials.
  One loaded authentication run exceeded its unchanged five-second timeout;
  the settled full rerun passed. Independent reviews accepted all repairs.
  A later commit-time check passed all 691 tests with `--maxWorkers=1` and
  unchanged timeouts after further parallel authentication/repository timeouts.
  Default parallel-run stability remains a development limitation.
- Actual authenticated production routes imported two user-owned Bee recordings
  and restored exact revisions and hashes after an API restart. Live picker,
  sign-in, refresh, sign-out and saved-source rendering passed at phone/desktop
  web widths. Both actual recordings extracted through Bedrock into the local
  durable database; all returned instructions require review.
- Two fresh fictional Bookshop provider journeys retained all three procedures,
  including duration and counting origin, generated three scenarios, rejected
  an unsupported answer and accepted the supported actions. Three unfamiliar
  fictional policy examples passed the same checks with tentative clauses left
  as questions. These small samples are not accuracy estimates.
- Actual Nova understanding checks preserved four old/new exception contexts,
  rejected unknown-context rehearsal and wrong-policy answers, and accepted
  supported paraphrases. Actual-provider correction preview, confirmation,
  revision, undo and fresh scenario generation passed separately.
- Local SQL, Auth and PostgREST checks exercise ownership, persistence,
  revocation, deletion, races and interrupted draft recovery. Fixture-memory
  model smokes and durable actual-source checks provide different evidence.
- Physical fictional practice/retry/recap and Change Drill passed on the earlier
  Release. The user directly verified Start/Stop speaking, live/final text and
  Check answer with no observed errors. The latest Release was built and
  installed; opening it is pending an unlocked phone.
- Latest Simulator Release verifies normal/largest accessibility text, readable
  fixed navigation and progress labels, usable permission switch and actual
  software-keyboard entry/dismissal in the understanding screen. Native typed
  correction review, exact target selection, preview, confirmation, reopen and
  undo passed with retained source/history. Full VoiceOver
  and physical cancellation/editing checks remain open.

The latest live Simulator build also signed in as the bound learner and
displayed the actual Bee conversation list. Its sign-out control, header,
navigation and progress labels fit at the largest accessibility text size.
Simulator text settings were restored after validation.

The two available real recordings yielded one reviewable instruction plus
questions, and zero instructions plus questions respectively. A suitable solo
training conversation and separate later policy update are still needed for
the full live journey. No processed Pioneer correction note was returned; no
direct Pioneer dialogue routing, speaker writeback or voice retraining is
claimed. Reported Bee time points are preserved, including ties and points
outside the reported conversation interval.

### Remaining device and recording input

Unlock the paired iPhone and Mac for Mirroring. The already verified basic
Start/Stop/transcription/Check answer path need not be repeated. Remaining
physical checks cover leaving practice while recording, editing recognized
words before submission, software-keyboard use and VoiceOver navigation.
Live physical testing also needs an approved private HTTPS connection to the
Mac API; provide an existing trusted origin or approve its private setup.

For a reproducible Bee test, two separate solo recordings can contain these
explicitly fictional scripts. Wait for Bee to process each conversation:

1. **Training:** “Bookshop training. New reservations last three calendar days,
   counting the set-aside day as day one. Reservations made before this training
   keep their original seven-day window. Ask for the collection code before
   handing over a reservation. Put damaged books in the green repair tray.”
2. **Update:** “Bookshop policy update. From this update onward, new reservations
   last two calendar days, counting the set-aside day as day one. Reservations
   made before the original training still keep their seven-day window. The
   collection-code and green-repair-tray procedures stay the same.”

Identify their conversation names and capture device when ready. These prove
the capture/integration path using fictional content; they do not establish
real workplace learning outcomes.

Participant research and hosted Supabase provisioning were explicitly deferred.
No ADHD benefit, measured learning effect, participant success rate or judging
score is established. Figma kit attribution is recorded; attribution alone
does not verify redistribution rights. No public upload or submission occurred.

See `TASKS.md` for the current acceptance status and work log.
See [observed development friction](development-feedback.md) for reproducible
problems, resolved app bugs, tooling limits and suggested improvements.
