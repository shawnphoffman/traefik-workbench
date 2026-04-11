/**
 * GET /api/traefik/udp/{routers,services}
 *
 * UDP equivalent of `/api/traefik/http/[kind]`. UDP only has routers
 * and services in Traefik's data model — no middlewares, no
 * serversTransports — so the allowlist is shorter than for HTTP/TCP.
 */

import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { proxyTraefikGet } from '@/lib/traefik/proxy';

const ALLOWED = new Set(['routers', 'services']);

type Context = { params: Promise<{ kind: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { kind } = await context.params;
  if (!ALLOWED.has(kind)) {
    return jsonError(400, `Unknown UDP collection: ${kind}`);
  }
  return proxyTraefikGet(`/api/udp/${kind}`);
}
