# Feature requests (optional Devpost field)

| # | For | Request | Why it matters to FirstDay Go | Priority |
| --- | --- | --- | --- | --- |
| 1 | Bee | **Push or webhook to a developer's own app** when a conversation finishes processing (with the user's consent). | Today a helper must run on a computer next to the Bee CLI to watch `bee stream` and relay to the phone. A push would make "just recorded → practise now" work anywhere. | Important |
| 2 | Bee | **Documented timing fields** (`start`, `end`, `spoken_at`): units, origin, guarantees, with a real example including ties and zero-length utterances. | Our first importer rejected real data because it guessed wrong. Exact order matters when a rule's steps must stay in order. | Important |
| 3 | Bee | **Native Windows binary** (or `bee proxy` documented as the supported write API). | npm's `.cmd` shim can't be spawned safely with user text on current Node; we route writes through `bee proxy`. | Important |
| 4 | Bee | **Fact categories or tags** (e.g. "work", "people") and a way to attach a source conversation ID to a created fact. | FirstDay groups memories as You / People / Work and always shows the source line; we have to keep that link ourselves. | Nice-to-have |
| 5 | Amazon Bedrock | **Docs pattern for checking extracted text against its source** next to structured-output examples. | Valid JSON isn't faithful content; teams extracting procedures need a recommended check. | Important |
| 6 | AWS CloudShell | **CLI or API to copy a file into a CloudShell session**, and an accessible text mode for terminal output. | Automated or assistive workflows can't use the native file picker, and terminal output sits in a cross-origin frame they can't read as text. | Nice-to-have |
| 7 | Amazon Cognito | **Show user pools in other regions** in the console's empty state. | Our regional check missed an existing pool and we created a duplicate. | Nice-to-have |
