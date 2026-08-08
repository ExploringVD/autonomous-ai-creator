import { NextResponse } from 'next/server';
import { getAgent, getPostsForAgent } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim();

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: agentId' },
        { status: 400 }
      );
    }

    // agents.id is a uuid column, so a malformed id would make Postgres throw
    // rather than return no rows. It can't identify an existing agent either
    // way, so treat it as not found instead of a server error.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        agentId
      );

    const agent = isUuid ? await getAgent(agentId) : null;
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Already ordered newest-first by getPostsForAgent.
    const posts = await getPostsForAgent(agentId);

    return NextResponse.json({
      posts: posts.map((post) => ({
        id: post.id,
        createdAt: post.created_at.toISOString(),
        text: post.text,
        rationale: post.rationale,
        sources: post.sources,
      })),
    });
  } catch (error) {
    console.error('GET /api/agent/feed failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
