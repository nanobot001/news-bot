# Continue Here

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
