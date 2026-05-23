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
    post eligible items
    store results
```

Poll every 15 to 30 minutes for the MVP.
