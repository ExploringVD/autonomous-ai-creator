# AI Usage Log

This project was built with Claude in two roles: a planning/specification layer (drafting the 
persona, the editorial judgment prompt, the writing prompt, and each phase's implementation prompt) 
and Claude Code in VS Code, executing those prompts directly against this codebase — writing code, 
running tests, committing, and reporting results back before the next prompt was issued. Below is 
the real phase-by-phase history; commit hashes are from this repo's actual git log.

## Phase 1-3: Scaffolding, repo, database schema
Prompted to scaffold the Next.js/TypeScript project, initialize the git repo, and create the 
Supabase Postgres schema (agents, posts, topic_log tables). Debugged a malformed DATABASE_URL 
(unencoded special characters, wrong pooler host) through several rounds before connecting.

## Phase 4: POST /api/agent/init
Prompted to build the agent-creation endpoint matching the exact PS3 contract shape 
{"agentId": "..."}, zod-validated, building the persona config from docs/persona.md.

## Phase 5-6: GET /api/agent/feed, LLM provider
Prompted to build the feed endpoint (exact contract shape, newest-first, UUID validation). 
Originally specced Google Gemini as the free-tier LLM; hit a 429/quota-zero error that turned out 
to require a linked billing account. Switched the entire LLM stack to Groq (free, no card) instead.

## Phase 7: Writer voice and anti-fabrication (~8 iterative rounds)
Prompted repeatedly to fix the post-writing prompt in docs/writing-prompt.md / lib/writer.ts: 
verbatim rhetorical-question reuse, headline-restating openings, word-count collapse from 
over-strict sentence caps, invented facts/mechanisms not present in the source, and grounding-check 
over/under-strictness. Added a second LLM call as an authoritative grounding/fact-check pass, 
distinct from a regex pre-check kept only as an advisory hint.

## Phase 8-10: Cron cycle, pacing, judgment
Prompted to build the cron-triggered publish cycle (app/api/cron/run-cycle), with a 1-2 post cap 
per cycle and CRON_SECRET auth.

## Phase 11: domain_fit standard, topic_log bug fix
An off-domain post (an ECG/cardiac-diagnosis paper) was published despite not fitting any of Rhea's 
5 interest areas. Prompted to add domain_fit as a 7th editorial standard in docs/judgment-prompt.md 
with a worked rejection example, and fixed a bug where topic_log logged decision:'published' before 
insertPost had actually succeeded, permanently burning topics whose writes failed or were 
pacing-capped.

## Phase 12: Demo dashboard
Prompted iteratively to build app/feed/page.tsx: two-column layout, cosmic/starfield theme, 
embedded live API tester hitting real endpoints, judgment-transparency panel, grounding badges, 
mobile-responsive collapsible panels, scroll-triggered pop-in animation.

## Phase 14: Autonomy observation window + production fixes
While observing the live GitHub Actions cron, diagnosed and fixed three real production issues:

1. Cron was processing every row in the agents table; 5 throwaway agents created by clicks on the 
   dashboard's Live API Tester multiplied Groq judgment token usage 6x, silently exhausting the 
   100k-tokens/day limit. Fixed by adding a CRON_AGENT_IDS allowlist env var so only the real 
   submission agent is processed; judgeTopic's previously-swallowed API failures now surface in the 
   cycle JSON's errors array instead of returning a misleading topicsJudged: 0.
2. Discovery kept returning the same ~12 stories every cycle, so novelty correctly rejected them 
   repeatedly and nothing new published for ~20 hours. Fixed by rotating 3-of-5 interest-area 
   queries per cycle (covering all 5 every 5 cycles) plus a domain query, and skipping candidates 
   already in topic_log before spending a judgment call (commit e6656b0 fixed a counter bug in this 
   same change, found and reported rather than hidden).
3. Diagnosed and ruled out a suspected ordering bug in the judgment-history panel (the same two 
   rejected topics kept appearing on top) — confirmed via raw timestamp comparison that NewsAPI was 
   deterministically returning the same story order each cycle, not a caching or query bug.

## Phase 15: Design polish, documentation
Prompted to replace purple/violet decorative gradients (a recognizable AI-generated-tool visual 
cliché) with a near-monochrome warm haze, keeping the cyan/rose status colors that encode real 
published/rejected data untouched. Prompted to add a scrollable full judgment history to the 
dashboard (commit 47fe660) and a branded landing page at the root URL (commit eb0c9ce). Prompted to 
write this README and AI usage log.

## Known limitations

- The LLM-based grounding check (Phase 7) reliably catches fabricated facts on `llama-3.3-70b-versatile`, but is sometimes over-strict on legitimate derived recommendations and analysis, occasionally rejecting valid posts. Verified manually across multiple test rounds; acceptable for this build given free-tier model constraints.
- Novelty checking is LLM-based and can occasionally miss an exact duplicate despite the correct recent-topics list being passed in (observed once, 1 miss out of 4 novelty checks in the same batch); `domain_fit` (added this phase) independently would have caught this specific case anyway.
