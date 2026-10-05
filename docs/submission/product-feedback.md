# Product feedback

Devpost asks, for each tool, API or SDK: what we used it for, what worked well, what needs work, how onboarding went,
and whether we'd build with it again. Everything below is what we actually saw while building. Lines marked
`[EDIT: …]` are yours to fill in or confirm (your own first-time experience with the device, for example).

**Primary track:** Bee (Wearable AI).
**Mini challenges:** [EDIT: none, or "AWS Builder" if you want it considered; the AWS section below already answers its question.]

---

## Bee wearable and Bee CLI

**What we used it for.**
- `bee conversations list --json` / `get <id> --json`: the training conversations FirstDay Go turns into practice. We use only the final processed transcript, keep its exact text, and order it by Bee's reported time.
- `bee stream --json`: live updates. When a conversation finishes processing, the phone gets a "Just recorded by Bee" card and a notification.
- `bee facts list/confirm/update/create/delete`: two-way sync with FirstDay Go's memories.
- `bee todos list/create/complete`, `todos suggestions`, `accept-suggestion`, `dismiss-suggestion`: two-way sync with FirstDay Go's to-do lists.
- `bee daily list`, `bee insights list`: Bee's daily summary and insights on the Today screen.
- `bee proxy`: on Windows, free-text writes (fact and to-do text) go through the local HTTP proxy as JSON.
- Agent Skills: our `firstday-coach` skill is designed to sit next to Bee's `bee-cli` skill (`bee now` for the latest conversation).

**What worked well.**
- `--json` on every command made the CLI a clean integration surface; we didn't need to scrape anything.
- Read and write commands mirror each other (list / confirm / update / delete), so two-way sync was a small amount of code.
- Facts, to-do suggestions and insights are genuinely useful product data, not just transcripts. They let us mirror most of the Bee app.
- Processed vs. still-processing state is visible, so we can wait for the final transcript instead of guessing.
- [EDIT: anything about the device itself: battery, comfort, transcription quality on your recordings.]

**What needs work.**
- **Timing fields.** Real payloads had small `start`/`end` values, a wall-clock `spoken_at`, zero-length and tied utterances, and a point outside the conversation window. Our first adapter assumed epoch intervals and rejected real data. Documenting the units, origin and guarantees of each field (with one real example) would save others the same detour. (Friction log #1.)
- **Windows.** The npm-installed CLI is a `.cmd` shim; current Node won't spawn it without a shell, and passing user text through `cmd.exe` isn't safe. A native `bee.exe`, or documenting `bee proxy` as the supported way for programs to write, would help. (Friction log #5.)
- **Mobile apps need a computer in the middle.** To get Bee data onto a phone app we run a helper next to the CLI. A push or webhook to a developer's own app (with the user's consent) would remove that step.
- [EDIT: anything else you hit, e.g. pairing, login, or how long processing took.]

**Onboarding (zero to hello world).** [EDIT: your words. For example: how long from unboxing to the first `bee conversations list` returning your recording, and what slowed you down.]

**Would we build with it again?** [EDIT: Yes/No and why. Our draft: Yes. The CLI's JSON output and symmetric read/write commands made a real two-way integration possible in days, and facts and insights are a richer surface than any other wearable we've tried.]

---

## Amazon Bedrock (Nova Pro)

**What we used it for.** Reading a captured conversation into a title, at most three summary bullets, to-dos (with due times), memories, work steps with their exact quote, and questions for the trainer; answering questions from the user's own notes; breaking a task into tiny steps; and grading a typed practice answer against the trainer's instruction. All through the **Converse API** with a forced tool call (`toolChoice` → `submit_result`) and a JSON schema, temperature 0.

**What worked well.**
- Forced tool use gave us schema-shaped output every time, with no JSON repair code.
- The same request body works from Node `fetch` with a Bedrock API key (our local helper), from the AWS SDK in Lambda, and from `aws bedrock-runtime converse --cli-input-json` (our eval runner). One prompt file serves all three.
- Speed and cost: about 2.7 s and roughly 1,100 input + 225 output tokens per capture, about $0.0016 at Nova Pro's list price.
- Accuracy where it matters: on transcripts from workplaces it was never tuned on, it found 85% of stated steps at 96% precision, and turned no vague or chatty line into a rule (our on-phone rules found 63–67%).
- In AWS CloudShell, our first Converse call to Nova Pro worked with the console's credentials, no extra setup.

**What needs work.**
- Structured output guarantees shape, not faithfulness. In one run the action dropped a number that was in the source. A docs example of checking extracted text against its source would help teams avoid trusting valid JSON too much. (Friction log #2.)
- [EDIT: anything about model access, quotas or the console playground you noticed.]

**Onboarding.** [EDIT: your experience creating the Bedrock API key for the local helper.] From CloudShell, zero to a working Nova Pro call was one command.

**Would we build with it again?** Yes: Converse plus forced tool use is the simplest reliable structured-output path we've used, and Nova Pro's price makes per-capture analysis affordable for a free app.

---

## AWS Lambda (Function URLs), AWS CloudFormation, AWS CloudShell, IAM, CloudWatch Logs

**What we used them for.** One CloudFormation stack: a Node.js 22 arm64 Lambda behind a **Function URL** that verifies the user's Amazon Cognito token, applies a per-user hourly limit, and calls Bedrock through an IAM role allowed to invoke only Amazon Nova models. Logs keep 7 days and never include transcripts. Deployed from **CloudShell** with a script that refuses to run in any other AWS account.

**What worked well.**
- A Function URL gave us HTTPS with CORS without paying for API Gateway. Idle cost is zero.
- The Node.js 22 runtime ships the AWS SDK v3, so the deployment zip is three small files with no `node_modules`.
- `aws cloudformation deploy` + `aws lambda update-function-code` + `aws lambda wait function-updated` made a short, repeatable deploy script.
- CloudShell had the AWS CLI, Node 20, `zip` and `curl` ready, signed in as the console user.

**What needs work.**
- Getting files into CloudShell from an automated session: Upload opens the operating system's file picker, the terminal's output lives in a cross-origin frame (not readable as page text), and there's no CLI command to copy a file in. We typed a base64 bundle in checksummed chunks. (Friction log #4.)
- Public Function URLs need two resource-policy statements (`lambda:InvokeFunctionUrl`, and `lambda:InvokeFunction` with `--invoked-via-function-url`). We added both up front from the docs and verified them with `get-policy`; a single "public URL" setting in CloudFormation would make this harder to get wrong.

**Onboarding.** CloudShell to a deployed, health-checked endpoint was one script run after the files were in.

**Would we build with them again?** Yes. For a small AI feature, Function URL + Lambda + Bedrock is the cheapest shape we know that still checks who's calling.

---

## Amazon Cognito

**What we used it for.** Optional accounts in FirstDay Go: email + password sign-up confirmed once with a 6-digit email code, sign-in with just email and password afterwards, password reset by code, sign-out with refresh-token revocation, and account deletion (App Store requirement). Lite tier. The app calls the Cognito JSON API with plain `fetch` (no Amplify), which keeps Expo Go compatibility. The Lambda and the local helper verify access tokens against the pool's public keys.

**What worked well.**
- The JSON API (`SignUp`, `ConfirmSignUp`, `InitiateAuth` with `USER_PASSWORD_AUTH` and `REFRESH_TOKEN_AUTH`, `ForgotPassword`, `RevokeToken`, `DeleteUser`) is small enough to call directly from React Native.
- Standard RS256 JWTs with a public JWKS made token checks easy in Lambda and on the computer, with no SDK.
- The Lite tier covers the first 10,000 monthly active users for free.

**What needs work.**
- `list-user-pools` is regional, so our "does this account already have a pool?" check missed one in another region and we created a duplicate. The console could mention pools in other regions. (Friction log #3.)
- The built-in email sender has a low daily limit, so launch needs Amazon SES set up; the console could flag this when a pool sends verification codes.

**Onboarding.** Creating the pool and app client from the CLI took a few commands. [EDIT: your experience, e.g. how quickly the confirmation email arrived.]

**Would we build with it again?** Yes, for email + password accounts that need to work without a heavy client SDK.

---

## Non-Amazon tools (for completeness)

- **Expo SDK 57, Expo Go, expo-router:** let us build and test an iPhone app entirely from a Windows PC. Needs work: no speech recognition in Expo Go (we use the keyboard's mic), and Expo Snack's newest SDK lagged ours. (Friction log #7, #8.)
- **Node.js 22:** `process.loadEnvFile`, `node:test` and built-in `fetch` kept the helper and tests dependency-free.
