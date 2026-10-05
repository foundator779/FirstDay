# Submission package: FirstDay Go (Bee track)

Everything Devpost asks for, ready to paste. Deadline: **Friday, October 23, 2026, 12:00 pm Pacific**.
Items marked `[EDIT: …]` in these files need your own words or links.

| Devpost asks for | Where it is | Status |
| --- | --- | --- |
| Project name, elevator pitch, story, built-with tags | [devpost-story.md](devpost-story.md) | Ready; fill the `[EDIT]` lines |
| Primary track | Bee (Wearable AI) | Ready |
| Mini challenges | Optional. "AWS Builder" costs nothing extra; the AWS answer is in the product feedback | Your call |
| Code repository URL | https://github.com/foundator779/FirstDay | Check it's public with the license, or shared (below) |
| Demo video (under 3 min, public on YouTube or Vimeo, shows real Bee data) | [video-script.md](video-script.md) | You record it |
| Product feedback for each tool | [product-feedback.md](product-feedback.md) | Ready; add your Bee onboarding experience |
| Testing instructions | [testing-instructions.md](testing-instructions.md) | Ready |
| Feature requests (optional) | [feature-requests.md](feature-requests.md) | Ready |
| Friction log (optional, up to 10% bonus) | [../friction-log.md](../friction-log.md) | Ready: 10 entries |
| Architecture (for the story or images) | [architecture.md](architecture.md) | Ready (renders on GitHub) |
| Accuracy evidence | [../../expo-go-app/eval/RESULTS.md](../../expo-go-app/eval/RESULTS.md) | Ready |

## Before you submit

- [ ] Run the app on your iPhone (Expo Go) and walk through [testing-instructions.md](testing-instructions.md) sections 2–4.
- [ ] Sign in once and tap Settings → **Check it works** (confirms the AWS endpoint with a real Cognito token).
- [ ] With the brain connected, **Sync with Bee now**; keep a suggestion and fix a memory, then confirm both show in the Bee app.
- [ ] Record two fictional trainings with your Bee ([video-script.md](video-script.md)), then the video. Keep it under 3:00.
- [ ] Fill the `[EDIT]` lines, especially your own Bee onboarding experience in the product feedback.
- [ ] Remove any line from the story that your test didn't confirm.

## Repository

The rules require either a **public repo with an open-source license visible in GitHub's About section**
(the repo has an MIT `LICENSE`), or a **private repo shared with testing@devpost.com and the GitHub users**
chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar.

The Bee track also requires the repo to show Bee used **at runtime in code**: point judges to
`expo-go-app/brain/bee.mjs` (every Bee CLI call), `expo-go-app/brain/server.mjs` (the routes the app calls) and
`expo-go-app/src/store.tsx` (sync, write-back and live polling in the app).

## "New or significantly updated"

FirstDay was started during the submission period (first commit September 24, 2026; the period opened August 31),
and FirstDay Go was built on top of it in October. If Devpost asks what changed during the period, the answer is: all of it.
FirstDay Go adds the Expo Go app, live Bee watching, two-way Bee sync, the coach Agent Skill, the AWS endpoint and the eval.

## AWS resources this created (account 237320501162, us-east-1)

| Resource | Cost when idle |
| --- | --- |
| CloudFormation stack `firstday-go-ai` (Lambda `firstday-go-ai`, its Function URL, IAM role, log group) | $0 |
| Cognito user pool `firstday-go-users` (Lite tier) | $0 up to 10,000 monthly active users |

To remove the AI endpoint after judging: `aws cloudformation delete-stack --region us-east-1 --stack-name firstday-go-ai`.
