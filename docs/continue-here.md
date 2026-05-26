# Continue Here

## 2026-05-26 (Manual Article Removal & Feedback Loop Complete)

Current state:
- Completed Block 2-10 (Manual Article Removal & Feedback Loop).
- Implemented the `"Remove Article"` Message Context Menu command, allowing Bot Managers to retract mistaken bot posts.
- Created the `"remove-article-modal_<messageId>"` interactive modal prompting operator for removal reason.
- Updated database status of the article to `"REMOVED"` and logged the reason in `statusReason`.
- Wrote a CurationLog entry with status `"REMOVED"`, preserving original keyword matches and matching scores alongside the removal reason.
- Enhanced the `/stats` command to track and display manual removal statistics per topic.
- Updated the `/audit` command to support filtering by `"REMOVED"`, printing diagnostic operator reasons, matched keywords, and a new "Culprit Keywords Summary" of contributing factors to aid operator keyword refinement.
- Created a new comprehensive unit test suite in `tests/articleRemoval.test.ts` covering the whole interactive flow, database status updates, and audit keyword diagnostics. All 136 tests pass successfully.

Next step:
- Start Block 2-6 (Advanced Trust Levels & Fine-Grained Rules) or other curation logic improvements like topic throttling or similarity clustering.

Do-not-forget checks:
- Keep track of operator-removed article matches in audit logs to automatically prioritize adjustments to topic keyword scoring or sources.

## 2026-05-26 (Topic Keyword Management & Rescoring Complete)

Current state:
- Completed Block 2-5 (Topic Keyword Management & Rescoring).
- Implemented `/keyword` slash command supporting `view`, `add`, and `remove` subcommands for standard and location keywords.
- Implemented autocomplete logic for topic parameters across all relevant slash commands.
- Extended `/refresh` with an optional `hours` parameter (up to 72 hours) to support time-bound article rescoring, updating their post status, and outputting an evaluation report.
- Fixed bot registration test cases to support 15 commands and added mock `getInteger` to refresh mock interactions.
- Verified all 130 tests pass successfully.

Next step:
- Start Block 2-6 (Advanced Trust Levels & Fine-Grained Rules) to support multi-tier source trust levels, priority weighting, and source-level custom scoring multipliers.

Do-not-forget checks:
- Keep the tier configurations schema-validated.
- Ensure bypass configurations for Tier 1 sources are respected safely in polling and manual refresh runs.

## 2026-05-26 (Location-Aware Keyword Scoring & Command Control Complete)

Current state:
- Completed Block 2-3 (Bot Manager Authorization & Curation Audit Logs) and Block 2-4 (Topic & Source Management Commands).
- Implemented **Location-Aware Keyword Scoring Separation**: Separated core dining keywords from regional/neighborhood locations in `topics.json` under a new `"locationKeywords"` field for the `toronto-eats` topic.
- Updated `scoreArticle` engine to only award points for location keywords if the article also matches a core topic keyword or comes from a trusted source. Location-only matches on untrusted feeds are ignored (returning a score of 0) to avoid spamming the channel with crime, politics, or sports from those municipalities.
- Added comprehensive unit tests in `tests/scoring.test.ts` for location-aware rules.
- Rebuilt the app and verified all 119 tests pass successfully.
- Restarted the `news-bot` service in PM2 (ID 11).

Next step:
- Start Block 2-5 (Discord-Side Topic Keyword Management) to implement dynamic addition/removal of core/location keywords and rescoring via Discord commands.

Do-not-forget checks:
- Keep the `locationKeywords` option optional in the `TopicConfig` validation to maintain backwards compatibility with other topics.
- Ensure the upcoming `/keyword` slash commands support managing both `keywords` and `locationKeywords`.

## 2026-05-26 (Reaction Email Forwarding Complete)

Current state:
- Completed Block 2-2 (Reaction Email Forwarding).
- Added `EmailForward` database model to Prisma schema, ran `npx prisma db push`, and updated the Prisma Client.
- Created `src/services/emailService.ts` for nodemailer SMTP transporter setup with zero-config Ethereal fallback in development mode.
- Integrated forwarding handler in `src/bot/reactionListener.ts` to trigger on reaction. Added standard support for all common email/envelope emojis (like `📧`, `✉️`, `📩`, etc.) out of the box, with fallback option for custom config.
- Implemented user direct message (DM) notifications containing success confirmation or Ethereal preview URLs, and error diagnostics if forwarding fails.
- Created 11 new unit and integration tests covering database idempotency, mock nodemailer transport, custom emoji settings, and reaction-based event logic.
- Verified all 85 unit tests pass successfully, typescript compiles cleanly, and the production build is ready.

Next step:
- Start Block 2-3 (Bot Manager Authorization & Curation Audit Logs) to implement manager identity gates, slash command permissions, and database logging for curation skips/filters.

Do-not-forget checks:
- Keep the manager gates aligned with Discord role IDs or user IDs, keeping commands strictly restricted to designated managers.

## 2026-05-25 (Phase 2 Control Plane Reschedule)

Current state:
- Updated the Phase 2 block schedule to use bot manager terminology instead of broad admin language.
- Renumbered planned Phase 2 blocks so topic/source management now comes before keyword management.
- Added `docs/blocks/block-2-4-topic-source-management.md` for Discord-side `/topic` and `/source` management backed by `topics.json` and `sources.json`.
- Working tree has uncommitted docs-only changes: renamed planned Phase 2 block files, updated `docs/blocks/README.md`, updated `docs/project-charter.md`, and this handoff.

Next step:
- Continue with Block 2-2 (Reaction Email Forwarding), then implement Block 2-3 (Bot Manager Authorization & Curation Audit Logs) before topic/source management.

Do-not-forget checks:
- Use Discord user IDs and role IDs for bot manager identity; do not add password or shared-secret slash-command flows.
- Keep topic rename and hard delete out of the first topic/source management pass because stored articles and favorites are topic-scoped.
- Verification was not run after the reschedule because the change only touched planning docs.

## 2026-05-24 (Favorites Complete)

Current state:
- Completed Block 2-1 (Heart Reaction Favorites & Instapaper Sync) and its addendum (Two-Way Favorite Deletion).
- Added `UserFavorite` model, `deleteFavorite` & `deleteFavoriteById` repo helpers, reaction removal listener, and `/unfavorite` command with autocomplete.
- Verified all 74 unit tests pass cleanly, compiled successfully, merged the branch to `main`, pushed to GitHub, and restarted the production PM2 service (`news-bot`).

Next step:
- Begin Block 2-2 (Reaction Email Forwarding) to listen for email reaction emoji, compose the article content, and forward it via email.

Do-not-forget checks:
- Keep the database actions securely scoped to the invoking Discord user when managing personal favorites.
- Test new listeners with mock events inside `tests/` before deploying.

## 2026-05-24

Current state:
- Updated `docs/project-charter.md` and `docs/architecture/README.md` to clarify the future reusable bot/agent harness direction.
- The roadmap now explicitly names agent-shaped boundaries: instructions, allowed tools, memory scopes, permissions, audit logs, and bot personality/tone config.
- The MVP boundary remains unchanged: current implementation is still a deterministic news bot, with LLM and multi-agent harness behavior reserved for later phases.

Next step:
- Continue Phase 2 implementation from `docs/blocks/block-2-1-heart-reaction-favorites.md`, unless the roadmap docs need another pass first.

Do-not-forget checks:
- Keep future harness work config-driven and permission-scoped.
- Do not let optional LLM behavior replace deterministic dedupe, scoring, or baseline posting rules.

## 2026-05-24

### Current State
- **Topic-Specific Emojis:** Fully implemented support for per-topic custom emojis defined in `topics.json`. The custom emojis are prefixed directly in posted article embed titles.
- **Slash Commands Length Limit Fix:** Fixed the `/topics` slash command output in `src/bot/commands.ts` to truncate keywords and blocked terms list output to a maximum of 10 items per topic, avoiding Discord's 2,000-character payload limits.
- **Verification & Deployment:** Rebuilt the project, verified all 55 unit tests pass cleanly, and successfully reloaded the background PM2 service (`news-bot`).

### Next Roadmap Phase
- Continue with Phase 2 live curation/operations enhancements. The next planned block is `docs/blocks/block-2-1-heart-reaction-favorites.md`, which adds heart reaction favorites, `/favorites` recall, and optional Instapaper Simple API saves.

## 2026-05-23

### Current State
- **Phase 1 MVP Complete:** All implementation blocks (00 through 08) are fully implemented and verified.
- **Release Tagged:** Version `[0.1.0]` release has been documented in `CHANGELOG.md`.
- **System Quality:** All 35 automated tests (`tests/*.test.ts`) pass cleanly, TypeScript types are correct, and the bot registers and responds to slash commands (`/ping`, `/testfeed`, `/lastposts`, `/reload-config`) correctly.
- **Documentation:** `README.md` is updated with comprehensive setup, env var specifications, JSON config structure examples, database migrations, and manual verification/smoke test guidelines.

### Next Roadmap Phase (Phase 2: Curation Enhancements)
- Begin improvements to the news bot's curation rules as described in the `docs/project-charter.md` Phase 2:
  - Add heart reaction favorites with recall and optional Instapaper saves.
  - Add reaction-based email forwarding for article URLs.
  - Add Discord-side keyword inspection and admin-only keyword add/remove commands.
  - Add per-topic posting frequency limits (cooldowns / throttling).
  - Implement daily digest summaries for topics.
  - Group related articles or similar stories.
  - Implement admin-only command authorization gates.
  - Add finer-grained logging for skipped and low-scoring posts.

### Do-Not-Forget Checks
- Maintain strict topic-isolation in database storage.
- Ensure any additional filters or scoring rules are added as pure functions in `src/processing/` and tested via automated unit tests.
- Keep the system architecture extensible to other source adapters (Phase 4).
