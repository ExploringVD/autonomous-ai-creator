import { NextResponse } from 'next/server';

/**
 * Wildcard origin is safe on these routes specifically: they read no cookies,
 * no Authorization header, and no session — there is no ambient authority for
 * a hostile page to borrow by calling them. If either route ever starts
 * authenticating the caller, this has to narrow to an allowlist.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** NextResponse.json with the CORS headers attached. */
export function corsJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

/** Preflight reply: no body, headers only. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
