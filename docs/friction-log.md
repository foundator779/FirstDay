# FirstDay friction log

Build, Ship, Shape: Amazon Developer Hackathon, Bee track (with AWS Builder).
Last updated October 4, 2026.

Every entry is something we actually hit while building FirstDay and FirstDay Go: the task,
what we did, what we expected, what happened, how bad it was, how we got past it, and one
concrete suggestion. Where the root cause was our own code rather than the tool, we say so.
Private transcripts, credentials and raw provider logs are left out.

Severity: **Critical** = blocked with no workaround · **High** = blocked a core flow until fixed ·
**Medium** = slowed us down or needed a workaround · **Low** = annoyance.

## Amazon developer tools

### 1. Bee CLI: conversation timing fields didn't match our assumption

| | |
|---|---|
| **Tool** | Bee CLI (`bee conversations get <id> --json`) |
| **Task** | Import a real, processed Bee conversation into FirstDay with every passage and its time preserved. |
| **Steps** | `bee login` → `bee conversations list --json` → `bee conversations get <id> --json` → FirstDay local bridge import. |
| **Expected** | Utterance `start`/`end` to be epoch timestamps inside the conversation's start/end window. |
| **Actual** | The real payload had small `start`/`end` values, a wall-clock `spoken_at`, zero-length utterances, utterances with identical times, and one point outside the reported conversation window. Our adapter rejected the whole conversation. |
| **Severity** | High: real Bee import was blocked. |
| **Root cause** | Our adapter's assumption, not a proven Bee defect. |
| **Workaround** | Keep the raw timing fields and exact text order; treat `spoken_at` as a reported point in time; never invent a duration or clamp a point into the window. Two real recordings then imported, extracted and restored after a restart. |
| **Suggestion** | Document the units, origin and guarantees of `start`, `end` and `spoken_at` for final vs. realtime transcripts, including ties and zero-length cases, with one real example payload. |

### 2. Amazon Bedrock (Nova Pro): valid structured output, missing a constraint

| | |
|---|---|
| **Tool** | Amazon Bedrock Converse API, Nova Pro, tool-use structured output |
| **Task** | Turn a training conversation into reviewable work rules (situation + exact action). |
| **Steps** | Send utterances with a JSON schema through a forced `submit_result` tool call; validate with Zod; generate practice from the result. |
| **Expected** | The action keeps every requirement that was said ("hold for five calendar days, counting the set-aside day as day one"). |
| **Actual** | Output was schema-valid, but one run put the duration only in the rule text and dropped it from the action used for practice. It also labeled an unconditional counting rule as an "exception". |
| **Severity** | High: practice could have graded learners against an incomplete rule. |
| **Root cause** | Our prompt and validation; this says nothing about model accuracy in general. |
| **Workaround** | Prompt rules that require numbers, calendar vs. business days, counting origin, order and applicability inside the action; deterministic checks that the action keeps the source's numbers; tentative language ("maybe", "usually") is forced into questions, never rules. Earlier failing outputs kept as evidence. |
| **Suggestion** | A Bedrock docs example showing that structured output guarantees shape, not faithfulness, and a pattern for checking extracted text against its source. |

### 3. Amazon Cognito: user pools are listed per region, so we created a duplicate

| | |
|---|---|
| **Tool** | Amazon Cognito (AWS CLI in AWS CloudShell) |
| **Task** | Before creating a user pool for FirstDay Go sign-in, confirm the account didn't already have one. |
| **Steps** | Verified the account ID with `aws sts get-caller-identity`, ran `aws cognito-idp list-user-pools --max-results 60` in us-east-1 (empty), created `firstday-go-users`. |
| **Expected** | To see any existing user pool in the account before creating a new one. |
| **Actual** | The account already had a pool in us-west-2. `list-user-pools` only covers the current region, so the check passed and we created a second pool in us-east-1. |
| **Severity** | Medium: no data affected, but two pools to reconcile and a risk of pointing the app at the wrong one. |
| **Root cause** | Our check was regional; the service behaved as documented. |
| **Workaround** | Loop `list-user-pools` over every enabled region (`aws account list-regions`), or use AWS Resource Explorer, before creating auth resources. |
| **Suggestion** | Show user pools from other regions in the Cognito console's empty state (e.g. "You have 1 user pool in US West (Oregon)"). |

### 4. AWS CloudShell: getting project files in from an automated session

| | |
|---|---|
| **Tool** | AWS CloudShell (in the browser) |
| **Task** | Deploy the FirstDay Go AI endpoint (CloudFormation template, deploy script, Lambda code) and run the Bedrock eval from CloudShell, so no AWS keys live on a laptop. |
| **Steps** | Opened CloudShell in us-east-1, confirmed the account with `aws sts get-caller-identity`, then needed nine small files (13 KB compressed) inside the shell. |
| **Expected** | A scriptable way to bring a small bundle in (paste, drop, or a CLI copy command). |
| **Actual** | **Actions → Upload file** opens the operating system's file picker, which our browser-automation agent can't drive. There's no CLI or API to copy a file into a session, and the terminal lives in a cross-origin frame, so its output can't be read as page text either. |
| **Severity** | Medium: deployment worked, with a workaround. |
| **Root cause** | A gap in the tool for automated and assistive workflows. |
| **Workaround** | Typed the bundle into the terminal as base64 in three ~6,000-character chunks, checked each chunk's MD5, rebuilt the archive and verified its MD5 before running `deploy.sh`. Printed results as one-line summaries and read them from screenshots. Removed the files afterwards. |
| **Suggestion** | Let CloudShell accept a dropped or pasted file without the native picker, or add a CLI command to copy a local file into the environment; an accessible text view of terminal output would help agents and screen-reader users alike. |

### 5. Bee CLI on Windows: writing user text back to Bee safely

| | |
|---|---|
| **Tool** | Bee CLI (npm-installed on Windows), Node.js `child_process` |
| **Task** | Let the FirstDay Go helper on a Windows PC write the user's fixes back to Bee (`bee facts update <id> --text …`, `bee todos create --text …`). |
| **Steps** | Spawn `bee` with an argument array (no shell), as on macOS and Linux. |
| **Expected** | User-typed text is passed as one argument and never parsed by a shell. |
| **Actual** | On Windows the CLI is a `.cmd` shim. Current Node refuses to spawn `.cmd` files without `shell: true` (the CVE-2024-27980 fix), and with a shell, user text would go through `cmd.exe` parsing. |
| **Severity** | Medium: free-text write-back on Windows needed a different path. |
| **Root cause** | Windows and Node behaviour, not a Bee defect. |
| **Workaround** | On Windows, reads and ID-only writes run through the shim with strictly validated arguments (IDs must match a safe pattern); free text goes to `bee proxy` on localhost as JSON (`/v1/facts`, `/v1/todos`). macOS and Linux keep the plain argument array. |
| **Suggestion** | Ship a native `bee.exe`, or document `bee proxy` as the supported way for programs to write, with a Windows note in the CLI docs. |

## Other tools in our build

### 6. Expo / iOS Release build: launch failure and clipped text at the largest size

| | |
|---|---|
| **Tool** | Expo SDK custom iOS Release build, iOS Simulator accessibility text sizes |
| **Task** | Install a Release build on a paired iPhone; check screens at the largest accessibility text size. |
| **Steps** | Built a custom Release, installed it on the paired iPhone and launched it; separately set the Simulator to the largest Accessibility text size and inspected the training and review screens. |
| **Expected** | App launches; fixed navigation stays readable at the largest text. |
| **Actual** | First physical build failed at scene-lifecycle launch. At maximum text size, fixed headings were oversized and navigation, source selectors and progress labels clipped. |
| **Severity** | High (launch), Medium (layout). |
| **Root cause** | Our build configuration and fixed-chrome layout. |
| **Workaround** | Supported Expo SDK patch plus `enableSceneSupport` in `expo-build-properties`. Font scaling capped only for fixed chrome; content keeps full scaling; touch targets and labels unchanged. |
| **Suggestion** | Keep a Release launch and a largest-text screenshot in every native acceptance run. |

### 7. Speech recognition isn't available in Expo Go

| | |
|---|---|
| **Tool** | Expo Go, `expo-speech-recognition` |
| **Task** | Let learners answer practice scenarios by speaking, on a phone running Expo Go. |
| **Steps** | Planned spoken answers for FirstDay Go and checked the speech module against what Expo Go ships. |
| **Expected** | Start/stop speech recognition in Expo Go like other Expo modules. |
| **Actual** | It's a native module Expo Go doesn't include; speech needed a custom iOS build (verified separately on a physical iPhone). |
| **Severity** | Medium: the fastest test path (Expo Go) had no speech input. |
| **Root cause** | A known Expo Go limit, by design. |
| **Workaround** | FirstDay Go uses the iOS keyboard's dictation mic in every text field, which works in Expo Go; read-aloud uses `expo-speech`, which Expo Go includes. |
| **Suggestion** | Expo Go could list which popular community modules need a development build when an import fails. |

### 8. Expo Snack's newest SDK is behind ours

| | |
|---|---|
| **Tool** | Expo Snack (browser preview on an Appetize-hosted iPhone) |
| **Task** | Preview FirstDay Go on an iPhone in the browser without a local build. |
| **Steps** | Opened the project in Snack and looked for SDK 57 in its SDK picker. |
| **Expected** | Run the project at its SDK version. |
| **Actual** | Snack's SDK picker topped out at 55; FirstDay Go targets SDK 57. Snack also needs an `App.js` entry rather than expo-router's `app/` folder. |
| **Severity** | Low: we test on a real iPhone with Expo Go instead. |
| **Root cause** | Snack's SDK support trails the latest release. |
| **Workaround** | Real device via Expo Go and `npx expo start`. |
| **Suggestion** | Snack could state its supported SDK range up front. |

### 9. Local auth integration tests timed out under machine load

| | |
|---|---|
| **Tool** | Vitest with local Supabase SQL, GoTrue and PostgREST (original FirstDay backend) |
| **Task** | Run the full suite while native builds and screen capture were running. |
| **Steps** | Ran `npm test` with the isolated local SQL, GoTrue and PostgREST settings during native capture and input. |
| **Expected** | The auth journey finishes within its 5-second timeout. |
| **Actual** | Several parallel runs timed out in the auth (and once the repository) integration tests; the isolated tests passed. |
| **Severity** | Medium: inconsistent verification. |
| **Root cause** | Not established; concurrent machine load is the likely contributor. |
| **Workaround** | Finish heavy builds first; full suite passed all 691 tests in 61 files with `--maxWorkers=1` and the same timeouts. Timeouts were never raised to force a pass. |
| **Suggestion** | Record per-step durations for the auth journey in CI before changing thresholds. |

### 10. Simulator automation and video capture

| | |
|---|---|
| **Tool** | RocketSim accessibility snapshots and recording |
| **Task** | Drive the native app with accessibility targets and record a walkthrough for the demo. |
| **Steps** | Selected controls from accessibility snapshots, typed into them, then recorded a 150-second walkthrough at 30 fps. |
| **Expected** | Reported targets are tappable; a finished recording comes back. |
| **Actual** | Some reported controls were off-screen; focusing a covered input could leave the previous input active; a 150-second 30 fps recording exceeded the tool's transfer limit and produced nothing. |
| **Severity** | Medium. |
| **Root cause** | Tooling and automation workflow, not Bee. |
| **Workaround** | Check the current frame, scroll targets into view and confirm focus before typing; a shorter 10 fps capture produced a usable 69-second clip. |
| **Suggestion** | Expose the capture size limit before recording, or write recordings straight to a file. |

## What we're still verifying

- The two real Bee recordings we have yielded 1 and 0 reviewable instructions, so the full
  real-data training → later update → Change Drill journey still needs a purpose-recorded
  training conversation. That's a content gap, not a Bee defect.
- FirstDay Go (the Expo Go app) passes 32 logic tests, a typecheck and code review; its run on a physical
  iPhone through Expo Go, and the two-way sync against a real Bee account, are the next checks.
- The deployed AWS endpoint answered its health check and rejected unsigned and forged tokens (401). The signed-in
  path is verified with the same code in tests; a call with a real Cognito token from the phone is the next check.
