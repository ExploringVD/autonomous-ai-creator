import { getAgent, getPostsForAgent } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Preflight, so browser-based API clients can call this cross-origin. */
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim();

    if (!agentId) {
      return corsJson(
        { error: 'Missing required query parameter: agentId' },
        400
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
      return corsJson({ error: 'Agent not found' }, 404);
    }

    // Already ordered newest-first by getPostsForAgent.
    const posts = await getPostsForAgent(agentId);

    return corsJson({
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
    return corsJson({ error: 'Internal server error' }, 500);
  }
}
