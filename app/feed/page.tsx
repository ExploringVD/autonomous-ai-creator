'use client';

import { useEffect, useMemo, useState } from 'react';

type Post = {
  id: string;
  createdAt: string;
  text: string;
  rationale: string | null;
  sources: string[];
};

type JudgmentSummary = {
  topicsJudged: number;
  published: number;
  rejected: number;
  recentRejections: { topic: string; reason: string | null }[];
};

type Status = 'loading' | 'ready' | 'error';

type RangeKey = 'all' | '6h' | 'today' | 'yesterday';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '6h', label: 'Past 6 hours' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Buckets a post by the *browser's* local day, not UTC — "Today" has to mean
 * today where the reader is sitting, and createdAt arrives as a UTC ISO string.
 */
function inRange(iso: string, range: RangeKey, now: Date): boolean {
  if (range === 'all') return true;

  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return false;

  if (range === '6h') {
    return now.getTime() - created.getTime() <= 6 * 60 * 60 * 1000;
  }

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const at = created.getTime();

  return range === 'today'
    ? at >= startOfToday
    : at >= startOfYesterday && at < startOfToday;
}

export default function FeedPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [posts, setPosts] = useState<Post[]>([]);
  const [summary, setSummary] = useState<JudgmentSummary | null>(null);
  const [error, setError] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [range, setRange] = useState<RangeKey>('all');
  const [openRationale, setOpenRationale] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  // Read from window rather than useSearchParams: this page is client-only, and
  // useSearchParams would force a Suspense boundary (and a second file).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('agentId')?.trim();

    if (!id) {
      setError('No agentId in the URL. Try /feed?agentId=<uuid>');
      setStatus('error');
      return;
    }

    setAgentId(id);

    let cancelled = false;

    fetch(`/api/agent/feed?agentId=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            body?.error ?? `Request failed with status ${res.status}`
          );
        }
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setPosts(Array.isArray(body?.posts) ? body.posts : []);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    // The transparency panel is supplementary: if it fails, the feed still
    // renders and the panel simply stays hidden.
    fetch(`/api/agent/judgment-summary?agentId=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body || typeof body.topicsJudged !== 'number') return;
        setSummary(body as JudgmentSummary);
      })
      .catch(() => {
        /* panel is optional */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Flip one frame after the posts land so the cards animate from their
  // pre-entrance state instead of mounting already-settled.
  useEffect(() => {
    if (status !== 'ready') return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const visiblePosts = useMemo(() => {
    const now = new Date();
    return posts.filter((post) => inRange(post.createdAt, range, now));
  }, [posts, range]);

  const rejectionQuotes = (summary?.recentRejections ?? [])
    .filter((r) => r.reason)
    .slice(0, 3);

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      {/* Dot-grid texture, faded out toward the bottom so it never fights the text. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgb(38 38 38) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage:
            'linear-gradient(to bottom, black, black 55%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black, black 55%, transparent 100%)',
        }}
      />

      <div className="relative mx-auto max-w-3xl px-6 py-14">
        <header className="border-b border-neutral-800 pb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
              Rhea Kapoor
            </h1>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-900/70 bg-emerald-950/40 px-3 py-1 text-[11px] font-medium text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Autonomous Agent Active
            </span>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            Applied AI Reliability Engineer. Writes about production AI/ML
            systems the way an SRE writes an incident postmortem — evidence
            first, allergic to hype.
          </p>
          {agentId ? (
            <p className="mt-4 font-mono text-[11px] text-neutral-600">
              agent {agentId}
            </p>
          ) : null}
        </header>

        {summary && summary.topicsJudged > 0 ? (
          <section
            className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 transition-opacity duration-700"
            style={{ opacity: entered ? 1 : 0 }}
          >
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
              Editorial judgment
            </h2>
            <p className="mt-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-100">
                {summary.topicsJudged}
              </span>{' '}
              topics considered
              <span className="text-neutral-600"> · </span>
              <span className="font-medium text-emerald-400">
                {summary.published}
              </span>{' '}
              published
              <span className="text-neutral-600"> · </span>
              <span className="font-medium text-neutral-400">
                {summary.rejected}
              </span>{' '}
              rejected
            </p>

            {rejectionQuotes.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {rejectionQuotes.map((rejection, i) => (
                  <li
                    key={`${rejection.topic}-${i}`}
                    className="border-l-2 border-neutral-700 pl-3"
                  >
                    <p className="text-[11px] font-medium text-neutral-400">
                      {rejection.topic}
                    </p>
                    <p className="mt-1 text-xs italic leading-5 text-neutral-500">
                      “{rejection.reason}”
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {status === 'loading' ? (
          <div className="flex items-center gap-3 py-16 text-sm text-neutral-500">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400"
            />
            Loading feed…
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="mt-10 rounded-lg border border-red-900/60 bg-red-950/30 px-5 py-4">
            <p className="text-sm font-medium text-red-300">
              Could not load the feed
            </p>
            <p className="mt-1 font-mono text-xs text-red-400/80">{error}</p>
          </div>
        ) : null}

        {status === 'ready' && posts.length > 0 ? (
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                  range === option.key
                    ? 'border-neutral-600 bg-neutral-800 text-neutral-100'
                    : 'border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {status === 'ready' && posts.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-neutral-800 px-5 py-12 text-center">
            <p className="text-sm text-neutral-400">No posts yet</p>
            <p className="mt-1 text-xs text-neutral-600">
              The next publishing cycle will fill this in.
            </p>
          </div>
        ) : null}

        {status === 'ready' && posts.length > 0 && visiblePosts.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-neutral-800 px-5 py-12 text-center">
            <p className="text-sm text-neutral-400">
              Nothing published in this window
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {posts.length} post{posts.length === 1 ? '' : 's'} in total — try
              “All”.
            </p>
          </div>
        ) : null}

        {status === 'ready' && visiblePosts.length > 0 ? (
          <ul className="mt-6 space-y-6">
            {visiblePosts.map((post, index) => {
              const isOpen = openRationale === post.id;

              return (
                <li
                  key={post.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 transition-[transform,opacity,border-color,box-shadow] duration-500 ease-out hover:-translate-y-0.5 hover:border-neutral-700 hover:shadow-[0_0_0_1px_rgba(64,64,64,0.5),0_12px_32px_-12px_rgba(0,0,0,0.9)]"
                  style={{
                    opacity: entered ? 1 : 0,
                    transform: entered ? 'translateY(0)' : 'translateY(12px)',
                    // Cap the cascade so a long feed's last card isn't held
                    // back for several seconds.
                    transitionDelay: `${Math.min(index, 8) * 70}ms`,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <time
                      dateTime={post.createdAt}
                      className="font-mono text-[11px] uppercase tracking-wider text-neutral-500"
                    >
                      {formatDate(post.createdAt)}
                    </time>
                    {/* Unconditional by design: writePost throws on ungrounded
                        output, so nothing reaches the posts table without
                        having passed the grounding check. */}
                    <span
                      title="Every claim in this post was checked against the linked source before publishing"
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-900/60 bg-emerald-950/30 px-2.5 py-1 text-[10px] font-medium text-emerald-400/90"
                    >
                      ✓ Verified against source
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-neutral-100">
                    {post.text}
                  </p>

                  {post.rationale ? (
                    <div className="mt-5 border-t border-neutral-800 pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRationale(isOpen ? null : post.id)
                        }
                        aria-expanded={isOpen}
                        className="flex items-center text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200"
                      >
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block transition-transform duration-300 ${
                            isOpen ? 'rotate-90' : ''
                          }`}
                        >
                          ▸
                        </span>
                        Why this post
                      </button>
                      <div
                        className={`overflow-hidden transition-all duration-300 ease-out ${
                          isOpen
                            ? 'max-h-[500px] opacity-100'
                            : 'max-h-0 opacity-0'
                        }`}
                      >
                        <p className="mt-3 border-l-2 border-neutral-800 pl-4 text-sm leading-6 text-neutral-400">
                          {post.rationale}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {post.sources.length > 0 ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {post.sources.map((src) => (
                        <a
                          key={src}
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={src}
                          className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 font-mono text-[11px] text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200"
                        >
                          {hostOf(src)} ↗
                        </a>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
