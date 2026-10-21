# Bee CLI 0.7.3 friction log: integrating Bee into FirstDay Go

| Reviewer | Status |
| :--- | :--- |
| **FirstDay Go team** | Complete (last updated October 20, 2026) |
| **Bee product team** | Under review |

Written with [Trag's friction log template](https://github.com/chris-trag/friction-log-guide/blob/main/templates/friction-log-template.md).
It covers only our integration with Bee: getting conversations recorded by Bee on an Apple Watch into FirstDay Go
through Bee's CLI, and writing the user's changes back. Each entry has the task, the steps we took, what we expected,
what happened, how bad it was, how we got past it, and a recommendation. Where the root cause was our own code rather
than Bee, we say so. Private transcripts, credentials and raw logs are left out.

## BLUF (bottom line up front)

The integration works end to end with real data: Bee recorded a training on an Apple Watch, and Bee's CLI brought it
into FirstDay Go, both from a computer and from AWS Lambda with no computer. Signing in and reading data were quick.
What cost us time is that **the CLI's JSON replies, its live `bee stream` events and any server-side sign-in aren't
documented**. That led to one broken release, a helper we had to run in between, and two features we had to drop.

**Grade: B−** (everything works today, but a developer new to Bee would lose days guessing the CLI's formats)

**Size: Medium** (9 entries across one integration, October 1 to 20, 2026)

## Persona

- **Role:** a small hackathon team building a mobile app (Expo, React Native) from a Windows PC.
- **Experience with this product:** first time with the Bee CLI and Bee's developer docs; first time running Bee on an
  Apple Watch.
- **Goal:** get a real training conversation from Bee on an Apple Watch into a phone app, keep the user's fixes in sync
  with Bee, and let a phone connect its Bee without a computer.
- **Technical context:** a small Node.js helper next to the Bee CLI on the PC, and the same CLI inside AWS Lambda for
  "Connect Bee".

## Scope

- [x] Record a real training with Bee on an Apple Watch and read it with the Bee CLI
- [x] Import processed conversations, facts, to-dos, daily summaries and insights
- [x] Write the user's changes back to Bee (facts, to-dos, accepted suggestions)
- [x] Show "Just recorded by Bee" as soon as a conversation is processed (`bee stream`)
- [x] Run the Bee CLI in AWS Lambda so a phone can connect its Bee with no computer
- [ ] Remind the learner on the Apple Watch with a Bee to-do alarm (didn't reach the Watch: entry 7)
- [ ] Credit each step to the person who said it (every speaker is "Unknown": entry 8)
- [ ] Cue the right step during a shift, while the trainer is talking (dropped: entry 9)

## Pros

- **Signing in is easy.** `bee login` prints an approval link, you approve it in the Bee app, and the CLI is ready.
  `bee login --no-wait` made the same flow possible from a server.
- **Real data quickly.** Minutes after Bee on the Apple Watch finished a conversation,
  `bee conversations list --json` showed it, with Bee's own title and a final transcript.
- **Symmetric commands.** Every read we needed has a matching write (`facts confirm/update/create/delete`,
  `todos create/complete`, `accept-suggestion`), so two-way sync took little code.
- **`bee proxy`** gave us a safe local HTTP way to write user text back to Bee on Windows.
- **One CLI everywhere.** The same commands worked on the Windows PC and inside Lambda on Linux.

## Cons

- The CLI documents its flags but not what its `--json` commands return, or what `bee stream` events contain.
- There's no consented way for a third-party server to act for a user; the CLI keeps its sign-in as files.
- No push or webhook when a conversation is processed, so a phone app needs a helper in between.
- To-do alarms written through the CLI didn't buzz on the Apple Watch, and every speaker comes back as "Unknown".
- The npm package is about 420 MB (every platform), and on Windows it's a `.cmd` shim.

Severity: 🔥 Critical = blocked with no workaround · ⚠️ High = blocked a core flow until fixed · ⚡ Medium = slowed us
down or needed a workaround · ℹ️ Low = annoyance.

| # | What happened | Severity | Where it stands |
|---|---|---|---|
| 1 | Real timing fields didn't match our assumption | ⚠️ High | Fixed in our adapter |
| 2 | Windows `.cmd` shim makes safe free-text writes hard | ⚡ Medium | `bee proxy` |
| 3 | `--json` reply shapes undocumented; our new importer rejected real conversations | ⚠️ High | Fixed, pinned by tests |
| 4 | About 420 MB npm package vs Lambda's 50 MB upload | ⚡ Medium | Ship one binary |
| 5 | File-based sign-in, no server-side token flow | ⚡ Medium | Sealed per-request HOME; asking Bee |
| 6 | No push or webhook to a developer's app; stream events undocumented | ⚡ Medium | Polling helper |
| 7 | To-do alarms written through the CLI didn't buzz on the Apple Watch | ⚠️ High | Phone notification instead |
| 8 | Every speaker in a transcript is "Unknown" | ⚡ Medium | The user says who spoke |
| 9 | Final transcripts only after the conversation ends; live events undocumented | ⚡ Medium | Feature dropped |

Feature requests that follow from these are in [feature-requests.md](submission/feature-requests.md).

## Friction

### 1. Conversation timing fields didn't match our assumption

**Severity:** ⚠️ High

**When:** Early October 2026

**Tool:** Bee CLI (`bee conversations get <id> --json`)

**Task:** Import a real, processed Bee conversation into FirstDay with every passage and its time preserved.

**Steps taken:** `bee login` → `bee conversations list --json` → `bee conversations get <id> --json` → our local
bridge import.

**Expected:** Utterance `start`/`end` to be epoch timestamps inside the conversation's start/end window.

**Actual:** The real payload had small `start`/`end` values, a wall-clock `spoken_at`, zero-length utterances,
utterances with identical times, and one point outside the reported conversation window. Our adapter rejected the
whole conversation.

**Root cause:** Our adapter's assumption, not a proven Bee defect.

**Workaround:** Keep the raw timing fields and exact text order; treat `spoken_at` as a reported point in time; never
invent a duration or clamp a point into the window. Two real recordings then imported, extracted and survived a
restart.

**Recommendation:** Document the units, origin and guarantees of `start`, `end` and `spoken_at` for final and
realtime transcripts, including ties and zero-length cases, with one real example payload.

### 2. Bee CLI on Windows: writing user text back to Bee safely

**Severity:** ⚡ Medium

**When:** Early October 2026

**Tool:** Bee CLI (npm-installed on Windows), Node.js `child_process`

**Task:** Let the FirstDay Go helper on a Windows PC write the user's fixes back to Bee
(`bee facts update <id> --text …`, `bee todos create --text …`).

**Steps taken:** Spawned `bee` with an argument array (no shell), as on macOS and Linux.

**Expected:** User-typed text is passed as one argument and never parsed by a shell.

**Actual:** On Windows the CLI is a `.cmd` shim. Current Node refuses to spawn `.cmd` files without `shell: true` (the
CVE-2024-27980 fix), and with a shell, user text would go through `cmd.exe` parsing.

**Root cause:** Windows and Node behaviour, not a Bee defect.

**Workaround:** On Windows, reads and ID-only writes run through the shim with strictly validated arguments (IDs must
match a safe pattern); free text goes to `bee proxy` on localhost as JSON (`/v1/facts`, `/v1/todos`). macOS and Linux
keep the plain argument array.

**Recommendation:** Ship a native `bee.exe`, or document `bee proxy` as the supported way for programs to write, with
a Windows note in the CLI docs.

### 3. `--json` reply shapes aren't documented, and our new importer rejected real conversations

**Severity:** ⚠️ High

**When:** October 7, 2026

**Tool:** Bee CLI (`bee conversations get <id> --json`), docs.bee.computer/docs/cli

**Task:** Import one processed Bee conversation into FirstDay Go through the helper on a computer.

**Steps taken:** Wrote a test against the reply shape our original adapter had proven on two real recordings, then
ran the helper's real HTTP server against a stand-in CLI that returns that shape.

**Expected:** The CLI reference to show what each `--json` command returns, so a second implementation matches the
first.

**Actual:** The CLI page lists the `--json` flags but no output shapes. The real `conversations get` reply wraps the
conversation as `{ "conversation": {…}, "timezone": "UTC" }`; FirstDay Go's new importer expected a bare
conversation, so every real conversation came back as "Couldn't reach Bee" (HTTP 502). Our earlier tests used a
stand-in that returned the bare shape, so they passed.

**Root cause:** Our code: we had the correct shape in our older adapter and didn't carry it over. Missing schemas
made the slip easy.

**Workaround:** The importer now accepts the wrapped reply (and a bare one). The stand-in CLI now returns the real
shapes (the wrapper, a realtime draft before the final transcript, small relative `start` values next to a wall-clock
`spoken_at`), and `brain/test/server.test.mjs` fails if this ever regresses.

**Recommendation:** Publish the JSON shape, or one real example reply, for every `--json` command (conversations
list/get, facts, todos, suggestions, daily, insights) and for `bee stream --json` events.

### 4. Bee CLI in AWS Lambda: the npm package ships every platform (about 420 MB)

**Severity:** ⚡ Medium

**When:** October 6, 2026

**Tool:** Bee CLI (`@beeai/cli` from npm), AWS Lambda

**Task:** Run Bee's official CLI inside Lambda, so a FirstDay account can connect its own Bee without a computer
("Connect Bee").

**Steps taken:** `npm install @beeai/cli`, zip it with the function, `aws lambda update-function-code --zip-file`.

**Expected:** A package small enough for a Lambda zip (50 MB for a direct upload).

**Actual:** The npm package contains ready-made programs for every operating system, about 420 MB installed.

**Root cause:** The CLI's packaging choice.

**Workaround:** `infra/deploy-bee.sh` installs the package and copies only `dist/platforms/linux-x64/bee` into the
function (37 MB zipped), then checks `bee --version` before uploading.

**Recommendation:** Per-platform optional packages (the way esbuild ships `@esbuild/linux-x64`), or a documented
standalone Linux download.

### 5. Bee CLI on a server: sign-in is files in `~/.bee`, with no server-side token flow

**Severity:** ⚡ Medium

**When:** October 6, 2026 (first real approval through it on October 17)

**Tool:** Bee CLI 0.7.3 (`bee login --no-wait`, `bee login`), AWS Lambda

**Task:** Keep one user's Bee sign-in on FirstDay's Bee service, safely, so later requests can read and write their
Bee data.

**Steps taken:** `bee login --no-wait` in a fresh HOME (prints Bee's approval link), approved it in Bee, re-ran
`bee login` to finish, then called the CLI on later requests.

**Expected:** A documented way for a server to hold a per-user credential (for example a device-code sign-in that
hands back a refresh token).

**Actual:** The CLI keeps its sign-in as files under `HOME/.bee` ("Keychain not available, using file-based token
storage") and may refresh them on any call. Lambda can only write to `/tmp`, and instances are shared, so the files
can't simply stay on disk.

**Root cause:** The CLI is designed for one person's own machine.

**Workaround:** For each request: restore that user's sign-in folder into a private `/tmp` HOME, run the CLI, save
the folder back if it changed. It's stored only as AES-256-GCM ciphertext under a key that lives on the user's phone;
Disconnect runs `bee logout` and deletes it. The service is limited to the owner's account until Bee confirms
server-side use is allowed. On October 17 a real Apple Watch conversation came through it into the app.

**Recommendation:** Document whether, and how, a third-party app may act on a user's Bee data from a server, ideally
with a consented per-user token instead of CLI files.

### 6. No push or webhook to a developer's own app; `bee stream` events aren't described

**Severity:** ⚡ Medium

**When:** October 3–5, 2026

**Tool:** Bee CLI (`bee stream --json`, `bee conversations list --json`)

**Task:** Show "Just recorded by Bee" on the phone as soon as a training conversation finishes processing.

**Steps taken:** Ran `bee stream --json` on the computer next to the CLI and looked for an event that means
"processed".

**Expected:** A webhook or push to the developer's own app (with the user's consent), or documented stream events.

**Actual:** The only live surface is `bee stream` on a machine running the CLI. The docs name the event types
(`new-utterance`, `update-conversation`) but not their payloads, so a phone app needs a helper in between.

**Root cause:** Not available yet.

**Workaround:** The helper treats any conversation event only as a wake-up, re-reads the processed list (and every
90 seconds anyway), and the phone asks the helper every 45 seconds while open.

**Recommendation:** A consented webhook on "conversation processed", plus a documented payload for each `bee stream`
event type.

### 7. Bee on Apple Watch: to-do alarms written through the CLI didn't buzz on the Watch

**Severity:** ⚠️ High (for this feature; we removed it)

**When:** October 18–19, 2026

**Tool:** Bee CLI (`bee todos create --text … --alarm-at <ISO time> --json`), Bee on iPhone and Apple Watch

**Task:** Remind the learner on their wrist before a shift ("Practise Juniper Café before your shift: 3 steps"), and
ring again a minute after a trainer changes a step.

**Steps taken:** FirstDay Go wrote the reminder as a Bee to-do with an alarm through the CLI, then we waited for the
alarm time wearing the Apple Watch running Bee.

**Expected:** Bee's to-do alarm to buzz on the Apple Watch, where Bee is running.

**Actual:** The to-do appeared in Bee, but the alarm didn't buzz on the Watch. We found nothing in the docs saying
where a to-do alarm is delivered.

**Root cause:** Unknown. Alarms may only be delivered on the phone; this isn't documented.

**Workaround:** FirstDay no longer writes Bee alarms. The practice reminder is a plain FirstDay notification on the
phone, and all "on your wrist" wording was removed. Reminders an older version wrote into Bee are still checked off
there once practised.

**Recommendation:** Document where to-do alarms are delivered (phone, Apple Watch, Bee wearable), and deliver them
on the Apple Watch when Bee runs there.

### 8. Every speaker in a transcript is "Unknown"

**Severity:** ⚡ Medium

**When:** October 18–19, 2026

**Tool:** Bee CLI (`bee conversations get <id> --json`), recordings from Bee on an Apple Watch

**Task:** Credit each step to the trainer who said it, and credit praise ("Great job handling that refund") to the
person who gave it in the employee's record.

**Steps taken:** Read both real Apple Watch recordings from October 18 through the CLI and looked at each
utterance's speaker.

**Expected:** Speaker names, or at least a stable label per person, so the app can tell the trainer from the learner.

**Actual:** Every utterance's speaker was "Unknown", so there's no way to tell who said what.

**Root cause:** Not established: it may be because neither voice was set up in Bee.

**Workaround:** The user types who taught them ("Who taught you?") and picks who gave each piece of praise when they
keep it. Nothing is guessed.

**Recommendation:** Return a stable speaker ID per person in the transcript JSON, plus the name when the user has
set one up in Bee, and document how speakers get named.

### 9. Final transcripts only arrive after the conversation ends; live events aren't documented

**Severity:** ⚡ Medium (we dropped a feature)

**When:** October 19, 2026

**Tool:** Bee (processing), Bee CLI (`bee stream --json`)

**Task:** An "On shift" mode that would bring up the right step while the trainer or a customer is still talking.

**Steps taken:** Timed when a conversation recorded on the Apple Watch became available as a processed transcript,
and looked for a documented live event we could use instead.

**Expected:** Either the transcript within seconds, or documented live utterance events.

**Actual:** Bee processes a conversation after it ends, so a cue would arrive after the moment had passed. The
`new-utterance` events from `bee stream` have no documented payload (entry 6), and the realtime drafts we saw were
fragments ("A few", then "A few things for today.").

**Root cause:** Bee's design; the live surface isn't documented for developers.

**Workaround:** Dropped "On shift". FirstDay Go focuses on practice before the shift instead.

**Recommendation:** Document `new-utterance` events (payload, latency, when drafts are replaced) so apps can build
in-conversation features responsibly.

## Questions

- May a third-party app run the Bee CLI on a server for a user who consents (entry 5)? If not, what's the supported
  route for a phone app?
- What do `bee stream` events contain, and how soon after speech does a `new-utterance` arrive (entries 6 and 9)?
- What are the units and origin of `start` and `end`, and how do they relate to `spoken_at` (entry 1)?
- Where are Bee to-do alarms delivered, and can they reach the Apple Watch (entry 7)?
- How does Bee name speakers, and can the CLI return a stable ID per speaker (entry 8)?

## Recommendations

Ranked by how much time they would have saved us:

1. **Publish the JSON shape of every `--json` reply and every `bee stream` event**, with real examples
   (entries 1, 3, 6 and 9). This cost us a broken release.
2. **A consented server-side route for third-party apps**, such as a per-user token from a device-code sign-in, and
   a clear policy (entry 5).
3. **A webhook when a conversation is processed** (entry 6), so phone apps don't need a helper.
4. **Deliver to-do alarms on the Apple Watch, or document where they go** (entry 7).
5. **Stable speaker IDs in transcripts** (entry 8).
6. **Per-platform CLI packages and a native Windows binary** (entries 2 and 4).

## Video and screen recording

Our development sessions weren't screen-recorded, so there are no session timestamps. Each entry above comes from our
notes, commits and test fixtures written at the time. The [demo video](https://www.youtube.com/watch?v=h5Ks2q6d43c)
shows the working flow these entries led to: Bee recording on an Apple Watch, and the same conversation arriving in
FirstDay Go through Bee's CLI in AWS Lambda.

## Test environment

- **OS:** Windows PC (helper next to the CLI); AWS Lambda on Node.js 22, x86_64 (Connect Bee)
- **Devices:** iPhone and Apple Watch running Bee
- **Bee:** Bee CLI 0.7.3 (`@beeai/cli` from npm), the Bee iPhone app and Bee on Apple Watch
- **App:** FirstDay Go on Expo SDK 57, React Native 0.86
- **Runtime:** Node.js 22

## What succeeded

- ✅ A real training recorded by Bee on an Apple Watch, read by Bee's CLI and turned into work steps in FirstDay Go
  (October 18, 2026)
- ✅ Connect Bee with no computer: Bee's CLI in AWS Lambda, with the sign-in sealed by a key on the phone (October 17)
- ✅ Two-way sync of Bee facts, to-dos and suggestions
- ✅ "Just recorded by Bee" from `bee stream`, through the helper
- ✅ Integration tests that use the real Bee reply shapes

## What failed

- ❌ Our first importer for real Bee conversations (entry 3), fixed and now pinned by a test
- ❌ Bee to-do alarms on the Apple Watch (entry 7), replaced with a phone notification
- ❌ Telling speakers apart (entry 8), replaced by asking the user
- ❌ Cueing steps during a shift (entry 9), dropped
