/**
 * GET /api/traefik/tcp/{routers,services,middlewares,serversTransports}
 *
 * TCP equivalent of `/api/traefik/http/[kind]`. Same allowlist
 * pattern. TCP collections are usually empty in basic deployments;
 * the page collapses sections with zero items so this stays cheap.
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
    return jsonError(400, `Unknown TCP collection: ${kind}`);
  }
  return proxyTraefikGet(`/api/tcp/${kind}`);
}
