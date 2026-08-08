'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  ChevronRight,
  ExternalLink,
  Terminal,
} from 'lucide-react';

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

/**
 * Stars that breathe on top of the static field, spread across the full
 * viewport rather than the sidebar. The durations are mutually non-harmonic
 * and the delays are offset so they never pulse together.
 */
const TWINKLING_STARS = [
  { top: '11%', left: '6%', size: 2, duration: '6.5s', delay: '0s' },
  { top: '27%', left: '18%', size: 1.5, duration: '8.3s', delay: '1.7s' },
  { top: '7%', left: '33%', size: 1.8, duration: '7.1s', delay: '3.4s' },
  { top: '44%', left: '9%', size: 1.4, duration: '9.7s', delay: '2.2s' },
  { top: '15%', left: '57%', size: 1.7, duration: '7.9s', delay: '0.8s' },
  { top: '62%', left: '73%', size: 2.1, duration: '6.1s', delay: '4.1s' },
  { top: '35%', left: '88%', size: 1.5, duration: '9.1s', delay: '2.9s' },
  { top: '79%', left: '46%', size: 1.6, duration: '8.7s', delay: '1.2s' },
  { top: '88%', left: '21%', size: 1.3, duration: '7.4s', delay: '3.8s' },
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

  // Two quotes, not three: the sidebar has to fit a laptop viewport without
  // scrolling on its own.
  const rejectionQuotes = (summary?.recentRejections ?? [])
    .filter((r) => r.reason)
    .slice(0, 2);

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      {/*
        Nebula wash. Five ellipses placed across the full width — top-left,
        top-right, mid-right and bottom-centre — so the colour spans the page
        instead of pooling in one corner. Alphas are held in the 0.10–0.22
        band: high enough to read as colour at a glance, low enough that the
        page is still black rather than blue.
      */}
      <div
        aria-hidden
        // Inset negatively so the slow drift never pulls a hard gradient edge
        // into view. motion-safe: honours prefers-reduced-motion — the layer
        // still renders, it just holds still.
        className="pointer-events-none fixed -inset-[10%] motion-safe:animate-nebula-drift"
        style={{
          // Sized in vw/vh, not px: with pixel radii a phone viewport sits
          // entirely inside one ellipse's hot centre and the whole screen goes
          // purple. Viewport units keep the same composition at every width.
          backgroundImage: [
            'radial-gradient(ellipse 76vw 84vh at 10% -6%, rgba(99, 102, 241, 0.22), transparent 64%)',
            'radial-gradient(ellipse 62vw 69vh at 88% 4%, rgba(124, 58, 237, 0.16), transparent 66%)',
            'radial-gradient(ellipse 57vw 76vh at 62% 46%, rgba(56, 89, 189, 0.13), transparent 68%)',
            'radial-gradient(ellipse 69vw 69vh at 30% 96%, rgba(76, 63, 176, 0.15), transparent 70%)',
            'radial-gradient(ellipse 49vw 62vh at 0% 40%, rgba(139, 92, 246, 0.10), transparent 72%)',
          ].join(', '),
        }}
      />

      {/*
        The distant cloud: one big diffuse mass, blurred hard enough that no
        edge survives. Sits under the starfield so stars read as being in
        front of it.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed left-[38%] top-[18%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full opacity-[0.5] blur-[90px] sm:h-[46rem] sm:w-[46rem] sm:blur-[130px]"
        style={{
          background:
            'radial-gradient(circle, rgba(67, 56, 202, 0.30) 0%, rgba(88, 28, 135, 0.16) 45%, transparent 72%)',
        }}
      />

      {/*
        Starfield. Six layers rather than one grid: the tile sizes are mutually
        prime-ish so the layers never line up into a repeating lattice, and
        each carries its own dot size and opacity so the dots read as varied.
        No mask — the field covers the whole viewport, so the feed column sits
        on stars rather than flat black.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(circle, rgba(241, 245, 249, 0.55) 1.2px, transparent 1.2px)',
            'radial-gradient(circle, rgba(226, 232, 240, 0.38) 1.5px, transparent 1.5px)',
            'radial-gradient(circle, rgba(203, 213, 225, 0.30) 1px, transparent 1px)',
            'radial-gradient(circle, rgba(226, 232, 240, 0.22) 0.8px, transparent 0.8px)',
            'radial-gradient(circle, rgba(191, 219, 254, 0.26) 1.1px, transparent 1.1px)',
            'radial-gradient(circle, rgba(148, 163, 184, 0.16) 0.7px, transparent 0.7px)',
          ].join(', '),
          backgroundSize:
            '97px 109px, 163px 139px, 71px 83px, 43px 47px, 191px 173px, 31px 37px',
          backgroundPosition:
            '18px 32px, 96px 12px, 47px 71px, 8px 44px, 132px 88px, 25px 19px',
        }}
      />

      {/* Four individually-timed stars over the static field. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        {TWINKLING_STARS.map((star, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-slate-200 motion-safe:animate-twinkle"
            style={{
              top: star.top,
              left: star.left,
              height: `${star.size}px`,
              width: `${star.size}px`,
              boxShadow: `0 0 ${star.size * 2}px rgba(226, 232, 240, 0.5)`,
              animationDuration: star.duration,
              animationDelay: star.delay,
              // Fallback for prefers-reduced-motion, where no animation runs;
              // while it does run, the keyframes take precedence over this.
              opacity: 0.35,
            }}
          />
        ))}
      </div>

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-10">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <header>
            <div className="relative">
              {/* Lifts the name off the background without being readable as a glow. */}
              <div
                aria-hidden
                // Vertical bleed only. Bleeding horizontally would push this
                // layer flush against the viewport edge on narrow screens, and
                // the ellipse is far enough inside that it costs nothing.
                className="pointer-events-none absolute inset-x-0 -inset-y-8"
                style={{
                  backgroundImage:
                    'radial-gradient(ellipse 240px 90px at 22% 50%, rgba(129, 140, 248, 0.13), transparent 70%)',
                }}
              />
              <div className="relative flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-800/60 bg-cyan-950/40 text-cyan-400 shadow-[0_0_16px_-4px_rgba(34,211,238,0.5),inset_0_0_12px_-8px_rgba(34,211,238,0.8)]">
                  <Terminal aria-hidden className="h-4 w-4" strokeWidth={2} />
                </span>
                <h1 className="text-xl font-semibold tracking-tight text-neutral-50">
                  Rhea Kapoor
                </h1>
              </div>
            </div>
            <p className="mt-1.5 text-[13px] leading-5 text-neutral-400">
              Applied AI Reliability Engineer. Writes about production AI/ML
              systems the way an SRE writes an incident postmortem — evidence
              first, allergic to hype.
            </p>

            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-800/70 bg-cyan-950/30 px-2.5 py-1 text-[11px] font-medium text-cyan-400 shadow-[0_0_14px_-3px_rgba(34,211,238,0.45),inset_0_0_10px_-6px_rgba(34,211,238,0.6)]">
              <Activity
                aria-hidden
                className="h-3 w-3 animate-pulse"
                strokeWidth={2.5}
              />
              Autonomous Agent Active
            </span>

            {agentId ? (
              <p className="mt-2.5 font-mono text-[10px] text-neutral-600">
                <span className="text-neutral-500">Agent ID:</span>{' '}
                <span className="break-all">{agentId}</span>
              </p>
            ) : null}
          </header>

          {summary && summary.topicsJudged > 0 ? (
            <section
              className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/80 p-3.5 transition-opacity duration-700"
              style={{ opacity: entered ? 1 : 0 }}
            >
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                Editorial judgment
              </h2>

              <div className="mt-2.5 flex items-baseline gap-3">
                <span className="text-[13px] text-neutral-400">
                  <span className="font-semibold text-cyan-400">
                    {summary.topicsJudged}
                  </span>{' '}
                  judged
                </span>
                <span className="text-[13px] text-neutral-400">
                  <span className="font-semibold text-cyan-400">
                    {summary.published}
                  </span>{' '}
                  published
                </span>
                <span className="text-[13px] text-rose-300/60">
                  <span className="font-semibold text-rose-400/90">
                    {summary.rejected}
                  </span>{' '}
                  rejected
                </span>
              </div>

              {rejectionQuotes.length > 0 ? (
                <ul className="mt-3 space-y-2.5 border-t border-neutral-800 pt-3">
                  {rejectionQuotes.map((rejection, i) => (
                    <li
                      key={`${rejection.topic}-${i}`}
                      className="border-l-2 border-rose-900/60 pl-2.5"
                    >
                      <p className="line-clamp-2 text-[11px] leading-4 text-neutral-400">
                        {rejection.topic}
                      </p>
                      <p className="mt-1 line-clamp-3 text-[11px] italic leading-4 text-rose-300/50">
                        “{rejection.reason}”
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {status === 'ready' && posts.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {RANGES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRange(option.key)}
                  aria-pressed={range === option.key}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    range === option.key
                      ? 'border-cyan-800/80 bg-cyan-950/40 text-cyan-400'
                      : 'border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        {/* ── Feed ────────────────────────────────────────────────── */}
        <div className="min-w-0">
          {status === 'loading' ? (
            <div className="flex items-center gap-2.5 py-12 text-sm text-neutral-500">
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-700 border-t-cyan-400"
              />
              Loading feed…
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-4 py-3">
              <p className="text-sm font-medium text-rose-300">
                Could not load the feed
              </p>
              <p className="mt-1 font-mono text-xs text-rose-400/80">{error}</p>
            </div>
          ) : null}

          {status === 'ready' && posts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center">
              <p className="text-sm text-neutral-400">No posts yet</p>
              <p className="mt-1 text-xs text-neutral-600">
                The next publishing cycle will fill this in.
              </p>
            </div>
          ) : null}

          {status === 'ready' &&
          posts.length > 0 &&
          visiblePosts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center">
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
            <ul className="space-y-3.5">
              {visiblePosts.map((post, index) => {
                const isOpen = openRationale === post.id;

                return (
                  <li
                    key={post.id}
                    // Border is a cool mid-gray, not near-black: it has to
                    // delineate the card against the background at rest, with
                    // hover only intensifying what is already visible.
                    // /80 rather than /40: against the denser starfield a
                    // 40%-opaque card let stars read through the body text.
                    className="rounded-lg border border-[#3d464d] bg-neutral-900/80 p-4 transition-[transform,opacity,border-color,box-shadow] duration-500 ease-out hover:-translate-y-0.5 hover:border-cyan-700/60 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.14),0_12px_32px_-12px_rgba(0,0,0,0.9)]"
                    style={{
                      opacity: entered ? 1 : 0,
                      transform: entered ? 'translateY(0)' : 'translateY(12px)',
                      // Cap the cascade so a long feed's last card isn't held
                      // back for several seconds.
                      transitionDelay: `${Math.min(index, 8) * 70}ms`,
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <time
                        dateTime={post.createdAt}
                        className="font-mono text-[10px] uppercase tracking-wider text-neutral-500"
                      >
                        {formatDate(post.createdAt)}
                      </time>
                      {/* Unconditional by design: writePost throws on ungrounded
                          output, so nothing reaches the posts table without
                          having passed the grounding check. */}
                      <span
                        title="Every claim in this post was checked against the linked source before publishing"
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-900/60 bg-cyan-950/25 px-2 py-0.5 text-[10px] font-medium text-cyan-400/90"
                      >
                        <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                        Verified against source
                      </span>
                    </div>

                    <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-6 text-neutral-100">
                      {post.text}
                    </p>

                    {post.rationale ? (
                      <div className="mt-3.5 border-t border-neutral-800 pt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenRationale(isOpen ? null : post.id)
                          }
                          aria-expanded={isOpen}
                          className="flex items-center gap-1 text-[11px] font-medium text-neutral-400 transition-colors hover:text-cyan-400"
                        >
                          <ChevronRight
                            aria-hidden
                            className={`h-3.5 w-3.5 transition-transform duration-300 ${
                              isOpen ? 'rotate-90' : ''
                            }`}
                          />
                          Why this post
                        </button>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${
                            isOpen
                              ? 'max-h-[500px] opacity-100'
                              : 'max-h-0 opacity-0'
                          }`}
                        >
                          <p className="mt-2.5 border-l-2 border-neutral-800 pl-3 text-[13px] leading-5 text-neutral-400">
                            {post.rationale}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {post.sources.length > 0 ? (
                      <div className="mt-3.5 flex flex-wrap gap-1.5">
                        {post.sources.map((src) => (
                          <a
                            key={src}
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={src}
                            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 font-mono text-[10px] text-cyan-400/80 transition-colors hover:border-cyan-900 hover:text-cyan-300"
                          >
                            {hostOf(src)}
                            <ExternalLink aria-hidden className="h-3 w-3" />
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
      </div>
    </main>
  );
}
