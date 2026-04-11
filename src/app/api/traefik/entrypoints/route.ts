/**
 * GET /api/traefik/entrypoints — proxies Traefik's `/api/entrypoints`.
 * Lists every entrypoint (name, address, http/tls config) so the
 * BrowseSection can show what Traefik is actually listening on.
 */

import { proxyTraefikGet } from '@/lib/traefik/proxy';

export async function GET(): Promise<Response> {
  return proxyTraefikGet('/api/entrypoints');
}
