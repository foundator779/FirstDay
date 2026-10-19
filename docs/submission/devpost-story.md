# Devpost submission text

Copy each section into the matching Devpost field. Anything in `[EDIT: …]` needs your own words or a link.

---

## Project name

FirstDay Go

## Elevator pitch (under 200 characters)

Starting a job? With your trainer's OK, Bee hears them and FirstDay Go turns their exact words into calm practice for your next shift. Built for ADHD brains.

## Built with

`bee-cli` · `agent-skills` · `model-context-protocol` · `amazon-bedrock` · `amazon-nova` · `aws-lambda` · `amazon-dynamodb` · `amazon-cognito` · `aws-cloudformation` · `amazon-s3` · `amazon-cloudfront` · `aws-cloudshell` · `expo` · `react-native` · `typescript` · `node.js`

## Try it out

- App (no install): https://d1ypavau8ae868.cloudfront.net → **Create account** (free; email code)
- Code: https://github.com/foundator779/FirstDay
- Demo video: [EDIT: YouTube or Vimeo URL]

---

## About the project

### Inspiration

The first week at a new job is a firehose. A trainer explains twenty small procedures in an hour ("damaged returns go in the grey bin, scan them first, then tell Sam"), and you're expected to just remember. For people with ADHD, working memory is exactly the thing that gives out, and the cost isn't a missed to-do: it's looking incompetent in week one.

Bee already hears that conversation. We wanted to do something with it beyond a summary: turn the trainer's own words into practice you can do on the bus, so the first time you meet "a customer returns a damaged book" isn't the real time.

FirstDay Go is for **the person starting the job**. You don't need your employer to buy anything: you wear your own Bee
(on an Apple Watch or the wearable), ask your trainer if it's OK, and the app is yours, with your data on your phone.
Trainers can join in later, and that's how it spreads: one new hire uses it, the trainer shares their training with the
next ones.

**Why it matters.** First days come around a lot, and they're hardest for the people FirstDay Go is built for:
- 15.5 million U.S. adults have a current ADHD diagnosis ([CDC, 2024](https://www.cdc.gov/mmwr/volumes/73/wr/mm7340a1.htm)).
- Adults with ADHD do worse on *verbal*, not visual, long-term memory ([Skodzik et al., 2017](https://journals.sagepub.com/doi/10.1177/1087054713510561)). Spoken training is the weak channel; steps you see and practise aren't.
- ADHD is linked to 35 days of lost work performance a year ([Kessler et al., 2005](https://hcp.hms.harvard.edu/publication/prevalence-and-effects-adult-attention-deficithyperactivity-disorder-work-performance)), and only 52% of adults with ADHD were employed vs. 72% without ([Biederman et al., 2006](https://scholars.mssm.edu/en/publications/functional-impairments-in-adults-with-self-reports-of-diagnosed-a-2/)).
- Food-service workers quit at 4.2% a month, twice the all-jobs rate, so new first days come constantly ([BLS JOLTS, 2025](https://www.bls.gov/news.release/jolts.t22.htm)). Each replacement costs an employer about $5,475 to hire ([SHRM, 2025](https://www.shrm.org/about/press-room/shrm-releases-2025-benchmarking-reports--how-does-your-organizat)).

### What it does

FirstDay Go is an iPhone app (it runs in Expo Go, and on the web) for the person starting a job, with a clean, colourless look and one job: **get you ready for your next shift**, one next thing at a time.

- **Work steps from real conversations.** Wear your Bee while your trainer shows you around (with their OK). FirstDay Go finds each instruction and shows it beside the trainer's exact quote. You confirm it before it becomes practice.
- **Role-play practice.** A line-drawn customer describes a situation (read aloud if you like). Answer with choices or in your own words; feedback always quotes the trainer. No scores, no streaks to lose.
- **Change Drill.** When the trainer later changes a rule, you see old vs. new, and the old answer becomes a trap choice, so the habit actually updates.
- **On your wrist.** Before a shift, FirstDay Go writes a Bee to-do ("Practise Juniper Café before your shift: 3 steps") with Bee's own alarm, so it rings in the Bee app and on your Apple Watch. It's checked off in Bee once you've practised. When your trainer changes a step, a Bee to-do rings a minute later.
- **Your trainer can join in (team trainings).** A trainer or job coach shares a training with a 6-character code. Each person who types the code asks to join; the trainer sees their verified email and name and taps **Let in** (or Decline, or later Remove), so a forwarded code gets a stranger nothing. For a practice or open team, the trainer can turn on **Let anyone with the code in**: people join right away, and the trainer still sees who joined and can remove anyone. When the trainer records a change and sends it, everyone who practised the old way gets a Change Drill and a notification; a step they haven't tried yet just updates. Trainers see who's on the team, never anyone's answers.
- **Questions for your trainer.** Vague lines like "maybe give them another day" get their own tab: things to ask before your shift, never rules.
- **Quiz me anywhere.** Your confirmed steps power a remote **MCP server** (spec 2025-11-25). An Alexa-style **voice screen** on a tablet quizzes you hands-free ("Quiz me before my shift", "What changed?"), and any AI assistant that speaks MCP can too, always in your trainer's words.
- **Spaced review** brings each step back after 1, 3, 7 and 14 days.

**Also in More, built on Bee's data:** capture by talking, typing or pasting; to-dos that are only Now, Later or Done (with "Make it tiny" steps and a focus screen); memories you can confirm, fix or forget; Ask, with sources; a 2-minute evening review; patterns over time. All of it syncs both ways with Bee, and none of it competes with the next shift on Today.

### How Bee data powers it

A small helper (`brain/server.mjs`) runs on your Windows, Mac or Linux computer next to the signed-in **Bee CLI**:

- **Live:** it watches `bee stream --json`. When a conversation finishes processing, the phone shows "Just recorded by Bee" and sends a notification. One tap, your OK ("I'm OK with FirstDay Go reading this conversation"), and the training becomes practice while it's fresh.
- **Two-way sync:** Bee **facts** become memories, Bee **to-dos and suggestions** land in your lists, and Bee's **daily summary and insights** appear on Today. Confirming, fixing or forgetting a memory, keeping a suggestion or finishing a to-do in FirstDay Go does the same in Bee (`facts confirm/update/create/delete`, `todos create/complete/accept-suggestion/dismiss-suggestion`).
- **Agent Skill:** confirmed rules are shared with the `firstday-coach` Agent Skill, so any agent can quiz you ("What do you do when a customer returns a damaged book?") using only the trainer's words. It composes with Bee's own `bee-cli` skill.

Bee credentials never leave the computer; the phone only holds a 6-digit pairing code.

**No computer needed (preview):** "Connect Bee without a computer" runs the same Bee CLI inside AWS Lambda for your account, after you approve FirstDay in Bee. Your Bee sign-in is sealed with a key that only your phone holds. New recordings show up on Today as "Just recorded by Bee"; one tap ("Yes, read it") is the OK to read it.

**Your trainer's words stay on your phone.** Every conversation you bring in is kept word for word on the phone only (More → Conversations, and "Where this came from" on each training). Amazon Bedrock reads it to find the steps and keeps nothing.

### How we built it

- **App:** Expo SDK 57 + expo-router + TypeScript, only modules that run in Expo Go, so it can be tested from a Windows PC without Xcode. A small UI kit in black, white and grey. Atkinson Hyperlegible throughout, chosen for readability. Tabs: Today, Train, Questions, More.
- **Smarter reading on AWS, pay-per-use:** signed-in users' captures go to a **Lambda Function URL** that verifies the **Amazon Cognito** access token and calls **Amazon Bedrock (Nova Pro)** through the Converse API with a forced tool call, so the output is structured. Nothing stored. One **CloudFormation** template, deployed from **CloudShell**. A capture costs about $0.0016.
- **Coach service:** a second Lambda Function URL and one on-demand **DynamoDB** table hold team trainings (versioned with conditional writes, with join requests the trainer approves; the email shown comes from a verified Cognito ID token) and, only when a user turns it on, their confirmed steps for the **MCP server**: Streamable HTTP, six read-only tools (`quiz_me`, `check_answer`, `what_changed`, `find_step`, …) with input and output schemas, a `shift_warmup` prompt, Origin checks and per-app keys stored as hashes. The voice screen is a plain web page using the browser's speech recognition and speech synthesis as an MCP client.
- **Accounts:** Cognito (Lite tier) with email + password, a one-time 6-digit email code, password reset by code, and account deletion.
- **Works offline after sign-in:** a rule-based extractor on the phone still finds work steps, questions, to-dos and memories. Each account starts empty and keeps its data on the phone.
- **Measured, not guessed:** 25 labelled fictional transcripts in two sets. On workplaces it was never tuned on, Bedrock finds 85% of stated steps at 96% precision; the on-phone rules find 63–67% at 94%. Bedrock turned no vague or chatty line on that set into a rule. Consented real Bee recordings can be added as a third set (`npm run eval:export`).
- **Tested end to end:** 65 logic tests and 39 integration tests run in CI on every push: the brain's real HTTP server against a stand-in Bee CLI that returns the real reply shapes (every write-back checked down to the exact CLI arguments), the Bee service, and the coach service with its MCP server.

### Challenges we ran into

- Bee's real timing fields didn't match our assumptions (small `start`/`end` values, wall-clock `spoken_at`, ties). We now keep Bee's exact order and never invent durations.
- The CLI's `--json` replies aren't documented. Our new importer expected a bare conversation, but the real reply wraps it in `{ conversation }`, so every real conversation failed. A test built on the real shape caught it; now it can't come back.
- Structured output from Bedrock was always valid JSON, but once dropped a number from the action. Valid shape isn't faithful content, so every step keeps its source quote and the user confirms it.
- On Windows, npm CLIs are `.cmd` shims that Node won't spawn without a shell. Writing user text back to Bee safely meant using `bee proxy` over local HTTP instead.
- Expo Go has no speech recognition, so dictation uses the keyboard's mic.
- All of it is in our friction log (`docs/friction-log.md`).

### Accomplishments that we're proud of

- The full loop with real Bee data: record a training, get a notification, confirm the steps against the trainer's words, practise, and see your fixes appear back in Bee. [EDIT: keep this line only once you've run it end to end with your Bee.]
- A trainer's change reaching every trainee as a Change Drill, with nothing about anyone's answers leaving their phone.
- An MCP server that any assistant, or a voice screen, can use to rehearse a shift in the trainer's own words.
- An honest eval with a held-out set, and AWS services that cost nothing when nobody's using them.
- An interface that asks for one decision at a time.

### What we learned

- For ADHD users, the win isn't more features; it's fewer decisions per screen.
- Source quotes are the trust layer. People accept a suggested step when they can see exactly where it came from.
- Bee's facts, to-dos and insights are a real two-way surface, not just a feed.

### What's next

- Purpose-recorded trainings with real employers and job coaches (with consent), starting with team trainings.
- Push from Bee straight to the phone (no computer helper), if Bee offers it, and Connect Bee for everyone once Bee confirms server-side use is allowed.
- A TestFlight build, and "practise one step" prompts on the Apple Watch beyond Bee's reminders.

[EDIT: optional, one line about you and why this matters to you.]
