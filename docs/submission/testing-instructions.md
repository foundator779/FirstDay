# Testing instructions for judges

FirstDay Go is free to test. Tap **Create account** on the landing page: any email you can read, a password, then
read and accept the terms of use (scroll to the end) and type the 6-digit code from the email. There are no shared
or back-door accounts: every account is a real Amazon Cognito account with a verified email. To test team trainings
you need two accounts (for example a Gmail address and the same address with `+rosa` before the `@`, which arrives in
the same inbox).

## 1. Open the app (1 minute, no install)

On an iPhone, open **https://d1ypavau8ae868.cloudfront.net** in Safari (Share → Add to Home Screen for a full-screen app).
It's the same app as the Expo Go build, hosted on AWS (S3 + CloudFront, pay per use).

Or run it in **Expo Go** (about 5 minutes): a computer with Node.js 22+, an iPhone with Expo Go, both on the same Wi-Fi.

```bash
git clone https://github.com/foundator779/FirstDay.git
cd FirstDay/expo-go-app
npm install
npx expo install --fix   # aligns package versions with the Expo Go on your phone
npx expo start           # scan the QR code with the iPhone camera
```

If the phone can't reach the computer (office Wi-Fi often blocks it), run `npx expo start --tunnel` instead.

## 2. Try it without a Bee (3 minutes)

1. Create an account (above), read the three welcome screens, then **Train** → **Try a sample training**: three
   fictional sample trainings appear.
2. **Train** → **Library welcome desk** → **Start**: practise every step once, then come back to Today. Its trainer
   "changed" a rule, and the **Change Drill** shows old vs. new, with the old answer as a trap choice.
3. Tap **Capture** → **Paste a transcript**, paste the text below, tap **Find the steps**, then **Check work steps**.
   Each step sits next to the trainer's exact words; the "maybe" line becomes a question for the trainer instead of a rule.
   ```
   Rosa: When a customer brings back a cracked mug, check the receipt first, then put the mug in the grey bin.
   If someone orders oat milk, write OAT on the lid in capitals.
   Before closing, wipe the steam wand and run it for three seconds.
   Maybe we'll start giving refunds on Sundays too.
   Oh, and can you restock the paper cups by noon tomorrow? My shift ends at four on Fridays.
   ```
4. Back on **Today**, the next thing is to practise. The "maybe" line is waiting in the **Questions** tab (badge), to ask the trainer.
5. **Train** → your new training → **Start**: a short role-play round. Try a wrong answer: feedback quotes the trainer, with no penalty.
6. **More** holds the everyday helpers built on Bee: **To-dos** (a to-do → **Make it tiny**, the focus timer), **Ask**
   ("When does my shift end?" answers show their source), **Sort new things**, **Evening review** and **Your patterns**.

## 2b. A trainer's change reaches the team (two accounts, about 5 minutes)

Use two browsers or devices (for example a laptop and a phone, or a normal and a private window), signed in to two
different accounts: one is the trainer (Rosa), the other the new hire.

1. **Trainer:** paste the Rosa transcript above (Capture → **Paste a transcript**), check the steps, name the training
   "Juniper Café" and type **Rosa** under "Who taught you?". Then **Train** → **Juniper Café** → **Share with my team**.
   Note the 6-character code.
2. **New hire:** Train → **Join my team's training** → type the code and a name → **Ask to join**. The screen says
   "Waiting for Rosa to let you in". Nothing about the steps arrives yet.
3. **Trainer:** the training (or Today: "1 person wants to join Juniper Café") shows the request with the new hire's
   verified email and name → **Let in**. **Decline** and, later, **Remove** work the same way.
4. **New hire:** tap **Check now** (or wait: the app checks on open and every 5 minutes). Juniper Café arrives with
   every step in Rosa's exact words. Practise them once.
5. **Trainer:** Capture → Paste a transcript:
   ```
   Rosa: From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink, not the grey bin.
   ```
   → **Check 1 work step** → choose **Juniper Café** → **Yes, that's what was said** → **Send to my team now**.
6. **New hire:** open the app (or the training → **Check for changes**). Today shows "Rosa changed 1 step in Juniper
   Café" with a notification → **See what changed**: old vs. new, and the old answer ("grey bin") is now a trap choice.

## 2c. Quiz me anywhere (2 minutes)

1. More → **Quiz me from other apps** → turn on **Let other apps quiz me** → **Make a voice screen link** → send it to yourself.
2. Open the link on a laptop in Chrome, Edge or Safari. Tap the circle and say "Quiz me before my shift" (or type it).
   Answer out loud; feedback quotes the trainer. Try "What changed?".
3. Or **Make a key for an AI assistant** and add the MCP server to one, for example Claude Code:
   `claude mcp add --transport http firstday-coach <url>/mcp --header "Authorization: Bearer <key>"`, then ask it to quiz you.
   MCP Inspector works too (Streamable HTTP, same URL and header).

## 3. Smarter reading with Amazon Bedrock (1 minute)

Signed in, captures are read by Amazon Bedrock. Settings → **Check it works**: it should say Amazon Bedrock answered,
and new captures show "read by Bedrock (cloud)". Settings → Account → **Delete my account** removes the account.

## 4. Real Bee data (needs a Bee and the Bee CLI)

On the computer, with the Bee CLI installed and signed in (`bee status`):

```bash
cd FirstDay/expo-go-app
npm run brain        # prints an address and a 6-digit code
```

On the phone: Settings → **Brain** → type both → **Connect**. (The video uses the no-computer route instead:
Settings → **Connect Bee without a computer (preview)**, where FirstDay's Bee service runs the Bee CLI in AWS Lambda.
It's open only to the owner's account while we wait for Bee's OK on running the CLI server-side.) Then:
- **+ → From my Bee** lists your processed conversations; pick one, tick "I'm OK with FirstDay Go reading this conversation", and it's read.
  A new one also appears on Today as **Just recorded by Bee**: **Yes, read it** reads it in one tap.
- **More → Conversations** keeps every conversation you brought in, word for word, on the phone only, grouped by training.
  Each training also lists **Where this came from**.
- Leave the app open and record a new conversation: when Bee finishes processing it, Today shows **Just recorded by Bee**.
- Settings → **Bee** → **Sync with Bee now** brings in your Bee facts (as memories), to-dos, suggestions, daily summary and insights.
  Confirm or fix a memory, keep a suggestion, or finish a to-do, then check the Bee app: the change is there.

## 5. Automated checks (no phone needed)

```bash
cd FirstDay/expo-go-app
npm install
npm test            # 65 logic tests
npm run test:node   # 39 integration tests: brain + stand-in Bee CLI, Bee service, coach service (join approval) and MCP server
npm run typecheck
npm run eval        # extractor accuracy, development and held-out sets
```

The same checks run in CI on every push (badge on the README). Results and method: the README's "How accurate it is" section.
The AWS services: `expo-go-app/infra/README.md`. The coach Agent Skill: `expo-go-app/skills/firstday-coach/SKILL.md`
(try `node brain/firstday.mjs quiz` after confirming some steps with the brain connected).
