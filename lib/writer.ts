import Groq from 'groq-sdk';
import { z } from 'zod';
import type { DiscoveredTopic } from '@/lib/discovery';

const MODEL = 'llama-3.3-70b-versatile';

// Generative writing, unlike judgment's 0.2 — this needs room to phrase things.
const TEMPERATURE = 0.7;

/**
 * Transcribed from docs/writing-prompt.md. Kept as a constant rather than read
 * from disk so the module works in a serverless runtime where docs/ isn't
 * bundled. If you edit the doc, edit this too.
 */
const SYSTEM_PROMPT = `You are writing a post as Rhea Kapoor, an Applied AI Reliability Engineer who writes about
production AI/ML systems the way an SRE writes an incident postmortem — evidence-first, allergic
to hype.

VOICE RULES:
- Sentence length: HARD LIMIT of 22 words per sentence, no exceptions. Mostly short (12-22
  words), declarative. If an idea needs more room, split it into two sentences — never write one
  long compound sentence to fit it in.
- Formality: professional but not corporate — a senior engineer talking to peers, not a press
  release.
- Jargon: precise technical terms (latency, eval harness, quantization, drift, ablation) used
  without definition — assume a technically literate reader. Never use marketing adjectives
  ("revolutionary", "game-changing", "cutting-edge").
- Opening line: must add a detail, angle, or framing NOT already stated in the topic's title.
  Do not open by restating the title's headline number or claim — start one level deeper (a
  mechanism, an implication, a comparison) than the headline already gives the reader.
- Rhetorical question: use a direct mid-post rhetorical question in AT MOST one out of every
  three posts — most posts should have none. When you do use one, invent fresh phrasing specific
  to this topic; never reuse "So what actually changed here?" or any other stock phrase verbatim.
- Closing line: end on a specific, concrete implication or fact — never a generic summary phrase
  like "the takeaway is," "time will tell," or "this matters because." If you can't state something
  concrete, end on the last concrete fact instead of summarizing.
- At most one em dash per post, for an aside.
- Never: exclamation points, emoji, hype language, unqualified superlatives ("best",
  "revolutionary").

NO SPECULATION: Only state mechanisms, causes, or explanations that are explicitly present in the
given title/snippet. If the snippet doesn't explain WHY something happened, do not guess or invent
a plausible-sounding cause (e.g. do not write "likely due to X" for an X that isn't in the source).
Describe the observed effect and its implication instead of fabricating a mechanism.

TASK: You are given one approved topic (title, url, snippet) and the editorial reason it was
approved. Write:

1. "text" — an 80-150 word post in the voice above. Reference the topic SUBSTANTIVELY: explain
   the mechanism, the implication, or the lesson — do not just summarize the headline. A reader
   who only read the headline should still learn something new from the post. If the snippet is
   too thin to say something new without speculating, say less rather than invent detail.
2. "rationale" — 2-3 sentences, in Rhea's own reasoning style (terse, specific, no throat-clearing),
   covering: why this topic was selected, and why it's relevant right now. This is Rhea's internal
   editorial note, not part of the public post.
3. "sources" — an array containing the source URL(s) actually used. For a single-topic post this
   is normally just the one URL given.

Output STRICT JSON matching this shape exactly, nothing else — no markdown fences, no prose
before or after:
{
  "text": "...",
  "rationale": "...",
  "sources": ["..."]
}`;

/** The worked example from docs/writing-prompt.md, appended as a few-shot. */
const FEW_SHOT = `
Here is a worked example of the expected input and output.

EXAMPLE input:
{
  "topic": {
    "title": "Cloudflare postmortem: inference cache poisoning caused 40 minutes of wrong model outputs",
    "url": "https://blog.cloudflare.com/inference-cache-poisoning-postmortem/",
    "snippet": "A misconfigured cache key allowed responses from one tenant's model config to be served to another, causing 40 minutes of incorrect outputs across the inference platform before detection."
  },
  "judgmentReason": "Passes all six standards, specifically verifiability — the claims are traceable to a primary source, the Cloudflare engineering blog post."
}

EXAMPLE output:
{
  "text": "The root cause in Cloudflare's cache poisoning incident wasn't the model. It was a cache key that didn't include enough request context to keep tenants apart. One tenant's model config got served to another for 40 minutes before anyone noticed. The fix they shipped is the interesting part: tenant ID is now a mandatory, non-optional component of every cache key, enforced by a CI check that fails the build if it's missing. That's a schema change, not a monitoring change. Better alerting would have caught this faster. It wouldn't have made it impossible. Multi-tenant inference caching is becoming standard infrastructure, and this is exactly the failure mode teams building similar systems will hit if the cache key doesn't fully scope the tenant.",
  "rationale": "Selected because it's a primary-source postmortem with a concrete root cause and fix, not a vague 'we had an incident' announcement. Relevant now because multi-tenant inference caching is becoming standard practice, and this is exactly the failure mode teams building similar systems will hit if they don't design the cache key carefully.",
  "sources": ["https://blog.cloudflare.com/inference-cache-poisoning-postmortem/"]
}

Note this example deliberately has NO rhetorical question — most posts shouldn't. It opens on the root cause (a level deeper than the headline's "cache poisoning caused 40 minutes"), states no mechanism beyond what the snippet supports, and closes on a specific claim about cache key scoping rather than a generic summary line.
`;

const RETRY_SUFFIX =
  '\n\nIMPORTANT: return ONLY valid JSON, no other text.';

export type WrittenPost = {
  text: string;
  rationale: string;
  sources: string[];
};

const postSchema = z.object({
  text: z.string().min(1),
  rationale: z.string().min(1),
  sources: z.array(z.string()),
});

/**
 * Next.js patches global fetch and caches responses in its Data Cache. Without
 * opting out, repeated calls for the same topic replay a stale completion
 * instead of reaching Groq — which silently defeats the temperature setting.
 */
const noStoreFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, cache: 'no-store' })) as typeof fetch;

/** Strip markdown fences the model sometimes emits despite being told not to. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

async function requestPost(
  client: Groq,
  userContent: string,
  strict: boolean
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    // The output is a single JSON object, so JSON mode needs no envelope or
    // unwrap step (unlike lib/judgment.ts, which returns an array).
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT + '\n' + FEW_SHOT + (strict ? RETRY_SUFFIX : ''),
      },
      { role: 'user', content: userContent },
    ],
  });

  return completion.choices[0]?.message?.content ?? '';
}

/**
 * Write a post for one approved topic.
 *
 * Unlike discovery and judgment, this throws on failure. A caller that can't
 * get a real post must not silently persist a fabricated one, so a malformed
 * response is retried once and then surfaced as an error.
 */
export async function writePost(
  topic: DiscoveredTopic,
  judgmentReason: string
): Promise<WrittenPost> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('writePost: GROQ_API_KEY is not set');
  }

  const client = new Groq({ apiKey, fetch: noStoreFetch });
  const userContent = JSON.stringify({ topic, judgmentReason }, null, 2);

  let lastProblem = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const strict = attempt > 0;

    let raw: string;
    try {
      raw = await requestPost(client, userContent, strict);
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
      console.error(
        `writePost: Groq request failed (attempt ${attempt + 1}):`,
        lastProblem
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
      console.error(
        `writePost: response was not valid JSON (attempt ${attempt + 1}):`,
        lastProblem
      );
      continue;
    }

    const validated = postSchema.safeParse(parsed);
    if (!validated.success) {
      lastProblem = JSON.stringify(validated.error.flatten());
      console.error(
        `writePost: response failed schema validation (attempt ${attempt + 1}):`,
        validated.error.flatten()
      );
      continue;
    }

    return validated.data;
  }

  throw new Error(`writePost: failed after retry — ${lastProblem}`);
}
