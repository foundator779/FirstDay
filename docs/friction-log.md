# FirstDay friction log

Build, Ship, Shape: Amazon Developer Hackathon, Bee track (with AWS Builder).
Last updated October 7, 2026.

Every entry is something we actually hit while building FirstDay and FirstDay Go: the task,
what we did, what we expected, what happened, how bad it was, how we got past it, and one
concrete suggestion. Where the root cause was our own code rather than the tool, we say so.
Private transcripts, credentials and raw provider logs are left out.

Severity: **Critical** = blocked with no workaround · **High** = blocked a core flow until fixed ·
**Medium** = slowed us down or needed a workaround · **Low** = annoyance.

**Twelve entries about Amazon developer tools** (Bee and AWS) come first; other tools are in the appendix.
Entries 6 to 12 are dated; 1 to 5 are from September and early October.

| # | Tool | What happened | Severity | Where it stands |
|---|---|---|---|---|
| 1 | Bee CLI | Real timing fields didn't match our assumption | High | Fixed in our adapter |
| 2 | Amazon Bedrock | Valid structured output, missing a constraint | High | Prompt + source checks |
| 3 | Amazon Cognito | Regional pool list hid an existing pool | Medium | Workaround |
| 4 | AWS CloudShell | No scriptable way to bring files in | Medium | Workaround |
| 5 | Bee CLI (Windows) | Safe free-text write-back | Medium | `bee proxy` |
| 6 | Bee CLI | `--json` reply shapes undocumented; our new importer rejected real conversations | High | Fixed, pinned by tests |
| 7 | Bee CLI | ~420 MB npm package vs Lambda's 50 MB upload | Medium | Ship one binary |
| 8 | Bee CLI | File-based sign-in, no server-side token flow | Medium | Sealed per-request HOME; asking Bee |
| 9 | Bee | No push or webhook to a developer's app; stream events undocumented | Medium | Polling helper |
| 10 | AWS Lambda | Public Function URLs take two separate permissions | Low | Added in every deploy |
| 11 | Amazon Cognito | Can't be the OAuth server for any MCP client (no dynamic client registration) | Medium | Per-app keys |
| 12 | Amazon S3 | Website endpoints are http only; the https app can't reach the brain on the Wi-Fi | Low | Two links |

Feature requests that follow from these are in `docs/submission/feature-requests.md`.

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

### 6. Bee CLI: `--json` reply shapes aren't documented, and our new importer rejected real conversations

| | |
|---|---|
| **Date** | October 7, 2026 |
| **Tool** | Bee CLI (`bee conversations get <id> --json`), docs.bee.computer/docs/cli |
| **Task** | Import one processed Bee conversation into FirstDay Go through the brain on a computer. |
| **Steps** | Wrote a test against the reply shape our original adapter (services/bee-bridge) had proven on two real recordings, then ran the brain's real HTTP server against a stand-in CLI that returns that shape. |
| **Expected** | The CLI reference to show what each `--json` command returns, so a second implementation matches the first. |
| **Actual** | The CLI page lists the `--json` flags but no output shapes. The real `conversations get` reply wraps the conversation as `{ "conversation": {…}, "timezone": "UTC" }`; FirstDay Go's new importer expected a bare conversation, so every real conversation came back as "Couldn't reach Bee" (HTTP 502). Our earlier tests used a stand-in that returned the bare shape, so they passed. |
| **Severity** | High: the main "From my Bee" path in the new app failed on real data. |
| **Root cause** | Our code: we had the correct shape in our older adapter and didn't carry it over. Missing schemas made the slip easy. |
| **Workaround** | The importer now accepts the wrapped reply (and a bare one). The stand-in CLI now returns the real shapes (wrapper, a realtime draft before the final transcript, small relative `start` values next to a wall-clock `spoken_at`), and `brain/test/server.test.mjs` fails if this ever regresses. |
| **Suggestion** | Publish the JSON shape, or one real example reply, for every `--json` command (conversations list/get, facts, todos, suggestions, daily, insights) and for `bee stream --json` events. |

### 7. Bee CLI in AWS Lambda: the npm package ships every platform (about 420 MB)

| | |
|---|---|
| **Date** | October 6, 2026 |
| **Tool** | Bee CLI (`@beeai/cli` from npm), AWS Lambda |
| **Task** | Run Bee's official CLI inside Lambda, so a FirstDay account can connect its own Bee without a computer ("Connect Bee"). |
| **Steps** | In AWS CloudShell: `npm install @beeai/cli`, zip it with the function, `aws lambda update-function-code --zip-file`. |
| **Expected** | A package small enough for a Lambda zip (50 MB for a direct upload). |
| **Actual** | The npm package contains ready-made programs for every operating system, about 420 MB installed. |
| **Severity** | Medium: deploying needed a workaround. |
| **Root cause** | Packaging choice of the CLI; Lambda's limits are documented. |
| **Workaround** | `infra/deploy-bee.sh` installs the package in CloudShell and copies only `dist/platforms/linux-x64/bee` into the function (37 MB zipped), then checks `bee --version` before uploading. |
| **Suggestion** | Per-platform optional packages (the way esbuild ships `@esbuild/linux-x64`), or a documented standalone Linux download. |

### 8. Bee CLI on a server: sign-in is files in `~/.bee`, with no server-side token flow

| | |
|---|---|
| **Date** | October 6, 2026 |
| **Tool** | Bee CLI 0.7.3 (`bee login --no-wait`, `bee login`), AWS Lambda |
| **Task** | Keep one user's Bee sign-in on FirstDay's Bee service, safely, so later requests can read and write their Bee data. |
| **Steps** | `bee login --no-wait` in a fresh HOME (prints Bee's approval link), approve in Bee, re-run `bee login` to finish, then call the CLI on later requests. |
| **Expected** | A documented way for a server to hold a per-user credential (for example a device-code sign-in that hands back a refresh token). |
| **Actual** | The CLI keeps its sign-in as files under `HOME/.bee` ("Keychain not available, using file-based token storage") and may refresh them on any call. Lambda can only write to `/tmp`, and instances are shared, so the files can't simply stay on disk. |
| **Severity** | Medium: it works, but needs careful engineering, and we don't know yet whether Bee allows it for third-party apps. |
| **Root cause** | The CLI is designed for one person's own machine. |
| **Workaround** | For each request: restore that user's sign-in folder into a private `/tmp` HOME, run the CLI, save the folder back if it changed. It's stored only as AES-256-GCM ciphertext under a key that lives on the user's phone; Disconnect runs `bee logout` and deletes it. The service is limited to the developer's own account until Bee confirms server-side use is allowed. |
| **Suggestion** | Document whether, and how, a third-party app may act on a user's Bee data from a server, ideally with a consented per-user token instead of CLI files. |

### 9. Bee: no push or webhook to a developer's own app; `bee stream` events aren't described

| | |
|---|---|
| **Date** | October 3–5, 2026 |
| **Tool** | Bee CLI (`bee stream --json`, `bee conversations list --json`) |
| **Task** | Show "Just recorded by Bee" on the phone as soon as a training conversation finishes processing. |
| **Steps** | Ran `bee stream --json` on the computer next to the CLI and looked for an event that means "processed". |
| **Expected** | A webhook or push to the developer's own app (with the user's consent), or documented stream events. |
| **Actual** | The only live surface is `bee stream` on a machine running the CLI. The docs name the event types (`new-utterance`, `update-conversation`) but not their payloads, so a phone app needs a helper in between. |
| **Severity** | Medium: the live flow needs a computer (or FirstDay's Bee service) in the middle. |
| **Root cause** | Not available yet. |
| **Workaround** | The brain treats any conversation event only as a wake-up, re-reads the processed list (and every 90 s anyway), and the phone asks the brain every 45 s while open. |
| **Suggestion** | A consented webhook on "conversation processed", plus a documented payload for each `bee stream` event type. |

### 10. AWS Lambda Function URLs: public access takes two separate permissions

| | |
|---|---|
| **Date** | October 4–6, 2026 |
| **Tool** | AWS Lambda Function URLs, AWS CloudFormation, AWS CLI |
| **Task** | A public Function URL (`AuthType: NONE`; the function checks Cognito tokens itself) for each FirstDay Lambda, from one CloudFormation template per stack. |
| **Steps** | Read the Function URL access page first. It says that since October 2025 new URLs need both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`. The template creates the URL and the first permission; the second, limited to calls through the URL, is added by the CLI. Checked both with `aws lambda get-policy`. |
| **Expected** | One setting (or one CloudFormation property) for "this URL is public" that adds what's required. |
| **Actual** | Two resource-policy statements, and most templates and examples written before October 2025 show only the first, so a copied template gives a URL that refuses calls. |
| **Severity** | Low for us (the docs caught it before our first deploy); easy for others to miss. |
| **Root cause** | A documented platform change. |
| **Workaround** | Every deploy script (`infra/deploy.sh`, `deploy-bee.sh`, `deploy-coach.sh`) runs `aws lambda add-permission --action lambda:InvokeFunction --principal "*" --invoked-via-function-url` right after the stack. |
| **Suggestion** | Update the `AWS::Lambda::Url` examples to include the second statement, and have the console (or cfn-lint) warn when a `NONE` URL lacks it. |

### 11. Amazon Cognito as the login for an MCP server: no dynamic client registration

| | |
|---|---|
| **Date** | October 7, 2026 |
| **Tool** | Amazon Cognito (user pool `firstday-go-users`), Model Context Protocol 2025-11-25 authorization |
| **Task** | Let any MCP client (an AI assistant, the voice screen) sign in to FirstDay's coach MCP server with the user's FirstDay account. |
| **Steps** | Read the MCP authorization spec (clients discover the authorization server, then register: dynamic client registration or a client ID metadata document) and checked what Cognito user pools offer. |
| **Expected** | Cognito to act as the OAuth authorization server for clients it hasn't seen before. |
| **Actual** | Cognito user pools don't support dynamic client registration (RFC 7591), and we found no support for client ID metadata documents. Each client would have to be registered in the pool by hand. |
| **Severity** | Medium: the standard sign-in flow isn't available. |
| **Root cause** | Feature gap for this use case; works as documented. |
| **Workaround** | The user makes a key per app in FirstDay Go (signed in with Cognito). Only a SHA-256 hash is stored; each key can be removed, and turning the feature off deletes every key and the user's steps. |
| **Suggestion** | Dynamic client registration or client ID metadata documents in Cognito, or a reference pattern for MCP servers that use Cognito. |

### 12. Amazon S3 static websites are http only, and an https page can't reach the brain on the Wi-Fi

| | |
|---|---|
| **Date** | October 5–6, 2026 |
| **Tool** | Amazon S3 website hosting, Amazon CloudFront |
| **Task** | Host the web version of FirstDay Go so a phone without Expo Go can use it, including Bee through the brain on the same Wi-Fi. |
| **Steps** | One bucket with website hosting and CloudFront in front of it for https (`infra/web-hosting.yaml`). |
| **Expected** | One link that does everything. |
| **Actual** | From the https (CloudFront) page, browsers block calls to the brain's plain-http address on the local network (mixed content). S3 website endpoints themselves only serve http. |
| **Severity** | Low: everything works, from two links. |
| **Root cause** | Browser security rules, not an AWS defect. |
| **Workaround** | Two links: https for everything else, and the S3 website's http link for Bee on the Wi-Fi. The brain only accepts browser calls from that exact address. The app says which link to use when it sees the problem. |
| **Suggestion** | A short note in the S3 website and CloudFront docs on web apps that talk to devices on a local network (mixed content, Private Network Access). |


## Appendix: other tools (not Amazon)

### A1. Expo / iOS Release build: launch failure and clipped text at the largest size

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

### A2. Speech recognition isn't available in Expo Go

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

### A3. Expo Snack's newest SDK is behind ours

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

### A4. Local auth integration tests timed out under machine load

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

### A5. Simulator automation and video capture

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

### A6. Node.js 22 test runner: a directory argument doesn't run the tests in it

| | |
|---|---|
| **Date** | October 7, 2026 |
| **Tool** | Node.js 22 (`node --test`) |
| **Task** | Run the Bee service tests the way our README said: `node --test infra/bee-lambda/test/`. |
| **Steps** | Ran it on Node 22.22. |
| **Expected** | Every test file in the folder runs. |
| **Actual** | Node treated the folder as a file to load and failed with `Cannot find module`; since Node 21 the arguments are glob patterns. |
| **Severity** | Low. |
| **Root cause** | Our README. |
| **Workaround** | Quoted globs everywhere (`node --test "infra/bee-lambda/test/*.test.mjs"`), wrapped in `npm run test:node`, which CI runs. |
| **Suggestion** | A hint in the error when the argument is a directory. |


## What we're still verifying

- The full real-data journey (a Bee-recorded training, a later update from the trainer, the Change Drill) needs a
  purpose-recorded, consented training conversation; the two older real recordings yielded 1 and 0 instructions.
  `npm run bee:evidence` writes the counts to `docs/BEE_LIVE.md` once it's recorded.
- FirstDay Go passes 57 logic tests and 40 integration tests (the brain against a stand-in Bee CLI, the Bee service,
  the coach service and its MCP server), the extraction eval gate and a typecheck, in CI on every push.
- Connect Bee (the Bee CLI in Lambda) hasn't been tried with a real Bee approval yet, and the coach service
  (team trainings and the MCP server) is tested in memory; its first deploy is the next check.
