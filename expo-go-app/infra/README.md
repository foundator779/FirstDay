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
  a capture costs about $0.0016 in Bedrock tokens plus about $0.00001 of Lambda time ([eval/RESULTS.md](../eval/RESULTS.md)).
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
