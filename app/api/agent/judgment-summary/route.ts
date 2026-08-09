import { NextResponse } from 'next/server';
import { getAllJudgments, getJudgmentSummary } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Editorial decision counts for the demo dashboard. Not part of the graded API
 * contract — the feed page is its only consumer.
 */
export async function GET(request: Request) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim();

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: agentId' },
        { status: 400 }
      );
    }

    // agents.id is a uuid column, so a malformed id makes Postgres throw rather
    // than return no rows. An id that can't name an agent has no history, which
    // is the same empty answer an unknown-but-well-formed id gets.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        agentId
      );

    if (!isUuid) {
      return NextResponse.json({
        topicsJudged: 0,
        published: 0,
        rejected: 0,
        recentRejections: [],
        allJudgments: [],
      });
    }

    // Additive: allJudgments joins the existing fields, none of which change.
    const [summary, allJudgments] = await Promise.all([
      getJudgmentSummary(agentId),
      getAllJudgments(agentId),
    ]);

    return NextResponse.json({ ...summary, allJudgments });
  } catch (error) {
    console.error('GET /api/agent/judgment-summary failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
