# FirstDay Codex Team Instructions

This repository is being built by more than one Codex session. Read these files before changing code:

1. `README.md` for the product and demo story.
2. `spec.md` for the shared technical contract.
3. `TASKS.md` for ownership, dependencies, and remaining work.

The shared contract is more authoritative than assumptions in a chat message. Do not invent new endpoint names, payload fields, status values, or database identifiers when an equivalent contract already exists.

Before editing:

- Claim one task in `TASKS.md` by changing it to `In progress` and adding your session/owner.
- Check the task's dependencies and avoid files listed as owned by another active task.
- If the requested change affects a schema, API, state transition, or Bee boundary, update `spec.md` before implementation and add a change-log row.

After editing:

- Run the smallest relevant test, typecheck, or contract check.
- Update the task row with the verification result.
- Mark the task `Done` only when its acceptance condition passed.
- Add an active work-log entry when a task changes state.
- Report remaining work by reading `TASKS.md`, not by estimating from the current files.

Keep the Bee credential boundary intact: credentials stay in the local bridge, never in the iOS bundle or public API responses. Keep source evidence attached to every extracted instruction, generated scenario, and evaluation.

