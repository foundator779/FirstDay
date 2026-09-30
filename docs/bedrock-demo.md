# Bedrock demo

## Run FirstDay

The selected model is **Amazon Nova Pro**, `us.amazon.nova-pro-v1:0`, through
Bedrock Runtime Converse in `us-east-1`. The live fictional-library flow passed
extraction, practice generation, grading, and Change Drill on September 14, 2026.

```sh
npm run demo:bedrock
```

Open **http://localhost:8083**. The launcher starts the API on loopback port
3001 and Expo on 8083. It loads credentials from the ignored root `.env` only
for the API. The mobile process receives public connection settings and a local
demo session token; it never receives the AWS key or Bee bridge credential.

## Three-minute walkthrough

1. Choose **Library welcome desk**, review the transcript, and enable consent.
2. Confirm the three clear instructions against their exact source quotes.
   The tentative extension statement stays in **Ask your trainer**.
3. Start practice. Deliberately answer the ledger situation incorrectly, read
   the source-backed feedback, and retry in your own words.
4. Finish the three situations and open **My practice recap**. It shows what
   was covered and retried, without claiming workplace readiness.
5. Choose **Try a training update**, inspect the separate fictional transcript,
   and compare the earlier and updated instruction. Confirm it.
6. The earlier practice becomes stale. Complete one Change Drill using the
   orange ledger; the former blue-ledger answer is rejected.

This uses fictional data and real, billable AI calls. State lives in API memory
and is lost on API restart. The offline preview is available with
`npm run demo:synthetic` at port 8081 and checks the action wording conservatively.
Keep the page open during the walkthrough. Page reload recovery is not yet
implemented; restart the demo command to replay the same source from scratch.

## Configuration

```dotenv
FIRSTDAY_AI_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=<local credential>
BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0
```

`FIRSTDAY_DATA_MODE` selects source/auth mode separately. The demo uses only
fixture sources. The normal live configuration uses the authenticated local
Bee bridge and Supabase sessions. See [live setup](live-demo.md) for the
authenticated launcher and actual-source validation.

## Validation

- `npm test`: deterministic regression and mocked provider boundary tests.
- `npm run smoke:bedrock`: explicit real-model test with only checked-in fictional
  library conversations. Checks uncertainty, three generated situations, wrong
  policy, negation, grading-instruction injection, paraphrases, completion,
  changed-rule lineage, stale practice, and both-source Change Drill grading.
- Every extracted instruction requires review. Confidence is an uncalibrated
  placeholder (0.5), not a measured accuracy probability.
- Explicit uncertainty cues move the affected utterance to a private question.
  This is a conservative guard, not comprehensive language understanding.
- Excluded passages never enter extraction requests. Exact quotes, spans, IDs,
  source kinds and timestamps come from application-owned source records.
- Model outputs remain untrusted. Schemas and repository checks validate
  references, allocations, revisions, consent and result partitions.
- Change confirmation is atomic. It confirms the replacement, marks the old
  instruction changed, stales dependent practice and creates one drill.
  Revoking either source prevents subsequent grading of that drill.
- Requests time out after 45 seconds. Invalid output and provider failures
  return sanitized errors with no silent model or offline fallback.

## Remaining validation

Authenticated import/extraction/restoration of two actual Bee recordings,
dedicated local database integration and user-reported physical speech passed.
The complete real training/update journey, latest physical Release interaction
and full VoiceOver remain separate gates in `TASKS.md` and [live setup](live-demo.md).
See
[design validation](design-validation.md) for the next user test. No judging
score or user-research result is claimed.
