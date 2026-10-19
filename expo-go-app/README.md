# FirstDay Go

[![FirstDay Go checks](https://github.com/foundator779/FirstDay/actions/workflows/firstday-go.yml/badge.svg)](https://github.com/foundator779/FirstDay/actions/workflows/firstday-go.yml)

**Bee track entry for Build, Ship, Shape: Amazon Developer Hackathon.**

A calm, black-and-white iPhone app with one job: **getting you ready for your next shift.** Bee hears your trainer;
FirstDay Go finds each step next to their exact words, turns it into short role-play practice, and keeps you current:
when your trainer changes a step, you get a **Change Drill** (old vs. new, and the old answer becomes a trap). Vague
lines become **questions to ask**, never rules. Built for ADHD brains: one next thing at a time.

- **Today** shows one next thing: a training Bee just recorded, a step your trainer changed, steps to confirm, practice, questions to ask.
- **Train** holds your trainings. A trainer (or job coach) can **share a training with a 6-character code**; their later changes reach every trainee.
- **Questions** lists what was said vaguely, to ask before your shift.
- **More** has the everyday helpers built on Bee (to-dos, Ask, memories, evening review, patterns) and **Quiz me anywhere**:
  a remote **MCP server** (spec 2025-11-25) and a **voice screen** that quiz you in your trainer's words.

It runs in **Expo Go** on an iPhone, served from a Windows, Mac or Linux computer: no Xcode, no custom build.
To try it without installing anything, open https://d1ypavau8ae868.cloudfront.net and tap **Create account** (free:
an email you can read, a password, the terms of use, then the 6-digit code). Train → **Try a sample training** adds
fictional trainings to practise.

## How real Bee data gets in, and goes back

```
Bee wearable ─▶ Bee cloud ─▶ Bee CLI on your computer ─▶ brain/server.mjs ─▶ FirstDay Go on iPhone
 (records)      (processes)   (conversations, facts,       (watches Bee live;     (practice, to-dos,
                               to-dos, daily, insights)     pairing code)          memories)
                                         ▲                                              │
                                         └────── your fixes, kept to-dos, done ◀────────┘
```

- **Conversations.** `bee conversations list/get --json`; only Bee's final processed transcript, exact text, Bee's reported order.
  Nothing is read until you OK it.
- **Live.** The brain runs `bee stream --json`. When a conversation finishes processing, Today shows
  "Just recorded by Bee" and you get a notification: one tap turns a training into practice while it's fresh.
- **Two-way sync.** Bee facts become memories (confirm, fix or forget them here and it reaches Bee), Bee to-dos and
  to-do suggestions land in your lists (keeping or finishing one here does the same in Bee), and Bee's daily summary and
  insights appear on Today. Settings → Bee has **Sync with Bee now** and a **Send my changes to Bee** switch.
- **Coach skill.** Confirmed work rules are shared with the brain, so any agent with the
  [`firstday-coach` Agent Skill](skills/firstday-coach/SKILL.md) can quiz you on them (it composes with the `bee-cli` skill).

## Team trainings: a trainer's change reaches everyone

Train → a training → **Share with my team** gives a join code (say `K7P2QX`). New hires tap **Join my team's
training**, type it, and get every step in the trainer's words. When the trainer records an update with their Bee (or
pastes it) and adds it to the shared training, the change applies on their phone and waits for **Send my changes to
the team**. Each trainee's app checks when it opens (and every 5 minutes while open): a step they've practised becomes a
Change Drill with a notification; a step they haven't tried yet simply updates. Trainers see how many people joined,
never anyone's answers. Logic: `src/logic/team.ts` (tested); service: `infra/coach-lambda/`.

## Quiz me anywhere: the coach MCP server and the voice screen

More → **Quiz me from other apps** copies your confirmed steps (and how solid each one is) to FirstDay's coach
service, which runs a **remote MCP server** (spec 2025-11-25, Streamable HTTP; `infra/coach-lambda/mcp.mjs`) with
read-only tools `list_trainings`, `quiz_me`, `check_answer`, `what_changed`, `find_step`, `trainer_questions` and a
`shift_warmup` prompt. Every answer is checked against the trainer's key words, and feedback always quotes them.

- **Voice screen** (`public/voice.html`, hosted at `/voice.html`): an Alexa-style, hands-free practice screen for a
  tablet or laptop before your shift. Tap and say "Quiz me before my shift", "What changed?" or "What do I do when…".
  It's an MCP client of the same server. Simulated, not an Amazon product.
- **Any AI assistant** that supports remote MCP servers: make a key in the app, then for example
  `claude mcp add --transport http firstday-coach <url>/mcp --header "Authorization: Bearer <key>"`.

Keys are shown once, stored only as a hash, and removable; turning the feature off deletes your steps and every key.

## Connect Bee without a computer (preview)

Deployed (preview, your account only). Settings → **Connect Bee**: agree to the terms, approve Bee's link, done, with no
helper on a computer. FirstDay's Bee service runs Bee's official CLI in AWS Lambda for your account only
(allow-listed). It keeps your Bee sign-in encrypted with a key that stays on your phone, and Disconnect deletes it.
Details, safety and the deploy command: [infra/README.md](infra/README.md#connect-bee-without-a-computer-preview).
The computer helper above stays the way for everyone else.

## Web version on AWS (for testing on a phone without Expo Go)

The same screens run as a mobile web app, hosted in AWS account 237320501162 (stack `firstday-go-web`,
template `infra/web-hosting.yaml`): one S3 bucket with website hosting and a CloudFront distribution.
Both are pay per use only: no monthly fee, just the few hundred KB stored and the traffic served.

- **https://d1ypavau8ae868.cloudfront.net**: the secure link. Capture, sorting, to-dos, practice,
  Ask, memories, account sign-in and smarter reading (Amazon Bedrock) all work. It can't link to Bee,
  because an https page isn't allowed to call the brain's plain-http address on your Wi-Fi.
- **http://firstday-go-web-237320501162.s3-website-us-east-1.amazonaws.com**: the link for Bee.
  On the same Wi-Fi as your computer, start the brain (`npm run brain`), then in Settings → Brain
  enter the address and pairing code it prints. The brain only answers web pages from this address
  (change or add addresses with `FIRSTDAY_WEB_ORIGINS`, comma-separated).

The build also serves the voice coach at `/voice.html`. To rebuild and upload (picks up the coach service's URL
if it's deployed): `bash expo-go-app/infra/deploy-web.sh` from AWS CloudShell in a clone of the repo.

Data stays in the phone's browser storage, separately for each link. Reminders only fire while the page is open.
To remove the hosting, empty the bucket and run
`aws cloudformation delete-stack --region us-east-1 --stack-name firstday-go-web`.

## Smarter reading with Amazon Bedrock

Captures, Ask answers, "Make it tiny" steps and typed practice answers can be read by **Amazon Bedrock (Nova Pro)**:

1. through the brain on your computer, if it has a Bedrock key, or
2. through FirstDay's **AWS endpoint** when you're signed in: a Lambda Function URL that checks your Amazon Cognito
   token and calls Bedrock. Pay-per-request: nothing runs or bills while nobody uses it. See [infra/](infra/template.yaml).

Otherwise, everything is read on the phone with simple rules, offline. On new workplaces Bedrock finds 85% of stated steps
vs 63–67% on the phone, at similar precision ([results](../README.md#how-accurate-it-is)).

## Run it from a Windows PC (PowerShell)

1. Install [Node.js 22+](https://nodejs.org) and, on the iPhone, **Expo Go** from the App Store.
   The PC and iPhone must be on the same Wi-Fi.
2. Start the app server:
   ```powershell
   cd FirstDay\expo-go-app
   npm install
   npx expo install --fix   # matches package versions to your Expo Go
   npx expo start           # scan the QR code with the iPhone camera
   ```
   If the phone can't connect, use `npm run tunnel`.
3. (For real Bee data) in a second PowerShell window:
   ```powershell
   bee status                 # the Bee CLI must be installed and signed in
   cd FirstDay\expo-go-app
   npm run brain
   ```
   Allow Node through Windows Firewall on **Private networks** when asked. The brain prints an address
   and a 6-digit code: on the phone open **Settings → Brain**, type both. Then **+ → From my Bee**, or wait for
   "Just recorded by Bee" on Today.

Same steps on macOS/Linux with `/` paths. Without the brain the app still works on the phone; only Bee data needs it.

## Tests and checks

```bash
npm test             # 65 logic tests: extraction, Change Drill, team updates, questions, Today, grading, spaced review, Bee sync merge, wrist reminders
npm run test:node    # 39 integration tests: the brain against a stand-in Bee CLI (real reply shapes, every write-back),
                     #   the Bee service, and the coach service with its MCP server (protocol, tools, errors, keys)
npm run typecheck
npm run eval         # extractor accuracy on the development and held-out sets (fails on any vague-line leak)
npm run eval:bedrock # the same sets through Amazon Bedrock, using your AWS CLI credentials
npm run check        # all of the above except Bedrock
```

CI (`.github/workflows/firstday-go.yml`; the source is `ci/firstday-go.yml`) runs tests, typecheck, the eval gate,
syntax checks for the brain and the Lambdas, a web and iOS bundle export, and `cfn-lint` on the AWS templates.

**Real Bee evidence.** With the Bee CLI signed in, `npm run bee:evidence` writes `docs/BEE_LIVE.md`: how many
conversations, lines, facts, to-dos and insights Bee returned and what FirstDay found in them, with counts only (no
words). `npm run eval:export -- <id> --consent "…"` adds a consented recording to the eval (`eval/real/README.md`).

## Judge testing

- **Start:** the app opens on a landing page. Create an account (email + 6-digit code) or sign in; a new account starts empty.
- **No Bee device needed to look around:** Train → **Try a sample training** for three fictional packs (library, art
  studio, bookshop), or capture/paste a conversation. Train → Start runs a practice; finish a pack to unlock its Change Drill.
- **Team update:** on a second account (or the web version), share a training, join it with the code on the other,
  practise, then add a changed step on the trainer's side and **Send my changes to the team**.
- **Quiz me anywhere:** More → Quiz me from other apps → make a voice screen link and open it on a laptop.
- **Smarter reading:** signed in, captures are read by Bedrock. Settings → **Check it works**.
- **Real Bee data:** needs the brain on a computer signed in to the Bee CLI (steps above). The demo video shows this path.

## Accounts

You sign in before using the app; each account keeps its own data on the phone. Email + password accounts through Amazon Cognito: confirm your email once with a 6-digit code, reset a forgotten password
with a code, sign out, delete your account. The IDs are built in. Details: [AUTH-SETUP.md](AUTH-SETUP.md).

## Brain settings

`brain/server.mjs` is zero-dependency Node 22+ and runs on Windows, macOS or Linux. It reads `.env` from `brain/`,
`expo-go-app/` or the repo root:

| Setting | What it turns on |
| --- | --- |
| `BEE_CLI_PATH` (default `bee`) | Your Bee data through the signed-in Bee CLI |
| `FIRSTDAY_BEE_LIVE=0` | Turns off live watching (`bee stream`) |
| `FIRSTDAY_BEE_PROXY_PORT` (default 8791) | Windows only: free-text write-back goes through `bee proxy` on this port |
| `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID` | Bedrock on the brain (otherwise the app uses the AWS endpoint when signed in) |
| `FIRSTDAY_GO_PORT`, `FIRSTDAY_GO_CODE` | Port (default 8790) and a fixed pairing code |
| `FIRSTDAY_GO_COGNITO_POOL_ID`, `FIRSTDAY_GO_COGNITO_CLIENT_ID`, `FIRSTDAY_GO_REQUIRE_ACCOUNT` | Optionally accept only signed-in users |

Bee credentials never leave your computer; the phone only holds the pairing code. Five wrong codes lock that
address out for 15 minutes, and your account token is only sent to a brain that requires accounts.
The brain keeps a small state file (`brain/.brain-state.json`, git-ignored) with seen conversation IDs and your confirmed rules.

## What's inside

Today, Train and Questions are about the next shift. The Bee-style helpers live under **More**:

| Bee feature | FirstDay Go, built for ADHD (in More) |
| --- | --- |
| Conversation capture | Big **+** button: talk (keyboard mic), type, paste, or pull from Bee; live "Just recorded" card on Today |
| Summaries | Never more than 3 bullets. Bee's daily summary and insights in More |
| Suggested to-dos | Bee's suggestions and FirstDay's, sorted one card at a time: Now / Later / No thanks |
| Reminders | Gentle local notifications ("tomorrow at 3" is understood) |
| To-do list | Only **Now / Later / Done**, synced with Bee. Warns when Now has more than 3 |
| — | **Just this one** focus screen: 2–25 min timer, **Make it tiny** steps |
| Memories (facts) | Confirm, fix or forget, synced with Bee facts. Grouped by You / People / Work |
| Chat with your AI | **Ask**: answers cite the conversation, to-do or memory they came from |
| Daily recap | **Evening review**: a 2-minute check of today with the quotes visible, and undo |

What FirstDay adds that Bee doesn't have:

- **Work steps from conversations.** Trainer instructions are found automatically, and you confirm each one against the exact quote.
- **Role-play practice.** A line-drawn customer says the situation (it can be read aloud); you answer with choices or in your own words.
- **Every piece of feedback quotes the trainer.**
- **Check what I understood.** Compare your own words with the source before practising. It isn't scored.
- **Change Drill.** When a rule is updated you see old vs. new, and the old answer becomes a trap choice.
- **Questions for your trainer.** Vague lines ("maybe allow another day") become questions in their own tab, not rules.
- **Team trainings.** A trainer shares a training with a code; their changes reach every trainee as a Change Drill.
- **Spaced review.** Cards come back after 1, 3, 7 and 14 days.
- **Coach from any agent.** The `firstday-coach` skill quizzes you on your confirmed rules on your computer; the coach
  MCP server and the voice screen do it from anywhere.

The ADHD design choices:

- One primary action per screen, at thumb height. One idea per welcome screen, always skippable.
- Today shows a single "next thing", plus at most 3 "no rush" items, and how ready you are for your next shift.
- **Patterns over time** (in More): mood across 4 weeks (a one-tap check-in in the evening review, or read from what you said), who you've been talking with more or less, themes that keep coming up, follow-through, Bee's own insights, and a written weekly look from Amazon Bedrock. Worked out on the phone (`src/logic/patterns.ts`, tested).
- 3-card sessions by default, with a segmented progress bar.
- Optional focus sprint and break prompt. **Park a thought** during practice.
- No colour: white screens, black for what is selected or next, grey for the rest. Key words in bold on a grey band.
- Read-aloud, bigger text and haptics settings.
- Kind, retry-without-penalty feedback. No streaks to lose.
- Leave any time: progress resumes.

## Limits (honest)

- **No all-day background recording.** An iPhone app in Expo Go can't do it. That's what the Bee wearable is for.
- **Live Bee needs the brain running** on a computer on the same network; the phone checks it every 45 seconds while open.
- **No native speech recognition in Expo Go.** Dictation uses the keyboard's mic button.
- **No Apple Watch.** Expo Go doesn't support it.
- **On-phone reading uses simple rules.** It's precise but misses about a third of steps in new workplaces; sign in or connect the brain for Bedrock.
- **Team updates arrive when the app is open** (on open and every 5 minutes); there's no server push to a closed app in Expo Go.
- **Team trainings and Quiz me anywhere use the coach service** (deployed with `infra/deploy-coach.sh`; its URL is
  `DEFAULT_URL` in `src/coachCloud.ts`, or `EXPO_PUBLIC_FIRSTDAY_COACH_URL`). With no URL set, those buttons stay hidden.

## Files

- `app/`: screens (expo-router). Tabs: Today, Train, Questions, More; the center **+** opens Capture. `welcome.tsx` is the
  first run, `join.tsx` joins a team, `coach-link.tsx` sets up Quiz me anywhere.
- `src/logic/`: pure TypeScript (extraction, analysis, dates, grading, spaced review, search, Bee sync merge, team
  updates, questions, what Today shows). No React.
- `src/ui/`: the UI kit (`kit.tsx` cards, pill headers, buttons and progress bars; `icons.tsx` line icons; `faces.tsx` role-play cast).
- `src/store.tsx`: app state (saved on the device), AI routing, Bee write-back, live polling, team updates.
- `src/brain.ts`, `src/cloud.ts`, `src/auth.ts`, `src/coachCloud.ts`: the brain client, the AWS AI endpoint, Amazon
  Cognito accounts, the coach service (teams, keys).
- `brain/`: the computer-side helper: `server.mjs` (HTTP), `bee.mjs` (Bee CLI), `ai.mjs` (Bedrock prompts, shared with
  Lambda), `coach.mjs` (coach logic, shared with the MCP server), `cognito.mjs` (token check), `state.mjs`,
  `firstday.mjs` (coach CLI). Tests in `brain/test/`.
- `skills/firstday-coach/`: the Agent Skill.
- `infra/`: AWS: the AI endpoint (`template.yaml`), Connect Bee (`bee-connect.yaml`, `bee-lambda/`), the coach service
  (`coach.yaml`, `coach-lambda/`), web hosting (`web-hosting.yaml`) and their deploy scripts.
- `public/voice.html`: the voice coach screen (copied into the web build).
- `eval/`: labelled transcripts, scorer and runners (results in the [root README](../README.md#how-accurate-it-is)); `eval/real/` for consented Bee recordings.
- `scripts/`: `bee-evidence.mts` (writes docs/BEE_LIVE.md) and `eval-export.mjs`.

Sample trainings (library, art studio, bookshop) and the sample chat are fictional and come from `../fixtures/transcripts`.
