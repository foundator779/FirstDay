# FirstDay Go architecture

```mermaid
flowchart LR
  subgraph Wearable
    BEE[Bee wearable]
  end
  subgraph BeeCloud[Bee cloud]
    PROC[Transcription, facts,<br/>to-dos, daily summary, insights]
  end
  subgraph Computer[Your computer]
    CLI[Bee CLI<br/>signed in]
    BRAIN[brain/server.mjs<br/>zero-dependency Node]
    STATE[(.brain-state.json<br/>seen IDs, inbox,<br/>confirmed rules)]
    SKILL[firstday-coach<br/>Agent Skill]
  end
  subgraph Phone[iPhone, Expo Go]
    APP[FirstDay Go<br/>local JSON store]
  end
  subgraph AWS[AWS, us-east-1, pay-per-request]
    COG[Amazon Cognito<br/>user pool, Lite tier]
    URL[Lambda Function URL<br/>token check, rate limit]
    BR[Amazon Bedrock<br/>Nova Pro]
    COACH[Coach Lambda URL<br/>teams + MCP server 2025-11-25]
    DDB[(DynamoDB, on demand<br/>teams, keys, opt-in steps)]
  end
  subgraph Others[Other screens and apps]
    TRAINEE[Trainees' FirstDay Go]
    VOICE[Voice screen<br/>public/voice.html]
    AGENT[Any MCP client<br/>AI assistant]
  end

  BEE --> PROC
  PROC <--> CLI
  CLI -- "list / get / stream --json<br/>facts, todos, daily, insights" --> BRAIN
  BRAIN -- "confirm / update / create fact<br/>create / complete todo<br/>accept / dismiss suggestion" --> CLI
  BRAIN <--> STATE
  STATE --> SKILL
  APP <-- "LAN + pairing code<br/>sync, inbox every 45 s, write-back" --> BRAIN
  APP -- "sign up, code, sign in, refresh, delete" --> COG
  APP -- "capture text + access token" --> URL
  URL -- "JWKS check" --> COG
  URL -- "Converse, forced tool call" --> BR
  BRAIN -. "optional: own Bedrock key" .-> BR
  APP -- "share / send changes (trainer)<br/>opt-in steps for the coach" --> COACH
  TRAINEE -- "join with code<br/>check for changes" --> COACH
  VOICE -- "MCP tools/call<br/>per-app key" --> COACH
  AGENT -- "MCP tools/call<br/>per-app key" --> COACH
  COACH <--> DDB
  COACH -- "JWKS check" --> COG
```

## Data paths

| Path | What moves | Where it's stored |
| --- | --- | --- |
| Bee → brain | Final processed transcripts (exact text, Bee's order), facts, to-dos, suggestions, daily summary, insights | Not stored by the brain, except IDs it has seen and the titles of new conversations waiting for the phone |
| Brain → phone | The same, on request, after the user OKs reading that conversation | On the phone only |
| Phone → brain → Bee | Confirmed or fixed facts, kept and finished to-dos, accepted or skipped suggestions (switchable) | In Bee |
| Phone → brain | Confirmed work rules with practice levels, for the coach skill | `brain/.brain-state.json` (git-ignored) |
| Phone → AWS | One capture, question, task or practice answer, with a Cognito access token | Nowhere: passed to Bedrock and back. Error names only in logs (7 days) |
| Trainer's phone → coach service | A shared training: title, trainer, steps with the trainer's quotes (no practice data, no old actions) | DynamoDB, until the trainer stops sharing |
| Coach service → trainees' phones | The latest version; each phone turns changed steps into Change Drills | On each phone |
| Phone → coach service (opt-in) | Confirmed steps with how solid each one is, open questions for the trainer | DynamoDB, until "Quiz me from other apps" is turned off |
| Voice screen / AI assistant → coach service | MCP requests with a per-app key (only its SHA-256 hash is stored) | Nothing new: tools are read-only |

## Boundaries

- **Bee credentials stay on the computer.** The phone holds a 6-digit pairing code, never a Bee token. Five wrong
  codes lock an address out for 15 minutes; the phone's Cognito token goes only to the AWS endpoint (or a brain that requires accounts).
- **Your OK before reading.** A Bee conversation isn't fetched or analysed until you tick "I'm OK with FirstDay Go reading this conversation".
- **Exact quotes.** Every to-do, memory and work step keeps the line it came from; feedback in practice quotes the trainer.
- **Untrusted text.** Transcripts are sent to Bedrock as data, with a system rule that they are never instructions;
  brain replies are validated field by field on the phone; Bee IDs are pattern-checked before reaching the CLI;
  on Windows, free text goes to Bee through `bee proxy` as JSON, never through a shell.
- **Sign in first, data stays on the phone.** The app opens on a landing page (create account / sign in). Each account's
  notes are a separate file on the phone; Cognito holds only the login. No brain or network needed after sign-in:
  the app still captures, sorts, reminds and trains, reading text with on-phone rules.

- **Teams see counts, not people.** A trainer sees how many joined, never who or anyone's answers. Join codes are
  6 characters from a 31-character alphabet, and join attempts are rate-limited per account (on each server instance).
- **MCP server rules.** Streamable HTTP with JSON responses, `MCP-Protocol-Version` checked, browser calls only from
  FirstDay's own pages (Origin check), keys revocable one by one; every tool is read-only.

## AWS resources (the AI endpoint stack; the coach service is a second, separate stack)

| Resource | Setting | Why |
| --- | --- | --- |
| `AWS::Lambda::Function` `firstday-go-ai` | Node.js 22, arm64, 256 MB, 60 s | Cheapest Lambda shape; Bedrock replies take about 3 s |
| `AWS::Lambda::Url` | Auth NONE + Cognito JWT check in code, CORS for the app | No API Gateway to pay for; still only signed-in users |
| `AWS::IAM::Role` | Basic logs + `bedrock:InvokeModel` on Nova models only | Least privilege |
| `AWS::Logs::LogGroup` | 7-day retention | No transcripts logged; short retention anyway |
| Amazon Cognito user pool (created separately) | Lite tier, email + password, code confirmation | First 10,000 monthly active users free |
| Coach stack `firstday-go-coach` (`infra/coach.yaml`) | Lambda (Node.js 22, arm64, 256 MB) + Function URL + on-demand DynamoDB table | Team trainings and the MCP server; idle cost zero |
