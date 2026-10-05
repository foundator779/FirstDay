# Extractor accuracy

FirstDay Go turns a training conversation into work steps you practise. A wrong step is worse than a missing one (you'd practise the wrong thing), so the eval measures both, plus whether vague talk ("maybe", "I think") wrongly becomes a rule instead of a question for the trainer.

## The data

- `corpus.json`: development set, 15 fictional training transcripts across 15 workplaces (38 stated steps, 6 vague lines, 2 rule changes, plus small-talk-only transcripts). The on-phone extractor was tuned on this set.
- `heldout.json`: held-out set, 10 transcripts in new workplaces (27 steps, 4 vague lines, 1 small-talk transcript), written **after** tuning.

A predicted step counts as correct when it covers at least 75% of the expected step's key words (situation and action together), one prediction per expected step. Quotes must be copied word for word from the transcript.

## Results (October 4, 2026)

| Extractor | Set | Precision | Recall | F1 | Vague lines turned into rules | Vague lines turned into questions | Changes flagged | Quotes verbatim |
|---|---|---|---|---|---|---|---|---|
| On-phone rules (no AI, no network) | Development (tuned on) | 100% | 92.1% | 95.9 | 0 | 6/6 | 2/2 | 100% |
| On-phone rules | Held-out, first run | 94.7% | 66.7% | 78.3 | 1 | 4/4 | n/a | 100% |
| On-phone rules | Held-out, current | 94.4% | 63.0% | 75.6 | 1 | 4/4 | n/a | 100% |
| Amazon Bedrock, Nova Pro (the AWS endpoint's prompt) | Development | 92.1% | 92.1% | 92.1 | 1 | 5/6 | 2/2 | 100% |
| Amazon Bedrock, Nova Pro | Held-out | 95.8% | 85.2% | 90.2 | 0 | 3/4 | n/a | 100% |

What this says, plainly:

- **The on-phone extractor is precise but misses things it hasn't seen.** On new workplaces it still rarely invents a wrong step (94% precision), but it finds only about two in three steps. That's why every step is shown with its quote and has to be confirmed before it becomes practice.
- **Bedrock generalises much better** (85% vs 63–67% recall on the held-out set) at similar precision. That's the case for signing in: captures are read by Bedrock through the AWS endpoint, and the app falls back to on-phone rules when offline or signed out.
- The "current" on-phone held-out row is lower than the first run because a later fix (stopping "can't go on the ice" from being read as a placement rule) was prompted by a held-out failure. The first-run row is the honest held-out number; the current row is no longer strictly held out.
- The Bedrock prompt was not tuned on either set. Its one development-set leak (hotel check-in) and its misses (dog daycare, bike shop, garden center, museum guide, laundromat) are listed per case when you run the eval.

## Cost and speed of one capture (Bedrock)

Across the 25 transcripts: about **1,114 input and 225 output tokens, 2.7 seconds** per capture. At Nova Pro's list price when it launched ($0.80 per million input tokens, $3.20 per million output tokens) that is about **$0.0016 per capture**, plus about $0.00001 of Lambda time. Check the current Amazon Bedrock pricing page before relying on these prices. Nothing runs or bills while nobody uses the app: no servers, no API Gateway, no provisioned capacity.

## Run it yourself

```bash
cd expo-go-app
npm run eval                      # on-phone extractor, both sets, no network (CI runs this)
node eval/run-bedrock.mjs         # Bedrock directly, with your AWS CLI credentials (e.g. in AWS CloudShell)
node eval/run-ai.mjs --url <AWS endpoint> --token <Cognito access token>   # the deployed endpoint, end to end
node eval/run-ai.mjs --url http://<computer-ip>:8790 --code <pairing code>  # the brain on your computer
```

`npm run eval` fails CI if any vague or chatty development-set line becomes a rule. The held-out set is reported, never gated, so it stays honest.
