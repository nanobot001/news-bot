# Block 2-13: Story Signal Clustering & Editorial Review

> Status: Planned.
> Result: Not implemented.
> Notes: Adds a topic-agnostic story understanding layer and story-level observability so coverage can be inspected as a full river instead of article-by-article logs. Lived-use feedback showed related-story collection is critical, but the Gemini API is now on a free tier, so the first implementation should minimize paid/frequent LLM dependence.

## Goal

Move related-coverage matching from raw title similarity toward deterministic story signals, with optional bounded LLM editorial cleanup when available. The bot should recognize that multiple articles or submissions can belong to the same larger context while still representing distinct story clusters, such as a game result, a historic comeback, a winning play, a product launch, a policy reversal, or a restaurant opening. The system should also retain a complete story ledger so the operator can inspect posted stories, suppressed stories, unresolved stories, and likely misses.

## Scope

- Add a story signal extraction layer that can derive compact, explainable signals from normalized article titles, summaries, source metadata, and topic config.
- Extract general signals such as named entities, organizations, products, teams, people, places, scores, event labels, and story cues like `launch`, `recall`, `trade`, `injury`, `opening`, `closing`, `comeback`, `game-winner`, `policy change`, `lawsuit`, `earnings`, `review`, and `reaction`.
- Introduce event detection and story cluster matching before the current fallback title-similarity path so an incoming item can attach by shared story signals even when title wording differs.
- Preserve multiple distinct story clusters inside one broader event or context. For example, `Knicks win Game 4`, `largest NBA Finals comeback`, and `OG Anunoby winning tip-in` should be separate clusters that can share a broader game context.
- Treat deterministic signals as candidate generation and constraint, not final editorial authority. Use them to propose likely events and story clusters for later review.
- Add an optional bounded editorial review pass that can run on a schedule, on demand, or only when the configured LLM budget allows. It can:
  - confirm or change event assignment;
  - attach ambiguous items to existing clusters;
  - create new story clusters;
  - merge overlapping clusters;
  - split clusters that became too broad;
  - move items between clusters or events when confidence is high enough.
- Let discussion sources such as Reddit attempt story attachment before being treated as low-score or digest-only items, while still preventing unrelated discussion posts from becoming standalone news.
- Persist stories as first-class records with statuses such as posted, pending, suppressed, merged, unresolved, or missed-candidate so likely false negatives remain inspectable after the fact.
- Store enough story-cluster metadata to explain matches and edits in curation logs, `/testfeed`, story audit views, and LLM editorial review history.
- Add a deterministic recheck path for recent unmatched, digest-pending, or low-confidence items so they can attach when a better event or cluster appears later.
- Add a lightweight local web interface for topic, event, story, and review inspection so operators can inspect the full river of coverage without Discord message length limits.
- Keep the implementation auditable, operationally hands-off, and useful when LLM calls are disabled or heavily rate-limited.

## Out Of Scope

- Sports schedule or live event phase classification, which belongs to Block 2-11.
- Manager-approved event discovery, which belongs to Block 2-12.
- Full article summarization or narrative rewriting.
- Vector databases or embeddings.
- Full entity resolution across all aliases in the first pass.
- A polished end-user dashboard beyond the minimal operator-facing inspection surface needed for story debugging.

## Likely Files Or Areas

- `src/processing/similarity.ts`
- `src/processing/`
- `src/jobs/pollNews.ts`
- `src/storage/articleRepo.ts`
- `prisma/schema.prisma`
- `src/bot/commands.ts`
- `src/services/`
- `src/web/` or equivalent local operator surface
- `tests/`
- `docs/logic/README.md`

## Acceptance Criteria

- Incoming items generate deterministic story signals, candidate events, candidate story clusters, and a human-readable explanation.
- Story matching can group related coverage whose titles do not share enough raw words for the current Jaccard threshold.
- Multiple story clusters can coexist under the same larger event without collapsing into one duplicate bucket.
- Deterministic logic is good enough to create plausible event buckets and candidate cluster sets without requiring LLM review.
- The optional review pass can automatically reassign items, merge or split clusters, and create missing clusters when enabled and within budget.
- Every automatic editorial action writes a durable review log with timestamp, action type, prior assignment, new assignment, confidence, and evidence.
- Reddit/forum discussion items can attach to matching story clusters before low-score filtering sends them to skip or digest lanes.
- Unmatched discussion items continue to avoid noisy standalone posting unless another routing policy explicitly allows it.
- Recent digest-pending, unresolved, or low-confidence items can be rechecked against newer event and story clusters through the deterministic recheck path, with optional review assistance.
- The system persists a complete story ledger for each topic, including stories that were posted, pending, merged, suppressed, unresolved, or likely missed.
- Operators can inspect a topic-level story river that shows all known stories, whether they were posted, and which items belong to them.
- The lightweight web interface can display topic -> event -> story -> item relationships, review actions, and non-posted story candidates more clearly than Discord commands.
- `/testfeed` or curation/audit output shows story signal details such as matched entities, story cues, selected event, selected cluster, confidence, and reasons.
- Existing topics without strong story signals preserve current behavior and still fall back to title similarity when event and cluster generation is weak.
- Automated tests cover sports-style examples, non-sports examples, distinct sub-stories under one broader context, Reddit attachment before low-score filtering, optional review cleanup passes, false-negative inspection, story ledger states, and backwards compatibility.

## Verification

- `npm test`
- `npm run build`
- Run mocked examples for NBA Finals coverage, AI product/policy news, and Toronto restaurant opening/closing coverage through event and story matching and verify the selected cluster, optional review action, and explanation.
- Inspect the local web interface for one topic and verify posted, pending, merged, suppressed, and missed-candidate stories are visible in a simple event/story river view.
