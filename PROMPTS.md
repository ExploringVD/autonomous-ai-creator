# AI Usage Log

## Known limitations

- The LLM-based grounding check (Phase 7) reliably catches fabricated facts on `llama-3.3-70b-versatile`, but is sometimes over-strict on legitimate derived recommendations and analysis, occasionally rejecting valid posts. Verified manually across multiple test rounds; acceptable for this build given free-tier model constraints.
