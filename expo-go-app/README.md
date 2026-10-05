# FirstDay Go

**Bee track entry for Build, Ship, Shape: Amazon Developer Hackathon.**

A calm, hand-drawn iPhone app for ADHD brains. It turns your Bee conversations into one next step at a time,
and turns a trainer's spoken instructions into role-play practice, so you can rehearse your next shift before it happens.
It covers the core of the Bee app (capture, summaries, to-dos, reminders, memories, chat) and adds FirstDay's work training.

It runs in **Expo Go** on an iPhone, served from a Windows, Mac or Linux computer: no Xcode, no custom build.

## How real Bee data gets in, and goes back

```
Bee wearable ─▶ Bee cloud ─▶ Bee CLI on your computer ─▶ brain/server.mjs ─▶ FirstDay Go on iPhone
 (records)      (processes)   (conversations, facts,       (watches Bee live;     (practice, to-dos,
                               to-dos, daily, insights)     pairing code)          memories)
                                         ▲                                              │
                                         └────── your fixes, kept to-dos, done ◀────────┘
```

- **Conversations.** `bee conversations list/get --json`; only Bee's final processed transcript, exact text, Bee's reported order.
  Nothing is read until you confirm everyone in the recording agreed.
- **Live.** The brain runs `bee stream --json`. When a conversation finishes processing, Today shows
  "Just recorded by Bee" and you get a notification: one tap turns a training into practice while it's fresh.
- **Two-way sync.** Bee facts become memories (confirm, fix or forget them here and it reaches Bee), Bee to-dos and
  to-do suggestions land in your lists (keeping or finishing one here does the same in Bee), and Bee's daily summary and
  insights appear on Today. Settings → Bee has **Sync with Bee now** and a **Send my changes to Bee** switch.
- **Coach skill.** Confirmed work rules are shared with the brain, so any agent with the
  [`firstday-coach` Agent Skill](skills/firstday-coach/SKILL.md) can quiz you on them (it composes with the `bee-cli` skill).

## Smarter reading with Amazon Bedrock

Captures, Ask answers, "Make it tiny" steps and typed practice answers can be read by **Amazon Bedrock (Nova Pro)**:

1. through the brain on your computer, if it has a Bedrock key, or
2. through FirstDay's **AWS endpoint** when you're signed in: a Lambda Function URL that checks your Amazon Cognito
   token and calls Bedrock. Pay-per-request: nothing runs or bills while nobody uses it. See [infra/](infra/template.yaml).

Otherwise, everything is read on the phone with simple rules, offline. On new workplaces Bedrock finds 85% of stated steps
vs 63–67% on the phone, at similar precision ([eval/RESULTS.md](eval/RESULTS.md)).

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

Same steps on macOS/Linux with `/` paths. Without the brain the app still works on the phone with built-in samples.

## Tests and checks

```bash
npm test             # 32 logic tests: extraction, Change Drill, grading, spaced review, capture, Ask, Bee sync merge
npm run typecheck
npm run eval         # extractor accuracy on the development and held-out sets (fails on any vague-line leak)
npm run eval:bedrock # the same sets through Amazon Bedrock, using your AWS CLI credentials
```

CI (`.github/workflows/firstday-go.yml`) runs tests, typecheck, the eval gate, an iOS bundle export,
syntax checks for the brain and Lambda, and `cfn-lint` on the AWS template.

## Judge testing

- **No Bee device needed to look around:** after the 3-screen welcome, the app has three fictional sample trainings
  (library, art studio, bookshop) and a sample chat. Train → Start runs a practice; finish a pack to unlock its Change Drill.
- **Smarter reading:** Settings → Account → create an account (email + 6-digit code). Then Settings → **Check it works**.
- **Real Bee data:** needs the brain on a computer signed in to the Bee CLI (steps above). The demo video shows this path.

## Accounts (optional)

Email + password accounts through Amazon Cognito: confirm your email once with a 6-digit code, reset a forgotten password
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

| Bee feature | FirstDay Go, built for ADHD |
| --- | --- |
| Conversation capture | Big **+** button: talk (keyboard mic), type, paste, or pull from Bee; live "Just recorded" card |
| Summaries | Never more than 3 bullets. Bee's daily summary and insights on Today |
| Suggested to-dos | Bee's suggestions and FirstDay's, sorted one card at a time: Now / Later / No thanks |
| Reminders | Gentle local notifications ("tomorrow at 3" is understood) |
| To-do list | Only **Now / Later / Done**, synced with Bee. Warns when Now has more than 3 |
| — | **Just this one** focus screen: 2–25 min timer, **Make it tiny** steps |
| Memories (facts) | Confirm, fix or forget, synced with Bee facts. Grouped by You / People / Work |
| Chat with your AI | **Ask**: answers cite the conversation, to-do or memory they came from |
| Daily recap | **Evening review**: a 2-minute check of today with the quotes visible, and undo |

What FirstDay adds that Bee doesn't have:

- **Work steps from conversations.** Trainer instructions are found automatically, and you confirm each one against the exact quote.
- **Role-play practice.** A doodle customer says the situation (it can be read aloud); you answer with choices or in your own words.
- **Every piece of feedback quotes the trainer.**
- **Check what I understood.** Compare your own words with the source before practising. It isn't scored.
- **Change Drill.** When a rule is updated you see old vs. new, and the old answer becomes a trap choice.
- **Ask your trainer.** Vague lines ("maybe allow another day") become questions, not rules.
- **Spaced review.** Cards come back after 1, 3, 7 and 14 days.
- **Coach from any agent.** The `firstday-coach` skill quizzes you on your confirmed rules.

The ADHD design choices:

- One primary action per screen, at thumb height. One idea per welcome screen, always skippable.
- Today shows a single "next thing", plus at most 3 "no rush" items.
- 3-card sessions by default, with progress dots.
- Optional focus sprint and break prompt. **Park a thought** during practice.
- Key words swiped in highlighter; one highlighter colour, everything else pencil.
- Read-aloud, bigger text and haptics settings.
- Kind, retry-without-penalty feedback. No streaks to lose.
- Leave any time: progress resumes.

## Limits (honest)

- **No all-day background recording.** An iPhone app in Expo Go can't do it. That's what the Bee wearable is for.
- **Live Bee needs the brain running** on a computer on the same network; the phone checks it every 45 seconds while open.
- **No native speech recognition in Expo Go.** Dictation uses the keyboard's mic button.
- **No Apple Watch.** Expo Go doesn't support it.
- **On-phone reading uses simple rules.** It's precise but misses about a third of steps in new workplaces; sign in or connect the brain for Bedrock.

## Files

- `app/`: screens (expo-router). Tabs: Today, Do, Ask, Train. Center **+** opens Capture. `welcome.tsx` is the first run.
- `src/logic/`: pure TypeScript (extraction, analysis, dates, grading, spaced review, search, Bee sync merge). No React.
- `src/ui/`: the hand-drawn kit (`kit.tsx` sketch frames, `icons.tsx` doodle icons, `faces.tsx` role-play cast).
- `src/store.tsx`: app state (saved on the device), AI routing, Bee write-back and live polling.
- `src/brain.ts`, `src/cloud.ts`, `src/auth.ts`: the brain client, the AWS endpoint, Amazon Cognito accounts.
- `brain/`: the computer-side helper: `server.mjs` (HTTP), `bee.mjs` (Bee CLI), `ai.mjs` (Bedrock prompts, shared with Lambda),
  `cognito.mjs` (token check), `state.mjs`, `firstday.mjs` (coach CLI).
- `skills/firstday-coach/`: the Agent Skill.
- `infra/`: the AWS endpoint (CloudFormation template, Lambda handler, `deploy.sh`).
- `eval/`: labelled transcripts, scorer, runners and [RESULTS.md](eval/RESULTS.md).

Sample trainings (library, art studio, bookshop) and the sample chat are fictional and come from `../fixtures/transcripts`.
