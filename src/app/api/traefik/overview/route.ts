/**
 * GET /api/traefik/overview — proxies Traefik's `/api/overview`.
 * Returns counts of routers/services/middlewares for HTTP/TCP/UDP plus
 * feature flags and the active provider list. Used by the OverviewSection
 * cards on the `/traefik` page.
 */

import { proxyTraefikGet } from '@/lib/traefik/proxy';

export async function GET(): Promise<Response> {
  return proxyTraefikGet('/api/overview');
}
