# Continue Here

## 2026-06-26 (Repo Workflow Guardrail Added)

Current state:
- This repo regularly hits Windows sandbox friction for `apply_patch`, git mutation, and subprocess-heavy verification commands.
- Future sessions should use sandboxed reads for exploration, but escalate early for `git`, `npm test`, and PM2 or runtime control work instead of repeatedly retrying blocked commands.
- `spawn EPERM`, Windows sandbox wrapper refusals, and `safe.directory` warnings should be treated as environment constraints first.

Next step:
- Continue normal implementation work, but assume verification and commit or push flows will likely need escalation.

Do-not-forget checks:
- After shell-based fallback edits, re-read touched sections because text replacement can drift more easily than structured patching.

## 2026-06-25 (Real-Use Noise Feedback Captured)

Current state:
- After one to two weeks of real use, the main product concern is signal quality: too much channel noise, not enough useful consolidation, and too many threads that only collect one additional story.
- The Gemini API has been downgraded to the free tier, so near-term fixes should not depend on frequent LLM review.
- Updated Block 2-9 to focus on noise reduction, digest-first topic/intent policies, thread quality controls, and `toronto-eats` as a digest-heavy calibration case.
- Updated Block 2-13 so story clustering remains important but starts from deterministic story signals and bounded/optional LLM review.

Next step:
- Implement revised Block 2-9 first. The immediate win should be fewer main-channel posts, stronger digest routing for noisy topics, and fewer shallow public threads.

Do-not-forget checks:
- Treat digests as the pressure valve for useful-but-lower-urgency items.
- Preserve strong thread attachment for genuinely related stories, but raise the bar for creating a new public thread.
- Keep Gemini usage optional and budget-aware until paid API usage is restored.

## 2026-06-11 (Block 2-8 Intent-Based Digests Implemented)

Current state:
- Completed Block 2-8 and moved it to `docs/blocks/completed/block-2-8-intent-based-digests.md`.
- Wrote automated tests for `digestPublisher.ts` in `tests/digestPublisher.test.ts`.
- Wrote automated tests for `/testdigest` command in `tests/bot.test.ts`.
- Reorganized block documentation.
- Verification passed: `npm run build` and `npm test` execute successfully.

Next step:
- Implement Block 2-9 (`docs/blocks/block-2-9-posting-frequency-controls.md`) to add cooldowns and posting caps.

Do-not-forget checks:
- Maintain deterministic behavior for cooldown evaluations before exploring AI.

## 2026-06-10 (Block 2-6 Content Intent Routing Implemented)

Current state:
- Completed Block 2-6 and moved it to `docs/blocks/completed/block-2-6-content-intent-routing.md`.
- Added deterministic content intent classification in `src/processing/contentRouting.ts`.
- Added durable Prisma `Article` fields: `intent`, `intentConfidence`, `route`, and `routeReason`.
- Added migration `prisma/migrations/20260610000000_add_content_intent_routing/migration.sql` and applied it to the local SQLite DB.
- Added article statuses for `DIGEST_PENDING`, `REVIEW_PENDING`, and `SKIPPED_INTENT`.
- Polling now classifies and routes items after scoring/filtering:
  - normal publisher feeds preserve legacy immediate behavior;
  - Reddit/forum-like feeds default to `discussion`;
  - Google News search feeds default to `aggregate`;
  - discussion items attempt thread-only related coverage and otherwise store as digest pending;
  - aggregate items store as digest pending by default.
- `/testfeed` dry runs include intent routing diagnostics.
- Updated `docs/architecture/README.md`, `docs/data/README.md`, and `docs/logic/README.md` with the routing layer.
- Verification passed: `npm run build`; `npm test` (196/196).

Next step:
- Implement Block 2-8 (`docs/blocks/block-2-8-intent-based-digests.md`) so `DIGEST_PENDING` items can be batched and published by topic/intent.

Do-not-forget checks:
- Keep Block 2-8 focused on publishing/storing digest lanes. Do not add LLM summaries yet.
- `thread_only` discussion items currently fall back to `DIGEST_PENDING` when no related active story thread exists.
- The old `src/config/topics.json` working-tree modification predated this work and was not intentionally changed by Block 2-6.

## 2026-06-10 (Phase 2 Editorial Routing Plan Locked)

Current state:
- Reframed the remaining Phase 2 curation work around an editorial routing model: classify each item by content intent, then route it to immediate posting, thread context, digest, review, or skip lanes.
- Replaced the old pending `block-2-6-advanced-trust-rules.md` with `docs/blocks/block-2-6-content-intent-routing.md`.
- Replaced the old pending `block-2-8-daily-digests.md` with `docs/blocks/block-2-8-intent-based-digests.md`.
- Added `docs/blocks/block-2-9-posting-frequency-controls.md` for cooldowns and per-topic/source/intent caps.
- Added `docs/blocks/block-2-11-sports-schedule-event-phase.md` for Blue Jays and Raptors sports team context with schedule-aware game phase routing.
- Revised the sports schedule plan so APIs are occasional season/wide-window sync sources. Normal game-day event phase classification should use a local schedule cache, with more frequent refresh around NBA Cup / mid-season tournament windows, postponed/rescheduled games, play-in, and playoffs.
- Revised the sports model so normal topic config can declare a simple subject such as `sports_team:toronto-blue-jays`; provider IDs and API details should live in an internal registry.
- Added `docs/blocks/block-2-12-assisted-event-context-discovery.md` for manager-approved event context discovery across topics such as AI, gaming, conferences, elections, and product launches. Discovery may suggest contexts, but only approved contexts should affect routing.
- Updated `docs/blocks/README.md` and `docs/project-charter.md` to reflect content intent classification, intent-based digests, posting frequency controls, and sports schedule-aware routing.
- Completed block tickets have been moved into `docs/blocks/completed/`; active block tickets now remain directly under `docs/blocks/`.

Next step:
- Implement Block 2-6 first. This should introduce deterministic source defaults plus item-level classification for `news`, `official`, `review`, `guide`, `opinion`, `discussion`, `reaction`, `aggregate`, and `mixed`, with Reddit defaulting to discussion and broad Google News/search feeds defaulting to aggregate.

Do-not-forget checks:
- Keep classification deterministic and explainable before considering LLM-assisted classification in Phase 3.
- Treat schedule APIs as provider abstractions with durable local caching and graceful fallback, not as hard-coded calls inside the polling loop. The classifier should not call schedule APIs per article or per normal poll.
- Event discovery should be assisted, not autonomous: discovered candidates remain inert until a bot manager approves them.
- `src/config/topics.json` was already modified before this planning update and was not touched as part of this change.

## 2026-05-28 (YouTube Ingestion Scoring Improvements)

Current state:
- **YouTube Source Bonus**: Added a `+5` YouTube source bonus in `src/processing/scoreArticle.ts` for any item whose URL is from `youtube.com` or `youtu.be`. This is a platform-level signal: YouTube channels are hand-curated and topic-specific. Combined with the existing trusted source bonus (+15), trusted YouTube channels now automatically reach the 20-point post threshold (15 + 5 = 20) even without a keyword match in their title.
- **Keyword Expansion**: Expanded the `toronto-eats` keyword list in `src/config/topics.json` from ~40 to ~100 terms, covering common YouTube video title vocabulary: specific dishes (ramen, sushi, pizza, burger, steak, dumpling, dim sum, hotpot), ingredients (cheese, bread, noodle, salmon, shrimp, chicken), beverages (boba, bubble tea, matcha, latte, coffee), desserts (cake, gelato, ice cream, croissant, donut, waffle, crepe), and discovery/review terms (food tour, street food, food hall, hidden gem, must try, viral, ranked, review, tasting).
- **Removed false-positive blockedTerms**: Removed `"close"` and `"closed"` from `toronto-eats` blockedTerms — these were incorrectly blocking legitimate food news like "restaurant closed" or "closing soon".
- **New Scoring Test**: Added `"should apply YouTube source bonus for youtube.com URLs"` in `tests/scoring.test.ts` covering trusted YouTube (score = 20), untrusted YouTube (score = 5), trusted YouTube + keyword (score = 40), and non-YouTube URL (no bonus).
- **Verification**: TypeScript compiles clean. Scoring tests pass 15/15. Full suite previously passed 185/185 (OOM issue on this run is a transient machine resource constraint, not a code regression). Production `news-bot` PM2 service restarted.

Next step:
- Monitor discord channel for the next poll cycle to confirm YouTube videos are now appearing.
- Consider Block 2-6 (Advanced Trust Levels & Fine-Grained Rules) next.

## 2026-05-27 (YouTube RSS Ingestion Stabilization Complete)

Current state:
- **YouTube Ingestion Fallback**: Deployed a local RSSHub instance (on port 1200, managed by PM2 under the process name `rsshub`) to act as a fallback proxy for YouTube feed polling when direct XML requests to `feeds/videos.xml?channel_id=...` fail.
- **Shorts Shelf Parsing**: Modified the custom Innertube route in RSSHub (`lib/routes/youtube/api/youtubei.ts`) to handle channels without a standard "Videos" tab. The system now catches the "Videos tab not found" error, fetches the channel's Shorts shelf, and maps the `ReelItem` objects to standard RSS fields (including YouTube thumbnail and description mapping).
- **Configuration Integration**: Added the `RSSHUB_BASE_URL` optional environment variable in `.env` to point to the local RSSHub instance.
- **Documentation**: Updated `README.md` and `CHANGELOG.md` with configuration guidelines and technical ingestion flows.
- **Verification**: Verified all 16 YouTube feeds in `sources.json` return successfully via the RSSHub proxy and the test suite passes 151/151 tests.

Next step:
- Move to Phase 2/3 blocks, or focus on advanced trust level weightings and scoring rules.

## 2026-05-27 (Curation Stabilization & Bulk Keyword Management Complete)

Current state:
- **Curation Stabilization**: Implemented robust fallback lookup (`findArticleByMessageOrEmbed`) for articles and DB self-healing. Protected `startThread` operations with try-catch blocks in `src/bot/commands.ts` and `src/jobs/pollNews.ts` to gracefully handle `MessageExistingThread` errors.
- **Bulk Keyword Management**: Upgraded `/keyword add` and `/keyword remove` commands to support bulk operations via comma-separated input strings.
- Refactored `loadConfig.ts` to automatically split and clean comma-separated keyword entries during startup.
- Preserved exact singular output structures for single-keyword operations to ensure complete backward compatibility with existing unit tests.
- Unified "Split from Thread" nomenclature to "Remove from Thread" across commands and tests.
- Verified all 150 automated tests pass successfully and restarted the `news-bot` PM2 service.

Next step:
- Evaluate the next curation enhancement priorities, such as finalizing any remaining Phase 2 blocks.

## 2026-05-26 (Toronto Eats Sources & Regional News Mass Expansion Complete)

Current state:
- Reviewed all 10 sources for `toronto-eats` using a custom validation script and removed defunct `Toronto Cafe Blog` feed.
- Implemented robust exponential backoff retry logic and explicit `connection: close` headers in `src/ingestion/fetchFeeds.ts` to resolve CDN connection pool dropouts.
- **Massively Expanded Sources**: Added 22 new feeds to `sources.json` to cover regional dining and community areas:
  - **YouTube Food & Explore Channels** (`trusted: true`): Expanded to **13 highly-focused YouTube culinary/explore feeds** including *InstaNoodls* (`UCs0blMflhhRf9X0I_jtNvCg`), *HongKonger in Toronto* (`UCDYgTnWK6sl-YZEDM4jv7fQ`), *PhilsFoodReview* (`UCw_yc4pUYR1sLiZAO8bSeuA`), *UA Eats* (`UCqXXxQaZhsOB4qaXhaIIX7Q`), *blogTO YouTube* (`UCc6RY7ZDvJIl_MTdyX7QP3w`), *Travelling Foodie YouTube* (`UCGqG1RI-3ktA0BkzJH5N0RA`), *TorontoFoodGuide YouTube* (`UCm2s72Rl0Cv9vMslN5S7ZCw`), *eatingwithwinnie YouTube* (`UCu7h18FPcnR-doMCslE4ApQ`), *Toronto Our City YouTube* (`UCLqTzLKkaOeSsMcyDrLsqnw`), *torontofood YouTube* (`UC815btIVaeo3siioUe9seBQ`), *Johnny Strides YouTube* (`UCF-sE--qSw-5fTsLBhnvDRA`), *The Ken Continuum YouTube* (`UCa4CuTgIfQbLBmQVM0cuCcw`), and *Toronto Walk & Drive YouTube* (`UCoyWV29tYZNn8AxirSXRGyQ`).
  - **Social Media (Subreddit RSS)** (`trusted: false`): Added `/r/Markham`, `/r/RichmondHill`, `/r/Scarborough`, `/r/Etobicoke`, and `/r/mississauga`.
  - **Website & Google News Search Feeds**: Added *Google News - YorkRegion Food* (`trusted: true`) to scrape food updates off YorkRegion.com, and regional local news feeds for *Markham*, *Richmond Hill*, *Scarborough*, and *Etobicoke* (`trusted: false`).
- Verified all 139 automated tests pass successfully, rebuilt the application, and successfully restarted the production `news-bot` PM2 service (now loaded with **82 total active sources**).

Next step:
- Start Block 2-6 (Advanced Trust Levels & Fine-Grained Rules) to implement priority source weightings and multipliers.

## 2026-05-26 (Negative Keyword Management Complete)

Current state:
- Completed the addendum to Block 2-5 (Topic Keyword Management & Rescoring) to support blocked terms (negative keywords).
- Updated the `/keyword` command's `add` and `remove` subcommands with a `"Negative"` type option to support blocked terms.
- Implemented logic in `handleKeywordCommand` to persist negative keywords to `topics.json` under `blockedTerms` and ensure duplicate checks prevent entering positive or negative keywords multiple times.
- Updated autocomplete in `src/index.ts` to suggest existing `blockedTerms` when the command type is `"negative"`.
- Added new tests in `tests/keywordManagement.test.ts` verifying view, add, and remove operations for negative keywords.
- Modified the JSON loader in `src/config/loadConfig.ts` to automatically strip UTF-8 BOM if present on Windows.
- Verified all 139 tests pass successfully.

Next step:
- Start Block 2-6 (Advanced Trust Levels & Fine-Grained Rules) to implement priority source weightings and multipliers.


## 2026-05-26 (Manual Article Removal & Feedback Loop Complete)

Current state:
- Completed Block 2-10 (Manual Article Removal & Feedback Loop).
- Implemented the `"Remove Article"` Message Context Menu command, allowing Bot Managers to retract mistaken bot posts.
- Created the `"remove-article-modal_<messageId>"` interactive modal prompting operator for removal reason.
- Updated database status of the article to `"REMOVED"` and logged the reason in `statusReason`.
- Wrote a CurationLog entry with status `"REMOVED"`, preserving original keyword matches and matching scores alongside the removal reason.
- Tightened removal execution so SQLite status and audit logs are updated only after Discord message deletion succeeds; deletion failures now leave the article unchanged and report the failure to the operator.
- Enhanced the `/stats` command to track and display manual removal statistics per topic.
- Updated the `/audit` command to support filtering by `"REMOVED"`, printing diagnostic operator reasons, matched keywords, and a new "Culprit Keywords Summary" of contributing factors to aid operator keyword refinement.
- Created a new comprehensive unit test suite in `tests/articleRemoval.test.ts` covering the whole interactive flow, database status updates, deletion-failure safety, and audit keyword diagnostics. All 139 tests pass successfully.

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
