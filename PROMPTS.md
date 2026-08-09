# AI Usage Log

This project was built using Claude in two roles: a planning/specification layer (drafting the
persona, the editorial judgment prompt, the writing prompt, and each implementation prompt) and
Claude Code, in VS Code, executing those prompts directly against the codebase — writing code,
running tests, committing, and reporting results back for the next round. Every phase in this repo's
history followed that loop: spec/prompt drafted, implemented, verified against real API responses
or real DB state, then the next prompt issued.

Key authored specs: docs/persona.md (Rhea Kapoor), docs/judgment-prompt.md (7-standard editorial
check), docs/writing-prompt.md (voice rules and anti-fabrication constraints).

## Known limitations

- The LLM-based grounding check (Phase 7) reliably catches fabricated facts on `llama-3.3-70b-versatile`, but is sometimes over-strict on legitimate derived recommendations and analysis, occasionally rejecting valid posts. Verified manually across multiple test rounds; acceptable for this build given free-tier model constraints.
- Novelty checking is LLM-based and can occasionally miss an exact duplicate despite the correct recent-topics list being passed in (observed once, 1 miss out of 4 novelty checks in the same batch); `domain_fit` (added this phase) independently would have caught this specific case anyway.
