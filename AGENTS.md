# Agent Instructions

Use `docs/project-charter.md` as the top-level project authority. Use `docs/blocks/` for scoped AI-buildable tickets and implement one selected block at a time.

When implementing a block, update project docs only when the work creates or changes durable knowledge future blocks need. Use the relevant docs area and avoid documentation churn for trivial edits.

For numbered block work, use the global `implement-block` skill. Do not create project-specific local skills unless a repeated workflow becomes too specialized for this file and the project docs.

## Repo Workflow Notes

This Windows repo frequently hits sandbox friction for subprocess-heavy and git-mutating commands.

- Prefer sandboxed reads for inspection only.
- Escalate early for verification, git state changes, and runtime control commands instead of retrying after predictable sandbox failures.
- Common commands that should usually be treated as escalation candidates in this repo:
  - `git -c safe.directory='C:/Users/antho/Code/news-bot' status`
  - `git add`, `git commit`, `git push`
  - `npm test`
  - `pm2 reload news-bot`
- Treat `spawn EPERM`, Windows sandbox wrapper refusals, and git `safe.directory` warnings as environment issues first, not immediate code regressions.
- If manual file editing must fall back from `apply_patch`, re-read the touched section and run the cheapest useful verification command right away.

