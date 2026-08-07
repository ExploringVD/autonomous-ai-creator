import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createAgent } from '@/lib/db';
import { buildPersonaConfig } from '@/lib/persona';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const initSchema = z.object({
  persona: z.object({
    name: z.string().trim().min(1),
    domain: z.string().trim().min(1),
  }),
});

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const parsed = initSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
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

    return NextResponse.json({ agentId }, { status: 200 });
  } catch (error) {
    console.error('POST /api/agent/init failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
