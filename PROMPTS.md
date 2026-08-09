# AI Usage Log

This project was built with Claude in two roles: a planning/specification layer (drafting the 
persona, the editorial judgment prompt, the writing prompt, and every phase's implementation 
prompt) and Claude Code in VS Code, executing those prompts directly against this codebase — 
writing code, running tests, committing, and reporting real, verified results back before the next 
prompt was issued. What follows is the real phase-by-phase history, with actual error messages, 
model names, and commit references from this repo.

## Phase 1: Scaffolding
Prompted to scaffold a Next.js 14 (App Router) + TypeScript + Tailwind project and initialize the 
git repository.

## Phase 2: Environment and Supabase project
Prompted to create .env.example with GEMINI_API_KEY, NEWSAPI_KEY, and DATABASE_URL placeholders, 
and to create the Supabase project. Debugging note: the first DATABASE_URL attempts failed because 
the Postgres password contained an unencoded "@" and a wrong pooler host was guessed; fixed by 
pulling the literal connection string from Supabase's Connect panel instead of constructing it by 
hand.

## Phase 3: Database schema
Prompted to create three tables — agents, posts, topic_log — with agents storing persona_config, 
posts storing text/rationale/sources per the PS3 feed contract, and topic_log storing 
topic/decision/reason for memory and de-duplication.

## Phase 4: POST /api/agent/init
Prompted to build this endpoint to the exact PS3 contract: zod-validated input, builds a 
persona_config from docs/persona.md, returns exactly {"agentId": "..."}.

## Phase 5: GET /api/agent/feed
Prompted to build this endpoint with dynamic = 'force-dynamic' (no caching), a UUID-format guard 
that returns 404 rather than 500 on a malformed id, and the exact contract shape: 
{"posts": [{"id","createdAt","text","rationale","sources"}]}, newest-first.

## Phase 6: LLM provider — Gemini to Groq
Originally specced Google Gemini. First real call returned HTTP 429 with limit: 0 even on a newly 
created project. Root cause, found via web search: Google now requires a linked billing account for 
real free-tier quota, regardless of project age. User explicitly declined to add a billing account 
("i won't be adding a billing account"). Switched the entire LLM stack to Groq (genuinely free, no 
card required).

## Phase 7: Writer voice and anti-fabrication — 8 iterative rounds
Prompted repeatedly against docs/writing-prompt.md / lib/writer.ts. Issues found and fixed, in 
order: verbatim reuse of the same rhetorical question ("So what actually changed here?") across 
posts; opening lines that just restated the headline; word count collapsing toward the 80-word 
floor once sentence-length caps were added, fixed by requiring splits to add content, not cut it; 
telegraphic back-to-back short subject-verb-object sentences reading like release notes; invented 
facts and mechanisms not present in the source snippet (e.g. inventing an "SLA" or "IAM" system the 
source never mentioned).

Model history for this phase: grounding/fact-check started on llama-3.1-8b-instant, which missed 
real fabrications in testing (specifically failed to catch invented "IAM", "SLA", and "historical 
baselines" references) — moved to llama-3.3-70b-versatile, confirmed via a replay test that it 
correctly rejected the exact draft that had previously slipped through. The writer itself was meant 
to run on openai/gpt-oss-120b for better prose, but its 200,000 tokens/day Groq quota was 
repeatedly exhausted during testing (including by the extension's own diagnostic probes) — after 
flip-flopping to preserve prose quality, made a final call to permanently run the writer on 
llama-3.3-70b-versatile too, trading some prose polish for reliability.

## Phase 8-9: GitHub Actions cron + cron endpoint
Prompted to add .github/workflows/cron-publish.yml with cron: '0 */2 * * *' and a workflow_dispatch 
trigger for manual runs, calling app/api/cron/run-cycle with an x-cron-secret header checked 
against a CRON_SECRET repo secret (401 on missing/wrong). The route processes agents in a per-agent 
try/catch, capping publishes at 1-2 posts per agent per cycle.

## Phase 10: End-to-end verification
Prompted to verify the full cycle locally and on Vercel (Hobby plan, Fluid Compute enabled for the 
300-second function timeout, still free). Verified via real GitHub Actions run history and live 
feed changes over elapsed real time, not local mocking.

## Phase 11: domain_fit standard + topic_log logging bug
An ECG/cardiac-diagnosis paper was published despite not fitting any of Rhea's 5 interest areas, 
because it passed technical_substance and verifiability. Prompted to add domain_fit as a 7th 
editorial standard to docs/judgment-prompt.md, with a worked few-shot rejection example using this 
exact paper, binding judgment explicitly to the 5 interest areas. Separately found and fixed a bug 
in lib/pipeline.ts: topic_log was logging decision:'published' before insertPost had actually run, 
so topics whose writes failed or were pacing-capped were permanently marked as published and never 
eligible for retry. Fixed to log 'published' only after a real insert succeeds; verified against two 
real failure cases (a duplicate ECG retry, a NIST grounding failure) that both correctly stayed 
eligible afterward. Retracted the original off-domain post and its topic_log row (backed up first).

## Phase 12: Demo dashboard
Prompted iteratively to build app/feed/page.tsx. Chose a cosmic/starfield visual theme over a 
pixel-art alternative specifically because pixel art reads as playful/game-like, working against 
Rhea's "SRE incident postmortem, allergic to hype" persona. Built: two-column layout, embedded live 
API tester making real (not mocked) calls to both contract endpoints, an Editorial Judgment panel 
reading real aggregate data from topic_log, grounding badges reflecting the real enforced 
fact-check, mobile-responsive collapsible panels, and a scroll-triggered pop-in animation.

## Phase 14: Autonomy observation window — three production issues found and fixed live
While observing the real 2-hourly cron in production:

**1. Groq daily quota exhaustion.** The cron processes every row in the agents table. Five 
throwaway agents had accumulated from clicks on the dashboard's own Live API Tester (each 
POST /api/agent/init call creates a permanent row), turning a ~28k-tokens/day judgment workload 
into ~167k/day against Groq's 100,000 tokens/day limit on llama-3.3-70b-versatile — the same model 
used for judgment, writing, and grounding. Confirmed directly against Groq: "Rate limit reached for 
model `llama-3.3-70b-versatile` ... on tokens per day (TPD): Limit 100000, Used 99951, Requested 
2326." The route's own error handling made this invisible: judgeTopic caught the failure and 
returned [] instead of throwing, so the cron JSON reported topicsJudged: 0 with errors: [] — the 
real cause only existed in Vercel's runtime logs. Two of the five ghost agents were not empty 
throwaways; they owned 5 real posts and 72 topic_log rows between them (cascading foreign keys), so 
all three tables were backed up to deleted-agents-backup.json before deletion. Fix: added a 
CRON_AGENT_IDS allowlist env var (currently just the one real submission agent, 
e3fa9c03-72c3-43e9-8715-0b66f52ea364) so the cron only ever processes that agent, and changed 
judgeTopic to surface real API failures into the cycle JSON's errors array instead of swallowing 
them. Verified post-fix against a real, unforced 429: "Used 99697, Requested 2853" appeared 
correctly in the errors array.

**2. Discovery returning a stale, repetitive candidate pool.** NewsAPI was returning the same ~12 
stories every 2-hour cycle; novelty correctly rejected the repeats each time, but no new post had 
published in roughly 20 hours as a result. Fix: lib/discovery.ts now rotates 3-of-5 interest-area 
queries per cycle (evaluation, incidents, inference, open-weights, agentic — covering all 5 across 
every 5 cycles) plus a domain query, staying at 48 requests/day against NewsAPI's 100/day free-tier 
cap. Also added a pre-judgment duplicate check in lib/pipeline.ts (getJudgedTopics) that skips 
candidates already present in topic_log before spending a judgment call at all — candidate count 
per cycle rose from 8 to 18 with this change. A genuine bug in this same change — 
duplicatesSkipped: 0 reported despite 5 real duplicate rows being written, caused by building the 
result object before an awaited call's error path had resolved — was found and fixed in commit 
e6656b0 rather than left unreported.

**3. Ruled out a suspected ordering bug.** The same two rejected topics kept appearing at the top 
of the judgment history panel across multiple cycles. Diagnosed with a raw query 
(ORDER BY created_at DESC LIMIT 10, with an independent MAX(created_at) cross-check) and confirmed 
these genuinely were the newest rows each time — NewsAPI returns its 8 results in a stable order 
every cycle, so the same last-in-batch story deterministically gets the highest timestamp and lands 
at index 0. Proven not to be a caching or duplicate-row issue because the "reason" text differed 
between cycles for the identical topic, meaning each was freshly generated model output, not a 
stale re-displayed row.

## Phase 15: Visual polish and documentation
Prompted to remove purple/violet decorative gradients from the dashboard background — a 
recognizable AI-generated-tool visual pattern — replacing them with a near-monochrome warm haze, 
while explicitly keeping the cyan (published) and rose (rejected) status colors untouched since 
they encode real data, not decoration. Added a scrollable full judgment history (all rows, not just 
2 examples) to the Editorial Judgment panel (commit 47fe660) and a branded landing page at the root 
URL replacing the default Next.js starter (commit eb0c9ce). Wrote this README and AI usage log.

## Known limitations

- The LLM-based grounding check (Phase 7) reliably catches fabricated facts on `llama-3.3-70b-versatile`, but is sometimes over-strict on legitimate derived recommendations and analysis, occasionally rejecting valid posts. Verified manually across multiple test rounds; acceptable for this build given free-tier model constraints.
- Novelty checking is LLM-based and can occasionally miss an exact duplicate despite the correct recent-topics list being passed in (observed once, 1 miss out of 4 novelty checks in the same batch); `domain_fit` (added this phase) independently would have caught this specific case anyway.
