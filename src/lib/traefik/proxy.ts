/**
 * Shared proxy helper for `/api/traefik/*` GET routes.
 *
 * Every browse route under `src/app/api/traefik/*` looks identical:
 *   1. Resolve the configured Traefik connection.
 *   2. GET a fixed path on the upstream Traefik instance.
 *   3. Translate any thrown `TraefikClientError` into a typed JSON
 *      response the page can render.
 *
 * Pulling that into one helper means each route handler is one line
 * (`return proxyTraefikGet('/api/overview')`) and the error contract is
 * uniform: same shape, same status mapping, same logging key.
 *
 * Always 4xx/5xx on failure rather than letting Next render an HTML
 * error — the page only knows how to handle our typed JSON envelope.
 */

import {
  getTraefikConfig,
  traefikGet,
  TraefikClientError,
} from './client';

/**
 * Errors returned by the proxy. Mirrors the wire shape used by
 * `POST /api/traefik/test` so the page has one error contract for
 * everything Traefik-related.
 */
export interface TraefikProxyError {
  ok: false;
  code: string;
  error: string;
  status: number | null;
}

/**
 * `NOT_CONFIGURED` is the only client-side problem (the user hasn't
 * filled out the Settings form yet). Everything else is a real upstream
 * failure and gets a 502 so the UI can distinguish "you need to do
 * something" from "Traefik is sad".
 */
function statusForCode(code: string): number {
  if (code === 'NOT_CONFIGURED') return 400;
  return 502;
}

export async function proxyTraefikGet(path: string): Promise<Response> {
  try {
    const config = await getTraefikConfig();
    const data = await traefikGet(config, path);
    return Response.json(data);
  } catch (err) {
    if (err instanceof TraefikClientError) {
      const body: TraefikProxyError = {
        ok: false,
        code: err.code,
        error: err.message,
        status: err.status,
      };
      return Response.json(body, { status: statusForCode(err.code) });
    }
    console.error(`[traefik proxy] unexpected error for ${path}`, err);
    const body: TraefikProxyError = {
      ok: false,
      code: 'HTTP_ERROR',
      error: err instanceof Error ? err.message : String(err),
      status: null,
    };
    return Response.json(body, { status: 500 });
  }
}
