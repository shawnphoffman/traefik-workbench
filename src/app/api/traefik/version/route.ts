/**
 * GET /api/traefik/version — proxies Traefik's `/api/version`. Returns
 * the version string + codename. Used as the connection-bar headline
 * on the `/traefik` page (and as the liveness fallback when ping is
 * disabled).
 */

import { proxyTraefikGet } from '@/lib/traefik/proxy';

export async function GET(): Promise<Response> {
  return proxyTraefikGet('/api/version');
}
