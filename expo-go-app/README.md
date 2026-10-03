# FirstDay Go

A calm, hand-drawn personal AI for ADHD brains. It does everything the Bee app does (capture, summaries, to-dos, reminders, memories, chat), and adds FirstDay's work training, so you can practise your next shift before it happens.

It runs in **Expo Go**: no Xcode, no custom build.

## Run it on your iPhone

```bash
cd expo-go-app
npm install
npx expo install --fix   # lines package versions up with your Expo Go
npx expo start           # scan the QR code with the iPhone camera
```

If your phone and computer are on different networks, use `npm run tunnel`.

The app works fully offline on the phone. Everything is stored on the device.

## Optional: the brain (smarter AI + your real Bee conversations)

```bash
node brain/server.mjs
```

The brain is zero-dependency Node 22+. It reads the repo's root `.env`:

| Setting | What it turns on |
| --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID` | Bedrock (Nova Pro by default): summaries, to-dos, memories, work rules, answers in Ask, paraphrase grading, "Make it tiny" |
| `BEE_CLI_PATH` (default `bee`) | Pulls your recorded Bee conversations through the signed-in Bee CLI |
| `FIRSTDAY_GO_PORT`, `FIRSTDAY_GO_CODE` | Port (default 8790) and a fixed pairing code |

It prints an address and a 6-digit code. In the app, go to **Settings → Brain** and enter both. Credentials never leave your computer; the phone only holds the pairing code.

## What's inside

| Bee feature | FirstDay Go, built for ADHD |
| --- | --- |
| Conversation capture | Big **+** button: talk (keyboard mic), type, paste, or pull from Bee |
| Summaries | Never more than 3 bullets. "Your day so far" on Today |
| Suggested to-dos | Sorted one card at a time (**Sort**): Now / Later / No thanks |
| Reminders | Gentle local notifications ("tomorrow at 3" is understood) |
| To-do list | Only **Now / Later / Done**. Warns when Now has more than 3 |
| — | **Just this one** focus screen: 2–25 min timer, **Make it tiny** steps |
| Memories / personalisation | Confirm, fix or forget. Grouped by You / People / Work |
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

The ADHD design choices:

- One primary action per screen, at thumb height.
- Today shows a single "next thing", plus at most 3 "no rush" items.
- 3-card sessions by default, with progress dots.
- Optional focus sprint and break prompt.
- **Park a thought** during practice.
- Key words swiped in highlighter.
- Read-aloud, bigger text and haptics settings.
- Kind, retry-without-penalty feedback.
- Leave any time: progress resumes.

## Limits (honest)

- **No all-day background recording.** An iPhone app in Expo Go can't do it. That's what the Bee wearable is for; pull its conversations in through the brain.
- **No native speech recognition in Expo Go.** Dictation uses the keyboard's 🎤 button, which works everywhere.
- **No Apple Watch.** Expo Go doesn't support it.
- **On-phone mode uses simple rules.** Without the brain, analysis looks for phrasings like "When/If…, do…", "I'll…", "Can you…" and "my … is…". Connect the brain for full AI.

## Files

- `app/`: screens (expo-router). Tabs: Today, Do, Ask, Train. Center **+** opens Capture.
- `src/logic/`: pure TypeScript (extraction, analysis, dates, grading, spaced review, search). No React.
- `src/ui/`: the hand-drawn kit (`kit.tsx` sketch frames, `icons.tsx` doodle icons, `faces.tsx` role-play cast).
- `src/store.tsx`: app state, saved to a JSON file on the device.
- `brain/server.mjs`: the optional computer-side helper.

Sample trainings (library, art studio, bookshop) and the sample chat are fictional and come from `../fixtures/transcripts`.
