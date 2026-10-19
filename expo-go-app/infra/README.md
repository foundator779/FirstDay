# FirstDay Go AI endpoint (AWS)

One Lambda function behind a Function URL. The app sends a capture (or a question, a task, a practice answer)
with the user's Amazon Cognito access token; the function checks the token and asks Amazon Bedrock (Nova Pro)
for structured output through a forced tool call. The prompts are the same file the brain uses (`brain/ai.mjs`).

```
FirstDay Go ──HTTPS + Cognito token──▶ Lambda Function URL ──IAM role──▶ Amazon Bedrock (Nova Pro)
                                        │ verifies RS256 token, issuer, client, expiry
                                        │ per-user soft limit (120/hour)
                                        └ logs errors only (never transcripts), kept 7 days
```

## Why this shape

- **Pay only when used.** No servers, no API Gateway, no provisioned concurrency, no database. Idle cost is zero;
  a capture costs about $0.0016 in Bedrock tokens plus about $0.00001 of Lambda time ([measured](../../README.md#how-accurate-it-is)).
- **Only signed-in users.** The Function URL is public, but every route except `GET /health` needs a valid access
  token from the FirstDay user pool. The function's IAM role can only invoke Amazon Nova models.
- **Nothing stored.** Captures pass through to Bedrock and back; they're never written anywhere on AWS.

## Deploy

From AWS CloudShell (or any shell with the AWS CLI signed in to the target account):

```bash
bash expo-go-app/infra/deploy.sh
```

It refuses to run in any account but the one set at the top of the script, creates or updates the CloudFormation
stack `firstday-go-ai` (us-east-1), uploads the code, and prints the URL and a health check. Point the app at a
different deployment with `EXPO_PUBLIC_FIRSTDAY_AI_URL` in `expo-go-app/.env`.

## Check it

```bash
curl -s <url>/health                          # {"ok":true,"ai":true}
curl -s -X POST <url>/analyze -d '{}'         # 401: sign-in required
node expo-go-app/eval/run-bedrock.mjs         # accuracy and tokens per capture, same prompt, your credentials
```

In the app: sign in, then Settings → **Check it works**.

## Remove it

```bash
aws cloudformation delete-stack --region us-east-1 --stack-name firstday-go-ai
```

---

# Connect Bee without a computer (preview)

A second, separate stack (`infra/bee-connect.yaml`, deployed with `infra/deploy-bee.sh`) lets a FirstDay
account connect its **own** Bee account with no helper on a computer. It runs **Bee's official CLI**
(`@beeai/cli`, the tool the Bee track requires) inside AWS Lambda, reusing the brain's Bee code (`brain/bee.mjs`),
so the app gets exactly the same Bee routes and answers as from the brain.

```
FirstDay app ──HTTPS + Cognito token + phone key──▶ Lambda (Bee CLI) ──▶ Bee
                                                     │ sealed Bee sign-in
                                                     ▼
                                       DynamoDB (on demand, 1 item per account)
```

**Connecting.** In the app: Settings → Connect Bee → read the terms → agree → Bee's approval link opens →
approve → connected. Under the hood: `bee login --no-wait` prints the link; a later check re-runs `bee login`
to finish, as Bee's docs describe.

**Safety.**
- Only allow-listed FirstDay accounts can use it (`ALLOWED_EMAIL` at deploy, checked against the signed-in account's verified email). `OPEN_TO_EVERYONE=true`
  opens it to all, which should wait for Bee's OK.
- Your consent is recorded (terms version and time) before anything connects. A change to the terms asks again.
- The CLI's sign-in folder is stored only as AES-256-GCM ciphertext. Its key comes from a 32-byte secret
  created on your phone and kept in its secure storage, then sent with each request. The service never stores it,
  so the saved sign-in is useless on its own (`bee-lambda/vault.mjs`). DynamoDB also encrypts at rest.
- **Disconnect** runs `bee logout` and deletes the item. Deleting your FirstDay account disconnects first.
  Unfinished sign-ins delete themselves after 15 minutes.
- No Bee content is logged; logs keep 7 days.

**Cost.** Lambda and on-demand DynamoDB only: nothing runs or bills while idle. It syncs while the app is
open (the app asks every 45 s for new conversations), so "Just recorded by Bee" arrives within about a minute.

**Deploy (when ready).** From AWS CloudShell in account 237320501162:

```bash
ALLOWED_EMAIL=you@example.com bash expo-go-app/infra/deploy-bee.sh
```

Deployed Oct 6, 2026: https://5dqpf6ocpwpvarrhdhcdnpxvle0hyybu.lambda-url.us-east-1.on.aws (built into the app;
override with `EXPO_PUBLIC_FIRSTDAY_BEE_URL`). Allowed: the owner's account only (set with `ALLOWED_EMAIL` at deploy). The npm package ships programs for every
system (~420 MB), so the deploy packs only the Linux x64 program (37 MB zipped). Bee CLI 0.7.3 keeps its sign-in as files
in `~/.bee` ("Keychain not available, using file-based token storage"), which is what the sealed save/restore relies on.
Remove: `aws cloudformation delete-stack --region us-east-1 --stack-name firstday-go-bee`.

**Tests.** `node --test "expo-go-app/infra/bee-lambda/test/*.test.mjs"` runs the whole service against a stand-in
Bee CLI. It covers the allow-list, consent, phone key, connecting, sync, the inbox, a wrong key, and disconnecting.

**Not yet known (check on first deploy).** Whether Bee's approval link works from inside Lambda the same
way as from a computer, how long a Bee sign-in lasts before you have to approve again, and the CLI's
package size.

---

# Coach service: team trainings and the coach MCP server

A third, separate stack (`infra/coach.yaml`, deployed with `infra/deploy-coach.sh`): one Lambda Function URL and one
on-demand DynamoDB table (`firstday-go-coach`). Code: `coach-lambda/` plus the shared coach logic in `brain/coach.mjs`.

```
Trainer's FirstDay ──share / send changes──▶                    ◀──join / check for changes── Trainees' FirstDay
                                           Lambda (coach) ◀──▶ DynamoDB (on demand)
Voice screen, AI assistants ──MCP 2025-11-25 (Streamable HTTP, per-app key)──▶ /mcp
```

**Team trainings.** `POST /teams` (share; returns a 6-character code), `PUT /teams/{code}` (trainer sends a new
version; the reply says what changed), `POST /teams/{code}/join` (asks to join), `GET /teams/{code}/people` and
`POST /teams/{code}/people/{id}/approve|decline|remove` (trainer only), `GET /teams/{code}` (members only),
`GET /me/teams` (versions, member and request counts in one call, so phones check cheaply), `POST /teams/{code}/leave`,
`DELETE /teams/{code}` (stop sharing). Writes are versioned with conditional puts. Trainers see who is on the team
(verified email and the name they gave), never anyone's answers. Join attempts
are rate-limited per account on each server instance; codes use a 31-character alphabet without look-alikes
(about 887 million codes).

**Coach MCP server** at `/mcp`: protocol `2025-11-25` (also answers `2025-06-18` and `2025-03-26` clients), JSON
responses (no SSE stream: GET answers 405), `MCP-Protocol-Version` checked, browser calls only from the app's own web
pages (Origin check), notifications answered with 202. Tools, all read-only with input and output schemas:
`list_trainings`, `quiz_me`, `check_answer`, `what_changed`, `find_step`, `trainer_questions`; prompt: `shift_warmup`.
Auth: `Authorization: Bearer <key>` with a key made in the app (only its SHA-256 hash is stored, up to 5 per account,
each removable), or a FirstDay Cognito access token. The user's steps are stored only after they turn on "Quiz me from
other apps"; turning it off deletes them and every key.

**Join approval.** Typing a code only asks to join: `POST /teams/<code>/join` carries the user's Cognito ID token
(checked like the access token: signature, issuer, app client, expiry, `email_verified`), so the trainer sees a
verified email plus the name the person typed. Until the trainer lets them in (`POST /teams/<code>/people/<id>/approve`),
they get the training's name only, never its steps. The trainer can also `decline` a request or `remove` a member;
`GET /teams/<code>/people` lists both. No shared or demo accounts exist: everyone signs up with their own email.

**Deploy.** From AWS CloudShell in account 237320501162:

```bash
bash expo-go-app/infra/deploy-coach.sh       # stack firstday-go-coach; prints the URL and a health check
bash expo-go-app/infra/deploy-web.sh         # rebuilds the web app with that URL and publishes /voice.html
```

Deployed Oct 8, 2026: https://xexduccr223pex3iuq4lqe5kfe0utyxs.lambda-url.us-east-1.on.aws (MCP server at `/mcp`;
built into the app as `DEFAULT_URL` in `src/coachCloud.ts`). For your own deployment, put its URL there (or in
`EXPO_PUBLIC_FIRSTDAY_COACH_URL` in `.env`); without one, the team and "Quiz me from other apps" buttons stay hidden.

**Check it.**

```bash
curl -s <url>health                                                    # {"ok":true,"coach":true,"mcp":"2025-11-25"}
curl -s -X POST <url>mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d '{}'              # 401 without a key
node --test "expo-go-app/infra/coach-lambda/test/*.test.mjs"           # teams and join approval, keys, MCP protocol and tools
```

**Cost.** Lambda and on-demand DynamoDB only; nothing bills while idle.
**Remove:** `aws cloudformation delete-stack --region us-east-1 --stack-name firstday-go-coach` (deletes the table too).

