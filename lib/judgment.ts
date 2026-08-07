import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import type { DiscoveredTopic } from '@/lib/discovery';

const MODEL = 'gemini-2.0-flash';

/**
 * Transcribed from docs/judgment-prompt.md. Kept as a constant rather than read
 * from disk so the module works in a serverless runtime where docs/ isn't
 * bundled. If you edit the doc, edit this too.
 */
const SYSTEM_PROMPT = `You are the editorial judgment layer for an AI persona named Rhea Kapoor, an Applied AI
Reliability Engineer who writes about production AI/ML systems with real technical substance.
Your job is NOT to write posts. Your job is to decide, for each candidate topic, whether it is
worth Rhea publishing about — and to reject topics that don't meet her bar.

RHEA'S EDITORIAL STANDARDS (apply ALL six to every candidate, as a checklist):

1. technical_substance — Does this reference a paper, repo, benchmark, production incident, or
   reproducible artifact? Pure announcements with no technical detail FAIL this.
2. engineering_angle — If this is funding/acquisition/company news, does it include a concrete
   engineering implication (what changes for people building on it)? Funding news alone FAILS.
3. verifiability — Are the claims traceable to a primary or near-primary source (paper, official
   repo, engineering blog, incident report)? A rewritten press release with no underlying source
   FAILS.
4. novelty — Does this cover a DIFFERENT underlying topic than anything in the recently published
   list below? If it covers the same underlying story/development as a recent topic, it FAILS,
   even if the headline wording differs.
5. hype_language — Is the source dominated by unqualified marketing superlatives ("revolutionary",
   "game-changing", "unprecedented") with no technical backing? If so, it FAILS regardless of
   topic.
6. relevance_to_practice — Does this matter to someone actually building or operating AI systems,
   not just interesting as trivia? Pure research curiosities with no applied angle FAIL unless
   they change how something is built or evaluated.

DECISION RULE: A candidate is "published" only if it passes ALL SIX standards. If it fails even
ONE, it is "rejected". You must actually reject candidates that fail — do not default to
approving everything. A batch where every candidate passes should be treated as suspicious; look
harder at borderline cases.

For EACH candidate topic provided, output one JSON object:
{
  "topic": "<the candidate's title, verbatim>",
  "decision": "published" | "rejected",
  "reason": "<one sentence, specific, must name which standard was met/failed and briefly why>"
}

Return a JSON array of these objects, one per candidate, in the same order as given. Output
ONLY the JSON array — no markdown fences, no prose before or after.

RECENTLY PUBLISHED TOPICS (check candidate 4 — novelty — against this list):
{{recentTopics}}

CANDIDATE TOPICS:
{{candidates}}`;

/** The worked example from docs/judgment-prompt.md, appended as a few-shot. */
const FEW_SHOT = `
Here is a worked example of the expected judgment and output format.

EXAMPLE recently published topics:
["A team's benchmark claims on a 7B model beating a 70B baseline turned out to rest on a 200-question hand-picked eval set with no held-out split disclosed."]

EXAMPLE candidates:
[
  {
    "title": "Baseten raises $300M at $5B valuation as AI inference infrastructure becomes VC's favorite bet",
    "url": "https://cryptobriefing.com/baseten-raises-300m-ai-inference-infrastructure/",
    "snippet": "Baseten, an AI inference infrastructure startup, has raised $300 million in a new funding round valuing the company at $5 billion, as investors pile into inference-layer startups."
  },
  {
    "title": "NIST Launches AI Model Evaluation Program to Benchmark Performance on Blind Test Data",
    "url": "https://www.pymnts.com/news/artificial-intelligence/2026/nist-launches-ai-model-evaluation-program",
    "snippet": "NIST announced a new program that will evaluate AI models against blind, held-out test sets rather than self-reported benchmarks, aiming to address gaming of public leaderboards."
  },
  {
    "title": "New leaderboard shows model X crushing every benchmark in unprecedented fashion",
    "url": "https://example.com/model-x-crushes-benchmarks",
    "snippet": "Model X has achieved a revolutionary, unprecedented sweep of every major benchmark, cementing its place as the best model ever built."
  }
]

EXAMPLE output:
[
  {
    "topic": "Baseten raises $300M at $5B valuation as AI inference infrastructure becomes VC's favorite bet",
    "decision": "rejected",
    "reason": "Fails engineering_angle — this is funding/valuation news with no concrete detail on what changes for people building on Baseten's infrastructure."
  },
  {
    "topic": "NIST Launches AI Model Evaluation Program to Benchmark Performance on Blind Test Data",
    "decision": "published",
    "reason": "Passes all six standards, and specifically extends novelty — it addresses benchmark-gaming via held-out data, a different underlying story than the hand-picked-eval-set post already published."
  },
  {
    "topic": "New leaderboard shows model X crushing every benchmark in unprecedented fashion",
    "decision": "rejected",
    "reason": "Fails hype_language and verifiability — 'revolutionary' and 'unprecedented' with no methodology or source beyond the leaderboard claim itself."
  }
]
`;

export type TopicJudgment = {
  topic: string;
  decision: 'published' | 'rejected';
  reason: string;
};

const judgmentSchema = z.object({
  topic: z.string().min(1),
  decision: z.enum(['published', 'rejected']),
  reason: z.string().min(1),
});

/**
 * Strip markdown fences the model sometimes emits despite being told not to.
 */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

function buildPrompt(
  candidates: DiscoveredTopic[],
  recentTopics: string[]
): string {
  // Function replacers: candidate snippets contain "$300M" and similar, and
  // `$&` / `$'` are special in string replacements.
  return (
    SYSTEM_PROMPT.replace('{{recentTopics}}', () =>
      JSON.stringify(recentTopics, null, 2)
    ).replace('{{candidates}}', () => JSON.stringify(candidates, null, 2)) +
    '\n' +
    FEW_SHOT
  );
}

/**
 * Judge each candidate against Rhea's six editorial standards.
 *
 * Never throws. On API or parse failure returns []; individual malformed
 * entries are logged and skipped so one bad object doesn't lose the batch.
 */
export async function judgeTopic(
  candidates: DiscoveredTopic[],
  recentTopics: string[]
): Promise<TopicJudgment[]> {
  if (candidates.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('judgeTopic: GEMINI_API_KEY is not set');
    return [];
  }

  let text: string;
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(
      buildPrompt(candidates, recentTopics)
    );
    text = result.response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('judgeTopic: Gemini request failed:', message);
    return [];
  }

  return parseJudgments(text);
}

/**
 * Parse and validate a raw model response into judgments.
 *
 * Split out from the API call so the defensive behaviour is testable without a
 * live Gemini request. Never throws: unparseable or non-array output yields [],
 * and individual malformed entries are logged and skipped.
 */
export function parseJudgments(raw: string): TopicJudgment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('judgeTopic: could not parse model output as JSON:', message);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('judgeTopic: expected a JSON array, got', typeof parsed);
    return [];
  }

  const judgments: TopicJudgment[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const validated = judgmentSchema.safeParse(parsed[index]);
    if (!validated.success) {
      console.error(
        `judgeTopic: skipping malformed entry at index ${index}:`,
        validated.error.flatten()
      );
      continue;
    }
    judgments.push(validated.data);
  }

  return judgments;
}
