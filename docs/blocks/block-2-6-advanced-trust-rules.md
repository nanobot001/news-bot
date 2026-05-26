# Block 2-6: Advanced Trust Levels & Fine-Grained Rules

## Goal

Extend the scoring engine to support multi-tier source trust levels, priority weighting, and source-level custom scoring multipliers.

## Scope

- **Configuration Schema Upgrades:**
  - Update `config.json` schema to support:
    - Source `tier` (e.g., `1` for Breaking, `2` for Standard, `3` for Low-Priority/Aggregate).
    - Source-level keyword modifiers (e.g., custom multipliers for specific terms on a per-source basis).
- **Scoring Engine Integration:**
  - **Tier 1 (Breaking):** Bypasses topic score thresholds entirely (posts immediately if not duplicate).
  - **Tier 2 (Standard):** Evaluated under normal scoring guidelines.
  - **Tier 3 (Low-Priority):** Requires a higher score threshold to qualify or is penalized flatly (e.g., `-10` points).
  - Apply source-level keyword multipliers/penalties during keyword scoring.
- **Interactive Commands Support:**
  - Ensure `/testfeed` reports the computed tier, custom source modifiers, and updated thresholds.

## Out Of Scope

- Dynamic runtime configuration of trust levels (must update config file and run `/reload-config`).
- Natural language classification of sources.

## Acceptance Criteria

- Tier 1 articles post instantly regardless of score.
- Tier 3 articles are correctly filtered out unless they score above the elevated threshold.
- Custom multipliers/penalties from specific sources are reflected in the detailed score breakdown.
- Automated tests verify all tier evaluation and modifier rules.

## Verification

- Run typecheck and unit tests.
- Feed mock articles from Tier 1, 2, and 3 sources through `/testfeed` to verify thresholds and scores.

## Status

Pending.
