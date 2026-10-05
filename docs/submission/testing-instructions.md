# Testing instructions for judges

FirstDay Go is free to test. No login is needed to try the app; an account is optional and free.

## 1. Run the app on an iPhone (about 5 minutes)

You need: a computer with Node.js 22+, an iPhone with **Expo Go** from the App Store, both on the same Wi-Fi.

```bash
git clone https://github.com/foundator779/FirstDay.git
cd FirstDay/expo-go-app
npm install
npx expo install --fix   # aligns package versions with the Expo Go on your phone
npx expo start           # scan the QR code with the iPhone camera
```

If the phone can't reach the computer (office Wi-Fi often blocks it), run `npx expo start --tunnel` instead.

## 2. Try it without a Bee (2–3 minutes)

1. Read the three welcome screens (or tap **Skip**).
2. **Today** shows one next thing. Tap it: you'll **sort** a few suggested to-dos and memories from the sample chat, one card at a time.
3. Tap the big **+** → **Paste a transcript**, paste the text below, tap **Find the steps**, then **Check work steps**.
   Each step sits next to the trainer's exact words; the "maybe" line becomes a question for the trainer instead of a rule.
   ```
   Rosa: When a customer brings back a cracked mug, check the receipt first, then put the mug in the grey bin.
   If someone orders oat milk, write OAT on the lid in capitals.
   Before closing, wipe the steam wand and run it for three seconds.
   Maybe we'll start giving refunds on Sundays too.
   ```
4. **Train** → pick a pack → **Start**: a short role-play round. Try a wrong answer: feedback quotes the trainer, with no penalty.
5. Practise every step in one sample pack (a few short rounds), then come back to Train: its trainer "changed" a rule, and the **Change Drill** shows old vs. new.
6. **Do** tab → a to-do → **Make it tiny**, and the focus timer. **Ask** tab → "When does my shift end?" (if you kept that memory while sorting; answers show their source).
7. The moon icon on Today opens the 2-minute **Evening review** (after 5 pm it's also Today's main card).

## 3. Smarter reading with Amazon Bedrock (optional, 2 minutes)

Settings → **Sign in or create an account** → create one with any email you can read (you'll get a 6-digit code).
Then Settings → **Check it works**: it should say Amazon Bedrock answered. New captures now show "read by Bedrock (cloud)".
You can delete the account in Settings → Account → **Delete my account**.

## 4. Real Bee data (needs a Bee and the Bee CLI)

On the computer, with the Bee CLI installed and signed in (`bee status`):

```bash
cd FirstDay/expo-go-app
npm run brain        # prints an address and a 6-digit code
```

On the phone: Settings → **Brain** → type both → **Connect**. Then:
- **+ → From my Bee** lists your processed conversations; pick one, confirm everyone agreed, and it's read.
- Leave the app open and record a new conversation: when Bee finishes processing it, Today shows **Just recorded by Bee**.
- Settings → **Bee** → **Sync with Bee now** brings in your Bee facts (as memories), to-dos, suggestions, daily summary and insights.
  Confirm or fix a memory, keep a suggestion, or finish a to-do, then check the Bee app: the change is there.

## 5. Automated checks (no phone needed)

```bash
cd FirstDay/expo-go-app
npm test            # 32 logic tests
npm run typecheck
npm run eval        # extractor accuracy, development and held-out sets
```

Results and method: `expo-go-app/eval/RESULTS.md`. The AI endpoint: `expo-go-app/infra/README.md`.
The coach Agent Skill: `expo-go-app/skills/firstday-coach/SKILL.md` (try `node brain/firstday.mjs quiz` after confirming some steps with the brain connected).
