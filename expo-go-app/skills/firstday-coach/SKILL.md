---
name: firstday-coach
description: Quiz the user on the work procedures they confirmed in FirstDay Go (from real Bee training conversations), explain what changed when a trainer updated a rule, and answer "what do I do when…" questions using only the trainer's exact words. Use when the user wants to practise, review or check a work procedure, asks what changed in their training, or just had a training conversation recorded by Bee. Composes with the bee-cli skill for recent conversations.
---

# FirstDay coach

FirstDay Go turns a trainer's spoken instructions (recorded by Bee) into work rules the user has
**confirmed against the exact quote**. This skill lets you coach them on those rules from any agent.

## Where the rules come from

Run commands from the FirstDay repository root. The rules live on the user's computer in
`expo-go-app/brain/.brain-state.json`, written by the FirstDay Go brain when the phone syncs.

```bash
node expo-go-app/brain/firstday.mjs rules --json           # every confirmed rule with the trainer's quote
node expo-go-app/brain/firstday.mjs quiz --count 3 --json  # 3 rules to quiz, shakiest first
node expo-go-app/brain/firstday.mjs check --id <id from quiz> --answer "what they said" --json   # pass / old way / feedback
node expo-go-app/brain/firstday.mjs changed --json         # rules the trainer changed: before -> now
node expo-go-app/brain/firstday.mjs find "damaged book" --json
node expo-go-app/brain/firstday.mjs questions --json       # vague things to ask the trainer
```

Add `--pack <words>` to limit to one training (for example `--pack bookshop`).

## How to coach (the user may have ADHD: keep it short)

1. **One question at a time.** Read the `situation` and ask "What do you do?". Wait for the answer.
2. **Check it.** Run `check` with the rule's `id` and their answer: it applies the same key-word check as the
   app (paraphrase is fine) and returns `feedback` that quotes the trainer. Or compare with `answer` yourself:
   every step, number and order in the answer must be there.
3. **Always quote the trainer** in feedback: `Dana said: "…"`. Never add steps that aren't in the quote.
4. **Changed rules:** if `oldAnswerNowWrong` is present and the user gives the old way, say it changed:
   "That was the old way. Now: …".
5. **Kind and brief.** One sentence of feedback, then the next question. Offer to stop after 3.
6. **Never invent policy.** If nothing matches (`find` returns no matches) or the rule is listed under
   `questions`, say you don't know and suggest asking the trainer.

## With the Bee skill

If the user says a training just happened, use the `bee-cli` skill (`bee now`) to see the recent
conversation, then suggest opening FirstDay Go (**+ → From my Bee**) to confirm the new steps before
quizzing. Rules only reach this skill after the user confirms them in the app.

## Not on the user's computer? Use the MCP server

The same coach runs as a remote MCP server (spec 2025-11-25, Streamable HTTP) with tools `list_trainings`,
`quiz_me`, `check_answer`, `what_changed`, `find_step` and `trainer_questions`, plus a `shift_warmup` prompt.
The user turns it on in FirstDay Go (**More → Quiz me from other apps → Make a key for an AI assistant**),
which gives the URL and a key to send as `Authorization: Bearer <key>`. Same rules as above apply.

## Privacy

Read-only. Don't copy the rules anywhere else. Sample trainings are marked `"sample": true`
(fictional); say so if you quiz on them.
