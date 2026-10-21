# How accurate FirstDay Go is, and where it fails

FirstDay Go turns a training conversation into work steps you'll practise. A wrong step is worse than a missing one,
because you'd practise the wrong thing, so we measure both, and whether vague talk ("maybe", "I think") wrongly
becomes a rule. This page has the method, the numbers from three fresh runs on October 19, 2026, and every kind of
mistake we found.

## The short version

| Reader | Held-out set (10 new workplaces, 27 steps) | Precision | Recall | Vague lines made into rules | Quotes word for word |
|---|---|---|---|---|---|
| Amazon Bedrock, Nova Pro: 3 runs pooled | 81 expected steps, 75 found | **94.7%** (71 of 75) | **87.7%** (71 of 81) | **0 of 12** | 100% |
| Amazon Bedrock, Nova Pro: range of the 3 runs | | 91.7–96.2% | 81.5–92.6% | 0 in every run | 100% |
| On-phone rules (offline, deterministic) | 27 expected steps | 94.4% (17 of 18) | 63.0% (17 of 27) | 1 of 4 | 100% |

- **Bedrock's answers vary from run to run,** so one run can mislead: on the same 10 transcripts, recall was 92.6%,
  81.5% and 88.9%. We report all three and the pooled figure. (The README once said 85.2% from a single earlier run,
  which is inside this range.)
- **The real Bee recording** (the café training in the demo) gave 3 of 3 steps, 1 question for the trainer and 1 to-do,
  both with Bedrock and with the on-phone rules. That's one recording, so it shows the path works on real Bee data;
  it isn't an accuracy figure.

## Method

**The data.** 25 fictional training transcripts, written by us, in the style of a trainer talking to a new hire (with
names, filler, small talk and a "maybe" or two):

- a **development set** of 15 workplaces (38 steps): the on-phone rules were tuned on these;
- a **held-out set** of 10 new workplaces (27 steps, 4 vague lines): written after tuning and never used to tune
  anything. These are the numbers that count.

Each case lists the steps a careful listener would take away, as key words (for example `refill, back, tap`), the
vague lines that must not become rules, and the questions a vague line should turn into. Files:
[`expo-go-app/eval/corpus.json`](../expo-go-app/eval/corpus.json) and
[`heldout.json`](../expo-go-app/eval/heldout.json).

**Scoring** ([`eval/score.mjs`](../expo-go-app/eval/score.mjs)):

- A predicted step **matches** an expected one when at least 75% of the expected key words appear in its situation
  plus action (numbers and number words count as equal; each predicted step can match only once).
- **Precision** = matched ÷ predicted steps. **Recall** = matched ÷ expected steps.
- **Vague lines made into rules:** a key word from a vague line appears in any predicted step.
- **Quotes word for word:** the step's quote appears in the transcript exactly (ignoring the speaker's name).

**Bedrock runs** use exactly the app's prompt, tool schema and Converse settings (`brain/ai.mjs`), with Amazon Nova
Pro (`us.amazon.nova-pro-v1:0`) in us-east-1, called from AWS CloudShell. Each run reads all 25 transcripts once.
Cost and speed: about 1,114 input and 230 output tokens per capture, 2.9–3.1 seconds.

## Every kind of mistake we saw

From the three Bedrock runs on the held-out and development sets, and the on-phone rules on the held-out set. Each
one is a real output, scored as shown.

| Kind of mistake | Example (transcript → what it gave) | Why it matters |
|---|---|---|
| **Half of a two-part rule** | "If a guest wants a late checkout, it's free until 1 pm; after that it's 20 dollars." → *"Charge $20 if after 1 pm."* The "free until 1 pm" half is gone. Scored as a miss and an extra step. | You'd practise charging, and might charge someone at 12:30. |
| **A key word paraphrased away** | "Small dogs and big dogs play in separate rooms." → *"Separate small and big dogs."* (no "rooms"). | Close, but the detail that makes it a procedure is lost. |
| **The change itself lost in an update** | "Starting today, we hold each customer reservation for seven calendar days, counting the day we set it aside as day one." → *"Hold the reservation for seven days."* | "Calendar" was the point of the change. A Change Drill built on this would miss it. |
| **A hand-off read as a step** | "Me: What if they argue? Dev: Then get me." → *"Customer argues about roof rack → Get Dev."* Not one of the expected steps, so it counts as wrong. | Mostly harmless, but it's practice nobody asked for. |
| **Steps said as facts, with no "when" or "if"** | "Tours start every hour on the hour." (missed in all three runs), "Close up at 10 sharp.", "Watering happens at 7 and at 3, every day.", "Every repair gets a paper tag with the customer's name and phone number." → missed by Bedrock in some or all runs, and often by the on-phone rules. | Schedules and standing rules sound like facts, not instructions, so readers skip them. |
| **Small talk made into a rule** (on-phone rules only) | "You should come watch with us next time." → *"During your shift: You should come watch with us next time."* | The one vague line the on-phone rules let through on the held-out set. Bedrock made none into rules in three runs. |

The on-phone rules miss mostly sentences without a condition word ("Watering happens at 7 and at 3", "Spilled
popcorn gets swept before the next show"), which is why signed-in captures are read by Bedrock.

## What the app does about it

The numbers above are why nothing becomes a step on its own:

- **Every step shows the trainer's exact words** next to it, and you confirm each one ("Yes, that's what was said"),
  fix it, or mark it "Not a rule". A half rule or a lost "calendar" is visible right there against the quote.
- **A vague line becomes a question** for the trainer, never a rule.
- **A trainer's change reaches the team only when the trainer sends it,** after checking it the same way.
- **Signed-in captures use Bedrock;** the on-phone rules are the offline fallback.

## Limits

- The transcripts are fictional and written by us. Real speech is messier, though the one real Bee recording came
  out cleanly.
- 25 transcripts and 65 steps is a small set. A few steps move recall by several points, as the three runs show.
- Matching on key words can be strict or generous. In run 2, "Sweep before next show" was a correct step scored as a
  miss ("swept" vs. "sweep"); a step with the right words in the wrong order would still match. We didn't tune the
  scorer after seeing results.
- English only.

## Rerun it

In `expo-go-app/`:

```bash
npm run eval                                       # on-phone rules, no network
node eval/run-bedrock.mjs --details                # Bedrock, with your AWS CLI credentials (e.g. in CloudShell)
```

`--details` prints every miss, extra step and vague line made into a rule, as in the table above. Every miss from the
three runs, as printed, is in [`expo-go-app/eval/results/2026-10-19-bedrock.md`](../expo-go-app/eval/results/2026-10-19-bedrock.md).
