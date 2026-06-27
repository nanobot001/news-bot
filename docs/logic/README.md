# Logic

## Dedupe

Deduplication should prevent reposting the same article by checking, in order:

- RSS GUID when available
- Canonical URL hash
- Title hash fallback

## Relevance Scoring

Use deterministic scoring for the MVP:

```txt
+20 keyword match in title
+10 keyword match in summary/content
+15 trusted source
-20 blocked term match
-10 missing URL
```

Only post articles with a score greater than or equal to the topic threshold.

## Filtering

Filtering should reject articles that are duplicates, clearly blocked by topic terms, missing required fields, or below the configured threshold.

## Content Intent Routing

After scoring and filtering, each article is classified with a deterministic content intent and route. The classifier combines source defaults with title and summary rules.

Default behavior remains backwards compatible for normal publisher feeds. Two noisy source families have active defaults:

- Reddit and forum-like sources classify as `discussion`.
- Google News search feeds classify as `aggregate`.

If a source is explicitly configured as `mixed`, item-level title and summary rules can classify individual items as `news`, `review`, `guide`, `opinion`, `discussion`, or `reaction`.

Routes determine what happens after scoring:

- `immediate_post`: post as a normal standalone candidate.
- `thread_only`: attach to an existing related story thread if possible; otherwise store as digest pending.
- `digest_pending`: store for a future digest publisher.
- `review_pending`: store for a future review lane.
- `skip`: do not post.

The selected intent, confidence, route, and reasons are stored on the article and included in curation logs.

## Posting Controls

After content intent routing, a pure posting-controls pass applies deterministic signal-preserving caps before anything is posted. This layer is designed to reduce noise by sending lower-priority but still useful items into digest instead of spending immediate slots on the first eligible item seen in the poll.

Posting controls apply in this order:

- hard filter and skip outcomes
- digest-first topic or intent policy
- source and intent caps
- topic caps and cooldown
- immediate post fallback

Immediate candidates are sorted by deterministic priority using score, source trust, source tier, intent, recency, and high-signal title cues before caps are applied.

In the first pass, throttled-but-useful items are stored as `DIGEST_PENDING`. Only immediate `POSTED` articles count toward posting caps; `POSTED_DIGEST` does not.

## Scheduler Flow

The scheduled job should:

```txt
load config
for each topic
  for each source
    fetch RSS
    normalize items
    dedupe
    score
    classify content intent and route
    evaluate posting controls and prioritize immediate candidates
    post immediate high-signal items
    store digest/review/thread-only outcomes
    store results
```

Poll every 15 to 30 minutes for the MVP.
