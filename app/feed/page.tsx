'use client';

import { useEffect, useState } from 'react';

type Post = {
  id: string;
  createdAt: string;
  text: string;
  rationale: string | null;
  sources: string[];
};

type Status = 'loading' | 'ready' | 'error';

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

export default function FeedPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');

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

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <header className="border-b border-neutral-800 pb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
            Rhea Kapoor
          </h1>
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

        {status === 'ready' && posts.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-neutral-800 px-5 py-12 text-center">
            <p className="text-sm text-neutral-400">No posts yet</p>
            <p className="mt-1 text-xs text-neutral-600">
              The next publishing cycle will fill this in.
            </p>
          </div>
        ) : null}

        {status === 'ready' && posts.length > 0 ? (
          <ul className="mt-10 space-y-6">
            {posts.map((post) => (
              <li
                key={post.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 transition-colors hover:border-neutral-700"
              >
                <time
                  dateTime={post.createdAt}
                  className="font-mono text-[11px] uppercase tracking-wider text-neutral-500"
                >
                  {formatDate(post.createdAt)}
                </time>

                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-neutral-100">
                  {post.text}
                </p>

                {post.rationale ? (
                  <details className="group mt-5 border-t border-neutral-800 pt-4">
                    <summary className="cursor-pointer list-none text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200">
                      <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">
                        ▸
                      </span>
                      Why this post
                    </summary>
                    <p className="mt-3 border-l-2 border-neutral-800 pl-4 text-sm leading-6 text-neutral-400">
                      {post.rationale}
                    </p>
                  </details>
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
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
