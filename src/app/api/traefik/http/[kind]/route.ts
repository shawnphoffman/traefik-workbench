/**
 * GET /api/traefik/http/{routers,services,middlewares,serversTransports}
 *
 * Single dynamic route that proxies all four HTTP collections rather
 * than four near-identical files. The `kind` segment is validated
 * against an allowlist so a typo in the URL becomes a 400 instead of
 * being forwarded to Traefik (which would 404 it anyway, but with a
 * confusing upstream-flavored error).
 */

import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { proxyTraefikGet } from '@/lib/traefik/proxy';

const ALLOWED = new Set([
  'routers',
  'services',
  'middlewares',
  'serversTransports',
]);

type Context = { params: Promise<{ kind: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { kind } = await context.params;
  if (!ALLOWED.has(kind)) {
    return jsonError(400, `Unknown HTTP collection: ${kind}`);
  }
  return proxyTraefikGet(`/api/http/${kind}`);
}
