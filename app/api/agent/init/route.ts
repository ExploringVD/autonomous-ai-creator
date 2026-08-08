import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createAgent } from '@/lib/db';
import { buildPersonaConfig } from '@/lib/persona';
import { corsJson, corsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const initSchema = z.object({
  persona: z.object({
    name: z.string().trim().min(1),
    domain: z.string().trim().min(1),
  }),
});

/** Preflight, so browser-based API clients can call this cross-origin. */
export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return corsJson({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = initSchema.safeParse(body);
    if (!parsed.success) {
      return corsJson(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        400
      );
    }

    const { name, domain } = parsed.data.persona;
    const agentId = uuidv4();

    await createAgent({
      id: agentId,
      name,
      domain,
      persona_config: { ...buildPersonaConfig({ name, domain }) },
    });

    return corsJson({ agentId });
  } catch (error) {
    console.error('POST /api/agent/init failed:', error);
    return corsJson({ error: 'Internal server error' }, 500);
  }
}
