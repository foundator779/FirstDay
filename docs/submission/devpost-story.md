# Devpost submission text

Copy each section into the matching Devpost field. Anything in `[EDIT: …]` needs your own words or a link.

---

## Project name

FirstDay Go

## Elevator pitch (under 200 characters)

Your first week at a new job, remembered for you. Bee hears your trainer; FirstDay Go turns it into calm, one-step-at-a-time practice for ADHD brains.

## Built with

`bee-cli` · `agent-skills` · `amazon-bedrock` · `amazon-nova` · `aws-lambda` · `amazon-cognito` · `aws-cloudformation` · `aws-cloudshell` · `expo` · `react-native` · `typescript` · `node.js`

## Try it out

- Code: https://github.com/foundator779/FirstDay
- Demo video: [EDIT: YouTube or Vimeo URL]

---

## About the project

### Inspiration

The first week at a new job is a firehose. A trainer explains twenty small procedures in an hour ("damaged returns go in the grey bin, scan them first, then tell Sam"), and you're expected to just remember. For people with ADHD, working memory is exactly the thing that gives out, and the cost isn't a missed to-do: it's looking incompetent in week one.

Bee already hears that conversation. We wanted to do something with it beyond a summary: turn the trainer's own words into practice you can do on the bus, so the first time you meet "a customer returns a damaged book" isn't the real time.

### What it does

FirstDay Go is an iPhone app (it runs in Expo Go) with a hand-drawn, colourless look and one rule: **show one next thing**.

**Everything the Bee app does, built for ADHD:**
- Capture by talking, typing, pasting, or straight from Bee. Summaries are never longer than three bullets.
- To-dos are only Now, Later or Done, sorted one card at a time. "Make it tiny" breaks a scary task into 2-minute steps, and a focus screen hides everything else.
- Gentle reminders understand "tomorrow at 3".
- Memories (Bee facts) you can confirm, fix or forget. Ask answers questions and shows which conversation or memory each answer came from.
- A 2-minute evening review shows every item next to the exact line it came from, with undo.

**What FirstDay adds:**
- **Work steps from real conversations.** When Bee records a training, FirstDay Go finds each instruction and shows it beside the trainer's exact quote. You confirm it before it becomes practice.
- **Role-play practice.** A doodle customer describes a situation (read aloud if you like). Answer with choices or in your own words; feedback always quotes the trainer. No scores, no streaks to lose.
- **Ask your trainer.** Vague lines like "maybe give them another day" become questions to ask, never rules.
- **Change Drill.** When the trainer later changes a rule, you see old vs. new, and the old answer becomes a trap choice so the habit actually updates.
- **Spaced review** brings each step back after 1, 3, 7 and 14 days.

### How Bee data powers it

A small helper (`brain/server.mjs`) runs on your Windows, Mac or Linux computer next to the signed-in **Bee CLI**:

- **Live:** it watches `bee stream --json`. When a conversation finishes processing, the phone shows "Just recorded by Bee" and sends a notification. One tap, a consent check ("everyone in this recording agreed"), and the training becomes practice while it's fresh.
- **Two-way sync:** Bee **facts** become memories, Bee **to-dos and suggestions** land in your lists, and Bee's **daily summary and insights** appear on Today. Confirming, fixing or forgetting a memory, keeping a suggestion or finishing a to-do in FirstDay Go does the same in Bee (`facts confirm/update/create/delete`, `todos create/complete/accept-suggestion/dismiss-suggestion`).
- **Agent Skill:** confirmed rules are shared with the `firstday-coach` Agent Skill, so any agent can quiz you ("What do you do when a customer returns a damaged book?") using only the trainer's words. It composes with Bee's own `bee-cli` skill.

Bee credentials never leave the computer; the phone only holds a 6-digit pairing code.

### How we built it

- **App:** Expo SDK 57 + expo-router + TypeScript, only modules that run in Expo Go, so it can be tested from a Windows PC without Xcode. A tiny hand-drawn UI kit draws every frame and icon as a slightly wobbly SVG path; one highlighter yellow, everything else pencil. Atkinson Hyperlegible for reading, Patrick Hand for the doodle feel.
- **Smarter reading on AWS, pay-per-use:** signed-in users' captures go to a **Lambda Function URL** that verifies the **Amazon Cognito** access token and calls **Amazon Bedrock (Nova Pro)** through the Converse API with a forced tool call, so the output is structured. No API Gateway, no servers, nothing stored; one **CloudFormation** template, deployed from **CloudShell**. A capture costs about $0.0016.
- **Accounts:** Cognito (Lite tier) with email + password, a one-time 6-digit email code, password reset by code, and account deletion.
- **Works offline:** with no account and no network, a rule-based extractor on the phone still finds to-dos, memories and work steps.
- **Measured, not guessed:** 25 labelled fictional transcripts in two sets. On workplaces it was never tuned on, Bedrock finds 85% of stated steps at 96% precision; the on-phone rules find 63–67% at 94%. On that set Bedrock turned no vague or chatty line into a rule. CI fails if a vague development-set line ever becomes a rule.

### Challenges we ran into

- Bee's real timing fields didn't match our assumptions (small `start`/`end` values, wall-clock `spoken_at`, ties). We now keep Bee's exact order and never invent durations.
- Structured output from Bedrock was always valid JSON, but once dropped a number from the action. Valid shape isn't faithful content, so every step keeps its source quote and the user confirms it.
- On Windows, npm CLIs are `.cmd` shims that Node won't spawn without a shell. Writing user text back to Bee safely meant using `bee proxy` over local HTTP instead.
- Expo Go has no speech recognition, so dictation uses the keyboard's mic.
- All of it is in our friction log (`docs/friction-log.md`).

### Accomplishments that we're proud of

- The full loop with real Bee data: record a training, get a notification, confirm the steps against the trainer's words, practise, and see your fixes appear back in Bee. [EDIT: keep this line only once you've run it end to end with your Bee.]
- An honest eval with a held-out set, and an AWS endpoint that costs nothing when nobody's using it.
- An interface that asks for one decision at a time.

### What we learned

- For ADHD users, the win isn't more features; it's fewer decisions per screen.
- Source quotes are the trust layer. People accept a suggested step when they can see exactly where it came from.
- Bee's facts, to-dos and insights are a real two-way surface, not just a feed.

### What's next

- Purpose-recorded trainings with real employers (with consent), and a manager view to send rule updates.
- Push from Bee straight to the phone (no computer helper), if Bee offers it.
- A TestFlight build with Apple Watch prompts for "practise one step" moments.

[EDIT: optional, one line about you and why this matters to you.]
