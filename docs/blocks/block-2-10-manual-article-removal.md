# Block 2-10: Manual Article Removal & Feedback Loop

## Goal

Implement a mechanism for bot managers to retract posted articles directly from Discord using a Message Context Menu command ("Remove Article"). The removal process will prompt the operator for a reason via a Discord Modal, delete the post from Discord, update its status to `"REMOVED"` in SQLite, and capture diagnostic info on which keywords triggered the false positive. This feeds back into `/audit` to help tune the topic's keyword configuration.

## Scope

- **Matched Keywords Tracking:**
  - Update `scoreArticle` to identify and include the exact matched core keywords, location keywords, and blocked terms in the curation log breakdown (e.g., `Title matched keyword "deals" (+20)`).
  
- **Discord Message Context Command:**
  - Define and register a Message Context Menu command named `"Remove Article"` (restricted to Bot Managers).
  
- **Interactive Removal Modal:**
  - When `"Remove Article"` is selected, authenticate the operator.
  - Present a Discord Modal prompting for the **Reason for Removal** (required).
  
- **Retraction Execution:**
  - Upon modal submission:
    - Locate the article in the database using the target message's ID.
    - Delete the message from the Discord channel.
    - Update the article status in SQLite to `"REMOVED"` and store the operator's reason in `statusReason`.
    - Save a `CurationLog` record with status `"REMOVED"` and a breakdown including the operator's reason and the original matched keywords.
    
- **Diagnostic Audit Reporting:**
  - Update the `/audit` command to support the `"REMOVED"` status filter.
  - Display the operator's removal reason and matched keywords in the `/audit` output.
  - Include an aggregated summary in `/audit` when filtering by `REMOVED` showing which keywords most frequently contributed to the removed posts.

## Out Of Scope

- Automating the modification of `topics.json` from the removal action itself (configuration changes remain a deliberate, manual step or managed via `/keyword`).
- Reaction-based automated deletes by non-managers.

## Acceptance Criteria

- Right-clicking (desktop) or long-pressing (mobile) a bot post and choosing "Remove Article" displays a modal prompt.
- Submitting the modal deletes the post from the Discord channel.
- Non-managers receive an ephemeral error and cannot load the modal.
- The SQLite database correctly records `status = "REMOVED"` and stores the reason.
- `/audit topic:<topic> status:REMOVED` shows the removed article list, operator reasons, matched keywords, and a summary tally of offending keywords.
- Automated tests verify the removal interaction flow, database status updates, and audit keyword diagnostics.

## Verification

- Run typecheck and unit tests.
- In Discord, trigger a post, right-click/long-press it, remove it with a reason, and run `/audit status:REMOVED` to verify the diagnostic breakdown.

## Status

Completed.
