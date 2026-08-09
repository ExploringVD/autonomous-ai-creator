import axios from 'axios';
import { PERSONA_BASE } from '@/lib/persona';

const NEWSAPI_ENDPOINT = 'https://newsapi.org/v2/everything';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 8;

/**
 * Merged pool handed to judgment. Larger than one query's worth so several
 * interest areas are represented, but capped: every candidate costs judgment
 * tokens, and the daily Groq budget is the binding constraint.
 */
const MERGED_MAX_RESULTS = 18;

/**
 * Queries run per cycle, drawn from INTEREST_AREA_QUERIES on rotation.
 *
 * NewsAPI's free tier allows 100 requests/day. At 3 per cycle and the cron's
 * 2-hourly schedule that is 36/day, leaving room for manual runs. Raising this
 * to all five areas every cycle would be 60/day, which is under the cap but
 * leaves little slack — and rotating is better anyway, because asking for
 * different areas on different cycles is what surfaces stories a fixed query
 * keeps missing.
 */
const QUERIES_PER_CYCLE = 3;

const AI_ANCHOR =
  '("artificial intelligence" OR "machine learning" OR AI OR LLM OR "language model")';

/**
 * One query per interest area from lib/persona.ts.
 *
 * These are hand-written rather than derived from the prose interest areas.
 * The derived route (buildQuery) ORs every area's terms into a single query,
 * which returns the same broad head of the AI news feed every cycle — the
 * reason discovery kept resurfacing the same dozen stories. Narrower, separate
 * queries reach further down into each area.
 */
const INTEREST_AREA_QUERIES: { area: string; q: string }[] = [
  {
    area: 'evaluation',
    q: `${AI_ANCHOR} AND (benchmark OR benchmarking OR "model evaluation" OR "eval harness" OR leaderboard OR "evaluation methodology" OR "held-out")`,
  },
  {
    area: 'incidents',
    q: `${AI_ANCHOR} AND (postmortem OR "post-mortem" OR outage OR incident OR "model drift" OR "data drift" OR regression OR degradation)`,
  },
  {
    area: 'inference',
    q: `${AI_ANCHOR} AND (inference OR latency OR throughput OR quantization OR serving OR "inference cost" OR "GPU cost")`,
  },
  {
    area: 'open-weights',
    q: `${AI_ANCHOR} AND ("open weight" OR "open-weight" OR "open source model" OR "model release" OR checkpoint OR reproducibility)`,
  },
  {
    area: 'agentic',
    q: `${AI_ANCHOR} AND (agentic OR "AI agent" OR "tool use" OR autonomy OR "agent failure" OR orchestration)`,
  },
];

/**
 * Pick this cycle's queries, advancing the window every two hours so
 * consecutive cron runs ask about different areas.
 *
 * Time-derived rather than stored: it needs no schema change, and the cron's
 * own cadence supplies the tick.
 */
export function queriesForCycle(
  now: number = Date.now()
): { area: string; q: string }[] {
  const total = INTEREST_AREA_QUERIES.length;
  const tick = Math.floor(now / (2 * 60 * 60 * 1000));
  const offset = ((tick % total) + total) % total;

  return Array.from(
    { length: Math.min(QUERIES_PER_CYCLE, total) },
    (_, i) => INTEREST_AREA_QUERIES[(offset + i) % total]
  );
}

/** NewsAPI rejects `q` longer than 500 characters. */
const MAX_QUERY_LENGTH = 500;

/**
 * Package registries and scraper aggregators. They publish constantly and match
 * on keywords, so under sortBy=publishedAt they crowd out actual reporting.
 */
const EXCLUDED_DOMAINS = ['pypi.org', 'biztoc.com'];

export type DiscoveredTopic = {
  title: string;
  url: string;
  snippet: string;
};

type NewsApiArticle = {
  title: string | null;
  url: string | null;
  description: string | null;
  content: string | null;
};

/**
 * NewsAPI truncates `content` and appends a marker like "[+2317 chars]". Strip
 * it so the marker doesn't end up quoted as source material.
 */
function stripTruncationMarker(content: string): string {
  return content.replace(/\[\+\d+\s*chars?\]\s*$/i, '').trim();
}

/**
 * Build the snippet from description plus the (truncated) article body.
 *
 * The description alone is ~40 words, which is too thin for the writer to say
 * anything substantive without inventing detail. `content` adds a few hundred
 * characters of real article text.
 */
function buildSnippet(article: NewsApiArticle): string {
  const description = article.description?.trim() ?? '';
  const content = article.content ? stripTruncationMarker(article.content) : '';

  if (!content) return description;
  if (!description) return content;

  // NewsAPI's content usually opens with the description verbatim.
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  if (normalized(content).indexOf(normalized(description)) === 0) {
    return content;
  }

  return `${description} ${content}`;
}

type NewsApiResponse = {
  status: string;
  articles?: NewsApiArticle[];
};

const STOPWORDS = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'in',
  'to',
  'for',
  'where',
  'with',
  'on',
  'its',
  'their',
]);

/** Short tokens worth keeping that the length filter would otherwise drop. */
const ACRONYMS = new Set(['ml', 'ai']);

/**
 * Single words specific enough to search on their own. Anything else is only
 * kept as part of a multi-word phrase — a bare "production" or "cost" matches
 * arbitrary business news and swamps the results.
 */
const STANDALONE_TERMS = new Set([
  'postmortems',
  'reproducibility',
  'benchmarking',
  'agentic',
  'inference',
  'quantization',
  'latency',
  'drift',
]);

/**
 * Reduce one interest area to searchable terms.
 *
 * The interest areas in lib/persona.ts are written as prose for the editorial
 * prompt ("Model evaluation and benchmarking rigor (and where benchmarks
 * mislead)"). Passed to NewsAPI verbatim they match nothing — it does keyword
 * matching, not semantic search. So: drop the parenthetical gloss, split on
 * connectives, and keep the distinctive content words.
 */
function termsFromInterestArea(area: string): string[] {
  return area
    .replace(/\([^)]*\)/g, ' ')
    .split(/[/,]|\band\b|\bor\b/i)
    .map((chunk) =>
      chunk
        .split(/\s+/)
        .map((word) => word.replace(/[^A-Za-z-]/g, ''))
        .filter((word) => {
          const lower = word.toLowerCase();
          if (STOPWORDS.has(lower)) return false;
          return word.length > 2 || ACRONYMS.has(lower);
        })
        .join(' ')
        .trim()
    )
    .filter((chunk) => {
      if (chunk.length <= 2) return false;
      if (chunk.includes(' ')) return true;
      return STANDALONE_TERMS.has(chunk.toLowerCase());
    });
}

function quoteIfMultiWord(term: string): string {
  return term.includes(' ') ? `"${term}"` : term;
}

/**
 * Build a NewsAPI boolean query: an AI anchor ANDed against the union of the
 * caller's domain and the persona's interest areas. The anchor keeps results
 * inside AI/ML coverage — without it, terms like "evaluation", "inference" and
 * "incidents" pull in unrelated general news.
 */
export function buildQuery(domain: string): string {
  const anchor =
    '("artificial intelligence" OR "machine learning" OR AI OR LLM OR "language model")';

  const interestTerms = PERSONA_BASE.interestAreas.flatMap(termsFromInterestArea);
  const domainTerms = termsFromInterestArea(domain);

  const seen = new Set<string>();
  const topicTerms: string[] = [];
  for (const term of [...domainTerms, ...interestTerms]) {
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      topicTerms.push(quoteIfMultiWord(term));
    }
  }

  // Add terms one at a time so the 500-char cap truncates the query cleanly
  // rather than producing unbalanced parentheses.
  const suffix = ')';
  const prefix = `${anchor} AND (`;
  let topics = '';
  for (const term of topicTerms) {
    const next = topics ? `${topics} OR ${term}` : term;
    if (prefix.length + next.length + suffix.length > MAX_QUERY_LENGTH) break;
    topics = next;
  }

  return topics ? `${prefix}${topics}${suffix}` : anchor;
}

/**
 * Collapse titles that refer to the same thing: package feeds republish every
 * version ("pm-skills 0.38.0", "pm-skills 0.37.0"), and aggregators resyndicate
 * the same story under an identical headline.
 */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bv?\d+(\.\d+)+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Title reduced to a comparison key. Exported so the pipeline can match
 * candidates against already-judged topics using exactly the same notion of
 * "the same story" that discovery uses to dedupe.
 */
export function titleMatchKey(title: string): string {
  return titleKey(title);
}

function normalize(
  articles: NewsApiArticle[],
  limit: number = MAX_RESULTS
): DiscoveredTopic[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const topics: DiscoveredTopic[] = [];

  for (const article of articles) {
    const title = article.title?.trim();
    const url = article.url?.trim();

    // NewsAPI tombstones withdrawn articles as "[Removed]" rather than
    // omitting them.
    if (!title || !url || title === '[Removed]') continue;
    if (seenUrls.has(url)) continue;

    const key = titleKey(title);
    if (key && seenTitles.has(key)) continue;

    seenTitles.add(key);
    seenUrls.add(url);
    topics.push({
      title,
      url,
      snippet: buildSnippet(article),
    });

    if (topics.length >= limit) break;
  }

  return topics;
}

/**
 * Fetch recent articles relevant to `domain` and the persona's interest areas.
 *
 * Never throws. A failed discovery cycle returns [] so the pipeline can skip
 * the run instead of crashing.
 */
async function fetchArticles(
  apiKey: string,
  q: string,
  label: string
): Promise<NewsApiArticle[]> {
  try {
    const response = await axios.get<NewsApiResponse>(NEWSAPI_ENDPOINT, {
      params: {
        q,
        sortBy: 'publishedAt',
        language: 'en',
        // Without this NewsAPI matches full body text, which surfaces package
        // indexes and journal feeds that merely mention the terms in passing.
        searchIn: 'title,description',
        excludeDomains: EXCLUDED_DOMAINS.join(','),
        pageSize: MAX_RESULTS * 3,
      },
      headers: { 'X-Api-Key': apiKey },
      timeout: REQUEST_TIMEOUT_MS,
      // Inspect non-2xx ourselves instead of letting axios throw.
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      console.error(
        `discoverTopics[${label}]: NewsAPI returned ${response.status}`,
        response.data
      );
      return [];
    }

    const articles = response.data?.articles;
    if (!Array.isArray(articles)) {
      console.error(
        `discoverTopics[${label}]: unexpected NewsAPI payload shape`
      );
      return [];
    }

    return articles;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `discoverTopics[${label}]: NewsAPI request failed:`,
      message
    );
    return [];
  }
}

/**
 * Fetch recent articles across a rotating subset of the persona's interest
 * areas, plus the caller's own domain.
 *
 * Never throws. One query failing costs only that query's results — the rest
 * of the cycle still runs — and a total failure returns [].
 */
export async function discoverTopics(
  domain: string
): Promise<DiscoveredTopic[]> {
  const apiKey = process.env.NEWSAPI_KEY;

  if (!apiKey) {
    console.error('discoverTopics: NEWSAPI_KEY is not set');
    return [];
  }

  const queries = [
    ...queriesForCycle(),
    { area: 'domain', q: buildQuery(domain) },
  ];

  const results = await Promise.all(
    queries.map(({ area, q }) => fetchArticles(apiKey, q, area))
  );

  // Interleave rather than concatenate: taken in order, the first query's
  // results would fill the cap before any later area was reached.
  const merged: NewsApiArticle[] = [];
  const longest = Math.max(0, ...results.map((r) => r.length));
  for (let i = 0; i < longest; i += 1) {
    for (const result of results) {
      if (i < result.length) merged.push(result[i]);
    }
  }

  // normalize dedupes by url and by title key across the merged pool.
  return normalize(merged, MERGED_MAX_RESULTS);
}
