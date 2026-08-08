import Groq from 'groq-sdk';
import { z } from 'zod';
import type { DiscoveredTopic } from '@/lib/discovery';

// Writer-specific. lib/judgment.ts stays on llama-3.3-70b-versatile — that's a
// classification task and it performs well there.
const MODEL = 'openai/gpt-oss-120b';

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
- Sentence length: no sentence may exceed 22 words. If an idea needs more room, split it into two
  sentences — but the split must ADD words (explain the mechanism, add a comparison, spell out the
  implication), never cut content down to fit. Splitting a sentence is not a license to shorten the
  post.
- Post length is a firm requirement, not a suggestion: 80-150 words, and normally 8-12 sentences.
  Short declarative sentences do not mean a short post. Each sentence should do real work — a fact,
  a mechanism, a comparison, a consequence, what a practitioner should watch for — not restate the
  previous sentence in fewer words. If you're tracking below 80 words, you have not run out of
  things to say: add the implication, or what someone operating a similar system should take from
  this — using only what the source actually states, never an invented number, system name, or
  mechanism to pad length. Do not stop early just because you've covered the headline fact, and do
  not invent detail just because you haven't hit 80 words yet — a post that ends at 75 honest words
  is correct behavior if the source is genuinely that thin.
- DO NOT write a string of short, isolated subject-verb-object sentences back to back (e.g. "It
  tracks prediction quality. It also detects drift. This is useful."). That is release-notes
  style, not Rhea's voice, even though each sentence is technically under 22 words. Instead, vary
  rhythm: combine two or three related facts into one sentence using commas or "and"/"but", as
  long as the combined sentence still stays under 22 words. A good post mixes some short sentences
  for punch with a few medium ones (15-22 words) that connect two ideas — it should never read as
  a bulleted list with the bullets removed.
- Formality: professional but not corporate — a senior engineer talking to peers, not a press
  release.
- Jargon: precise technical terms (latency, eval harness, quantization, drift, ablation) used
  without definition — assume a technically literate reader. Never use marketing adjectives
  ("revolutionary", "game-changing", "cutting-edge").
- Opening line: must add a detail, angle, or framing NOT already stated in the topic's title.
  Do not open by restating the title's headline number or claim — start one level deeper (a
  mechanism, an implication, a comparison) than the headline already gives the reader. Concretely:
  if the title is "X shows Y", do not open with "X shows Y" reworded ("X's harness shows Y" /
  "Y is documented by X" are still restatements). Open instead with the root cause, the fix, the
  consequence, or a comparison — something the title itself does not already tell the reader.
- Rhetorical question: use a direct mid-post rhetorical question in AT MOST one out of every
  three posts — most posts should have none. When you do use one, invent fresh phrasing specific
  to this topic; never reuse "So what actually changed here?" or any other stock phrase verbatim.
- Closing line: end on a specific, concrete implication or fact — never a generic summary phrase.
  Banned closing patterns, including but not limited to: "the takeaway is," "time will tell,"
  "this matters because," "is a best practice," "is crucial," "is key," "helps ensure/maintain,"
  or any sentence that could be pasted onto a different post unchanged. If you can't state
  something concrete, end on the last concrete fact instead of summarizing or generalizing.
- At most one em dash per post, for an aside.
- Never: exclamation points, emoji, hype language, unqualified superlatives ("best",
  "revolutionary").

NO FABRICATION (read this carefully, it is the most important rule): Every specific fact in your
post — every number, percentage, named system, tool, service, company, metric name, or technical
mechanism — must appear in the given title/snippet, or be a word-for-word/close paraphrase of
something that does. This applies whether you state it as a hedge ("may involve X") or as a flat
assertion ("uses X"). Flat, confident assertion of an invented fact is a WORSE violation than a
hedged guess, not a safer one — do not "solve" the hedging rule by asserting invented specifics
instead of guessing them.

Concretely: if the snippet says a system "tracks prediction quality and detects drift," you may
restate and discuss exactly that. You may NOT invent the storage layer it uses, the alerting
mechanism, a metric name, a percentage, a threshold, or an architecture diagram in your head —
even if it's a plausible guess at how such a system would typically work. If you don't know
something, you are not allowed to know it for the purposes of this post. Write about what IS
stated: the effect, its stakes, and what it implies for someone operating a similar system —
using only entities and numbers named in the source. A shorter, sparser-on-detail post that is
100% traceable to the source beats a richer-sounding one with invented specifics, every time —
Rhea's whole identity is that she doesn't do the second thing.

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
  "text": "The root cause in Cloudflare's cache poisoning incident wasn't the model. It was a cache key that didn't include enough request context to keep tenants apart. One tenant's model config got served to another for 40 minutes before anyone noticed. The fix they shipped is the interesting part: tenant ID is now a mandatory, non-optional component of every cache key. A CI check fails the build if it's missing. That's a schema change, not a monitoring change. Better alerting would have caught this faster, but it wouldn't have made the bug impossible. Multi-tenant inference caching is becoming standard infrastructure. This is exactly the failure mode teams building similar systems will hit if their own cache key doesn't fully scope the tenant. Worth checking your own cache keys against this before it's your postmortem.",
  "rationale": "Selected because it's a primary-source postmortem with a concrete root cause and fix, not a vague 'we had an incident' announcement. Relevant now because multi-tenant inference caching is becoming standard practice, and this is exactly the failure mode teams building similar systems will hit if they don't design the cache key carefully.",
  "sources": ["https://blog.cloudflare.com/inference-cache-poisoning-postmortem/"]
}

Note this example deliberately has NO rhetorical question — most posts shouldn't. It opens on the root cause (a level deeper than the headline's "cache poisoning caused 40 minutes"), states no mechanism beyond what the snippet supports, and closes on a specific claim about cache key scoping rather than a generic summary line.
`;

const RETRY_SUFFIX =
  '\n\nIMPORTANT: return ONLY valid JSON, no other text.';

/** The prompt's stated target. */
const TARGET_MIN_WORDS = 80;
const TARGET_MAX_WORDS = 150;

/**
 * Accepted band, slightly wider than the target. Length is a quality bar, not a
 * correctness one — a post a few words outside the target still ships.
 */
const ACCEPT_MIN_WORDS = 75;
const ACCEPT_MAX_WORDS = 155;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The model sometimes returns the post as indented lines inside the JSON string,
 * and emits typographic hyphens (U+2011 and friends) inside terms like
 * "100k-token". These posts are single-paragraph ASCII prose, so collapse
 * whitespace runs and fold the exotic dashes down to "-".
 *
 * The em dash (U+2014) is left alone — the voice rules allow one per post.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[‐‑‒–−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that are capitalized often enough mid-prose that treating them as proper
 * nouns produces noise rather than signal.
 */
const CAPITALIZED_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'It', 'Its', 'A', 'An', 'And',
  'But', 'Or', 'If', 'When', 'While', 'Because', 'Without', 'With', 'For',
  'From', 'At', 'In', 'On', 'By', 'To', 'As', 'So', 'Below', 'Above',
  'Success', 'Trace', 'Keeping', 'Deploying', 'Nightly', 'Worth', 'Better',
  'Each', 'Every', 'One', 'Two', 'Both', 'Not', 'No', 'Only', 'Instead',
  'There', 'Here', 'What', 'Which', 'Who', 'How', 'Why', 'Where',
  // Sentence-initial connectives. Without these, an ordinary opener followed by
  // a real proper noun ("Until Anthropic ...") is misread as a fabricated
  // entity — and since fabrication is a hard failure, that aborts the post.
  'Until', 'Since', 'After', 'Before', 'During', 'Although', 'Though',
  'Even', 'Once', 'Unless', 'Rather', 'Given', 'Across', 'Beyond', 'Within',
  'Under', 'Over', 'Between', 'Despite', 'Yet', 'Still', 'Now', 'Then',
  'First', 'Second', 'Third', 'Finally', 'However', 'Moreover', 'Meanwhile',
  'Their', 'Our', 'Your', 'They', 'His', 'Her', 'Anybody', 'Someone',
  'Anyone', 'Teams', 'Engineers', 'Operators', 'Running', 'Treating',
  'Reproducing', 'Publishing', 'Adding', 'Using', 'Building', 'Measuring',
]);

/**
 * Pull out the specifics worth verifying against the source: numbers, all-caps
 * acronyms, and multi-word capitalized phrases.
 *
 * Deliberately ignores lone capitalized words — a sentence-initial "Drift" is
 * not a proper noun, and flagging it would bury the real finds. Multi-word
 * phrases, acronyms and numbers are what caught the actual fabrications
 * ("CloudWatch", "MTTR", "94%").
 */
export function extractSpecifics(text: string): string[] {
  const found: string[] = [];
  const seen: Record<string, true> = {};
  const add = (value: string) => {
    if (value && !seen[value]) {
      seen[value] = true;
      found.push(value);
    }
  };

  // Numbers, percentages, and shorthand magnitudes (100k, 3.5, 12%).
  const numbers =
    text.match(/\b\d+(?:\.\d+)?k\b|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b/gi) ?? [];
  numbers.forEach(add);

  // All-caps acronyms of 2+ letters (SLA, MTTR).
  (text.match(/\b[A-Z]{2,}[0-9]*\b/g) ?? []).forEach(add);

  // Internally-capitalized single tokens (CloudWatch, SageMaker, GitHub).
  (text.match(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g) ?? []).forEach(add);

  // Multi-word capitalized sequences (Amazon Quick, Anthropic Labs).
  const phrases =
    text.match(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+\b/g) ?? [];
  phrases.forEach((phrase) => {
    const words = phrase.split(/\s+/);
    // Drop a leading sentence-initial stopword ("Below 80k" -> "80k").
    const trimmed = CAPITALIZED_STOPWORDS.has(words[0])
      ? words.slice(1).join(' ')
      : phrase;
    if (trimmed.indexOf(' ') !== -1) add(trimmed);
  });

  return found;
}

/** Normalize for comparison: lowercase, fold dashes, collapse whitespace. */
function forMatching(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ');
}

/**
 * Specifics asserted in the post that do not appear anywhere in the source.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-token match. A plain substring test is unsafe here: "CI" would be
 * "found" inside "reproducible", silently clearing a fabricated term.
 */
function containsToken(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'i').test(
    haystack
  );
}

export function findFabricatedSpecifics(
  text: string,
  sourceText: string
): string[] {
  const source = forMatching(sourceText);
  return extractSpecifics(text).filter((candidate) => {
    const needle = forMatching(candidate);
    if (containsToken(source, needle)) return false;
    // "100k-token" is supported by a source that says "100k tokens", so retry
    // with separators removed on both sides — still whole-token, not substring.
    const collapse = (s: string) => s.replace(/[\s-]+/g, '');
    return !containsToken(collapse(source), collapse(needle));
  });
}

function fabricationRetryInstruction(terms: string[]): string {
  return `\n\nYour previous response contained specifics that do not appear in the given title, snippet, or judgment reason: ${terms
    .map((t) => `"${t}"`)
    .join(
      ', '
    )}. Remove them and restate using only facts present in the source. Do not substitute different invented specifics.`;
}

function lengthRetryInstruction(words: number): string {
  return words < TARGET_MIN_WORDS
    ? `\n\nYour previous response was too short at ${words} words; the post must be ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} words, add more supportable detail about the implication or context.`
    : `\n\nYour previous response was too long at ${words} words; the post must be ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} words, tighten it without dropping supportable detail.`;
}

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
  extraInstruction: string
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
        content: SYSTEM_PROMPT + '\n' + FEW_SHOT + extraInstruction,
      },
      { role: 'user', content: userContent },
    ],
  });

  return completion.choices[0]?.message?.content ?? '';
}

/**
 * Write a post for one approved topic.
 *
 * Throws only when no valid post could be produced. A caller that can't get a
 * real post must not silently persist a fabricated one, so a malformed response
 * is retried once and then surfaced as an error.
 *
 * Two post-generation checks, with deliberately different severities:
 *
 * - Fabrication (hard): any number, acronym or proper noun asserted in the post
 *   but absent from title/snippet/judgmentReason triggers one corrective retry,
 *   then throws. A post with invented facts is never returned.
 * - Length (soft): a post outside the accepted band is retried once, but if the
 *   retry still misses it is returned with a warning.
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
  // Everything the post is allowed to assert as fact.
  const sourceText = [topic.title, topic.snippet, judgmentReason].join('\n');

  let lastProblem = '';
  let extraInstruction = '';
  // A valid post that only missed the length band, kept in case the retry
  // produces nothing usable at all.
  let outOfRangePost: WrittenPost | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await requestPost(client, userContent, extraInstruction);
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
      console.error(
        `writePost: Groq request failed (attempt ${attempt + 1}):`,
        lastProblem
      );
      extraInstruction = RETRY_SUFFIX;
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
      extraInstruction = RETRY_SUFFIX;
      continue;
    }

    const validated = postSchema.safeParse(parsed);
    if (!validated.success) {
      lastProblem = JSON.stringify(validated.error.flatten());
      console.error(
        `writePost: response failed schema validation (attempt ${attempt + 1}):`,
        validated.error.flatten()
      );
      extraInstruction = RETRY_SUFFIX;
      continue;
    }

    const post: WrittenPost = {
      ...validated.data,
      text: normalizeWhitespace(validated.data.text),
      rationale: normalizeWhitespace(validated.data.rationale),
    };

    // Fabrication is checked before length, and is never tolerated: a post with
    // invented specifics must not reach the caller even once.
    const fabricated = findFabricatedSpecifics(post.text, sourceText);
    if (fabricated.length > 0) {
      lastProblem = `fabricated specifics: ${fabricated.join(', ')}`;
      if (attempt === 0) {
        console.warn(
          `writePost: response contained specifics absent from the source (${fabricated.join(
            ', '
          )}); retrying once`
        );
        extraInstruction = fabricationRetryInstruction(fabricated);
        // Deliberately not kept as a fallback — an unsupported post is worse
        // than no post.
        outOfRangePost = null;
        continue;
      }

      throw new Error(
        `writePost: retry still contained specifics absent from the source: ${fabricated.join(
          ', '
        )}`
      );
    }

    const words = countWords(post.text);

    if (words >= ACCEPT_MIN_WORDS && words <= ACCEPT_MAX_WORDS) {
      return post;
    }

    if (attempt === 0) {
      console.warn(
        `writePost: post was ${words} words, outside ${ACCEPT_MIN_WORDS}-${ACCEPT_MAX_WORDS}; retrying once`
      );
      outOfRangePost = post;
      extraInstruction = lengthRetryInstruction(words);
      continue;
    }

    console.warn(
      `writePost: retry still ${words} words, outside ${ACCEPT_MIN_WORDS}-${ACCEPT_MAX_WORDS}; keeping it anyway`
    );
    return post;
  }

  if (outOfRangePost) {
    console.warn(
      'writePost: retry produced no valid response; keeping the earlier out-of-range post'
    );
    return outOfRangePost;
  }

  throw new Error(`writePost: failed after retry — ${lastProblem}`);
}
