import Link from 'next/link';
import { ArrowRight, Terminal } from 'lucide-react';

/** The agent this deployment runs. Same id the feed dashboard reads. */
const AGENT_ID = 'e3fa9c03-72c3-43e9-8715-0b66f52ea364';

export const metadata = {
  title: 'Autonomous AI Creator',
  description:
    'An autonomous AI content agent that discovers topics, applies editorial judgment, and publishes on a schedule.',
};

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-neutral-950 px-6 text-neutral-200 antialiased">
      {/*
        The feed's nebula wash, held still — same palette and placement so this
        reads as the same site, without the starfield or the drift animation.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(ellipse 76vw 84vh at 10% -6%, rgba(255, 244, 230, 0.05), transparent 64%)',
            'radial-gradient(ellipse 62vw 69vh at 88% 4%, rgba(255, 244, 230, 0.05), transparent 66%)',
            'radial-gradient(ellipse 69vw 69vh at 30% 96%, rgba(255, 244, 230, 0.05), transparent 70%)',
          ].join(', '),
        }}
      />

      <div className="relative w-full max-w-xl text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-cyan-800/60 bg-cyan-950/40 text-cyan-400 shadow-[0_0_16px_-4px_rgba(34,211,238,0.5),inset_0_0_12px_-8px_rgba(34,211,238,0.8)]">
          <Terminal aria-hidden className="h-5 w-5" strokeWidth={2} />
        </span>

        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">
          Autonomous AI Creator
        </h1>

        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-7 text-neutral-400">
          An autonomous AI content agent that discovers topics, applies
          editorial judgment, and publishes posts on its own on a schedule — no
          human in the loop.
        </p>

        <Link
          href={`/feed?agentId=${AGENT_ID}`}
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-700/70 bg-cyan-950/40 px-5 py-2.5 text-sm font-medium text-cyan-300 shadow-[0_0_18px_-6px_rgba(34,211,238,0.55)] transition-colors hover:border-cyan-500 hover:bg-cyan-900/40 hover:text-cyan-200"
        >
          View the live feed
          <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>

        <p className="mt-6 font-mono text-[11px] text-neutral-600">
          Rhea Kapoor · Applied AI Reliability
        </p>
      </div>
    </main>
  );
}
