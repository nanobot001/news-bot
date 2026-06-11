# Block 08: README Setup And MVP Verification

> Status: Completed on 2026-05-23.
> Result: Implemented.
> Verification: `npm run typecheck && npm run test && npx prisma validate` - passed.
> Notes: Fully completed Phase 1 MVP documentation and verification. The bot was successfully tested locally in development mode, connecting to the live Discord Gateway and auto-registering slash commands.


## Goal

Finalize setup documentation and verify the full MVP against acceptance criteria.

## Scope

- Update README with install, config, Prisma, command registration, and run steps.
- Document environment variables and config files.
- Verify the MVP acceptance checklist.
- Update `docs/continue-here.md` with the current stable state.

## Out Of Scope

- Phase 2 curation features
- LLM features
- New source adapters

## Acceptance Criteria

- A new operator can configure and run the bot from README instructions.
- MVP acceptance criteria in `docs/project-charter.md` are checked.
- Known limitations and next roadmap phase are documented.

## Verification

Run typecheck, the implemented test suite, and a manual Discord smoke test.
