# AI Usage Log

## Known limitations

- The LLM-based grounding check (Phase 7) reliably catches fabricated facts on `llama-3.3-70b-versatile`, but is sometimes over-strict on legitimate derived recommendations and analysis, occasionally rejecting valid posts. Verified manually across multiple test rounds; acceptable for this build given free-tier model constraints.
- Novelty checking is LLM-based and can occasionally miss an exact duplicate despite the correct recent-topics list being passed in (observed once, 1 miss out of 4 novelty checks in the same batch); `domain_fit` (added this phase) independently would have caught this specific case anyway.
