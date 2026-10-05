# Demo video plan (under 3 minutes)

The rules require the video to show the project **using real Bee data** (mentioning Bee isn't enough), to run on the
intended platform (an iPhone), to stay under 3 minutes, and to have no copyrighted music or third-party trademarks.
This plan records the real loop once, live.

## Before you record

1. **Record two short training conversations with your Bee** (a friend plays the trainer; both of you agree to it).
   Use the fictional script below so nothing private ends up in the video. Record the first one the day before, so it's processed.
2. Start the brain on your computer (`npm run brain`), connect the phone (Settings → Brain), and run **Sync with Bee now** once.
   Sign in on the phone (Settings → Account) so captures are read by Amazon Bedrock, then tap **Check it works**.
   (We tested both scripts below with the on-phone reader too: three steps, one question, one to-do, one memory, and the update matches the cracked-mug step.)
3. Phone: Do Not Disturb off (so the "New from Bee" notification shows), Bigger text off, screen recording on
   (Control Center → Screen Recording). Computer: a terminal window with large font for the two shots of it.
4. Keep the second conversation (the rule change) for the live part of the video.

### Conversation 1: "First shift at Juniper Café" (fictional)

> **Rosa:** Welcome! A few things for today. When a customer brings back a cracked mug, check the receipt first, then put the mug in the grey bin.
> If someone orders oat milk, write OAT on the lid in capitals.
> Before closing, wipe the steam wand and run it for three seconds.
> Maybe we'll start giving refunds on Sundays too, I'm not sure yet.
> Oh, and can you restock the paper cups by noon tomorrow?
> **You:** Got it. My shift ends at four on Fridays.
> **Rosa:** That's right.

### Conversation 2: "Quick update from Rosa" (record live, during the video)

> **Rosa:** Quick update. From now on, when a customer brings back a cracked mug, check the receipt, then put it in the blue crate by the sink, not the grey bin.

## Shot list

| Time | On screen | Say (voiceover or to camera) |
| --- | --- | --- |
| 0:00–0:15 | You, first day at a job (or a title card). Then the FirstDay Go Today screen. | "Your first week at a new job is a firehose. If you have ADHD, remembering twenty little procedures is the hard part. Bee already hears your trainer. FirstDay Go turns what they said into practice." |
| 0:15–0:35 | Terminal: `bee conversations list` shows "First shift at Juniper Café". Phone: **+ → From my Bee** → that conversation → tick "Everyone agreed" → **Use this conversation**. | "This is my real Bee recording from yesterday. The helper on my computer reads it through the Bee CLI. Nothing is read until I confirm everyone agreed." |
| 0:35–0:55 | "Got it": to-dos, things to remember, work steps. **Check 3 work steps**: name the training "Juniper Café", then each step appears beside Rosa's exact words. The "maybe" line is a question, not a rule. **Yes, that's what was said** ×3. | "Amazon Bedrock finds every instruction, and each one sits next to Rosa's exact words, so I can trust it. The 'maybe' became a question to ask her, not a rule." |
| 0:55–1:20 | **Train** → Start. A doodle customer: "I'd like to return this cracked mug." Pick a wrong answer → feedback quotes Rosa → retry → right. | "Practice is a role-play. Wrong answers just show what Rosa actually said. No scores, no streaks to lose. Three cards and done." |
| 1:20–1:40 | **Sort**: "Restock the paper cups by noon tomorrow" → **Now**; "Your shift ends at 4 on Fridays" → keep. Then open the **Bee app** on the phone: the to-do and the fact are there. | "To-dos and memories sort one card at a time. And it's two-way: what I keep here shows up in my Bee." |
| 1:40–2:15 | Record Conversation 2 with Rosa (cut the wait). Keep FirstDay Go open: Today shows **Just recorded by Bee** and the notification appears. Tap **Bring it in** → tick "Everyone agreed" → **Check 1 work step** → choose the Juniper Café training → **Yes, that's what was said**. | "Rosa just changed a rule. As soon as Bee finishes processing, FirstDay Go knows, live." |
| 2:15–2:35 | **See what changed**: old vs. new side by side. Answer the drill; the old answer ("grey bin") is now a trap choice. | "The Change Drill shows old versus new, and the old answer becomes a trap, so the habit actually updates." |
| 2:35–2:50 | Terminal (or any agent chat): `node brain/firstday.mjs quiz --count 1` or ask your agent "Quiz me on my café training". | "My confirmed steps are also an Agent Skill, so any agent can quiz me, using only Rosa's words." |
| 2:50–2:58 | Today screen: one next thing. | "One thing at a time. FirstDay Go." |

## Tips

- Cut the Bee processing wait with a jump cut; don't speed up the UI itself.
- If the notification is slow, show Today refreshing instead (it checks every 45 seconds while open).
- Don't show your email, the pairing code, or any real conversation other than the fictional script.
- Upload to YouTube or Vimeo as **Public** (the rules require it to be publicly visible), and paste the link into Devpost.
