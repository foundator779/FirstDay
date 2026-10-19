# Demo video plan (under 3 minutes)

> **Use [demo-script.md](demo-script.md) to record.** It replaces this plan with the real Apple Watch + Bee loop,
> recorded as a clean iPhone screen recording. This page stays for reference.

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
5. For the team beat: Rosa's own FirstDay account (the web link on a second phone or a laptop) with the café training
   shared (**Share with my team**, with "Rosa" typed as the trainer when you saved it), and your phone joined with the code. The coach service is deployed and
   its URL is built in (rerun `infra/deploy-coach.sh` and `infra/deploy-web.sh` after any code change).
6. For the voice beat: More → **Quiz me from other apps** → **Make a voice screen link**, opened on a laptop or tablet
   with the microphone allowed. Say "Quiz me before my shift" once to check it hears you.

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
| 0:00–0:12 | You, first day at a job (or a title card). Then Today: "Get ready for day one." | "Your first week at a new job is a firehose. With ADHD, remembering twenty little procedures is the hard part. Bee already hears your trainer." |
| 0:12–0:30 | Terminal: `bee conversations list` shows "First shift at Juniper Café". Phone: **+ → From my Bee** → that conversation → tick "I'm OK with FirstDay Go reading this" → **Use this conversation**. | "This is my real Bee recording from yesterday. Nothing is read until I OK it." |
| 0:30–0:48 | **Check 3 work steps**: each step beside Rosa's exact words → **Yes, that's what was said** ×3. Then the **Questions** tab: the "maybe refunds on Sundays" line. | "Amazon Bedrock finds every instruction, next to Rosa's exact words. The 'maybe' became a question to ask her, never a rule." |
| 0:48–1:05 | **Train** → Start. A line-drawn customer: "I'd like to return this cracked mug." Wrong answer → feedback quotes Rosa → retry → right. | "Practice is a role-play. Wrong answers just show what Rosa said. No scores, no streaks." |
| 1:05–1:15 | More → **Sort**: "Your shift ends at 4 on Fridays" → keep. Cut to the **Bee app**: the fact is there. | "And it's two-way: what I keep here goes back to my Bee." |
| 1:15–1:50 | Record Conversation 2 with Rosa (cut the wait). Today: **Just recorded by Bee** + notification → **Bring it in** → OK → **Check 1 work step** → Juniper Café → **Yes**. **See what changed**: old vs. new; the old answer ("grey bin") is now a trap. | "Rosa just changed a rule. As soon as Bee finishes, FirstDay knows. The old answer becomes a trap, so the habit actually updates." |
| 1:50–2:10 | Rosa's screen: the training ("4 people joined"), **Send my changes to the team**. Cut to a trainee's phone: "Rosa changed 1 step in Juniper Café" → Change Drill. | "When Rosa trains a whole team, she shares the training with a code. Her change reaches every new hire as the same drill." |
| 2:10–2:45 | Laptop or tablet: the voice coach. "Quiz me before my shift." It reads a situation; you answer out loud; "Yes, that's it. Rosa said: …". Optional 3-second cut: an AI assistant listing the FirstDay coach tools (label it as a third-party app). | "Before my shift, I can rehearse out loud. It runs on FirstDay's MCP server, so any assistant can quiz me, always in Rosa's words." |
| 2:45–2:58 | Today: one next thing, "Ready for your shift." | "One thing at a time. FirstDay Go." |

## Tips

- Cut the Bee processing wait with a jump cut; don't speed up the UI itself.
- If the notification is slow, show Today refreshing instead (it checks every 45 seconds while open).
- Don't show your email, the pairing code, a coach key or voice link, or any real conversation other than the fictional script.
- If you show another company's app (the Bee app, an AI assistant), say it's theirs; you don't need to blur it.
- Upload to YouTube or Vimeo as **Public** (the rules require it to be publicly visible), and paste the link into Devpost.
