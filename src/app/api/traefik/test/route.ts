/**
 * POST /api/traefik/test — verify the configured Traefik connection
 * works by hitting `/api/version`. The Settings page calls this from
 * its "Test connection" button (and the future `/traefik` page header
 * will reuse it).
 *
 * Response shape mirrors `/api/settings/test`:
 *   { ok: true,  version, pingMs }
 *   { ok: false, error, code, status? }
 *
 * The `code` is the categorized `TraefikErrorCode` so the UI can pick
 * an actionable message ("auth failed" → highlight the password field;
 * "TLS error" → suggest the insecure-TLS toggle). Raw fetch failures
 * never reach the client.
 */

import {
  getTraefikConfig,
  traefikPing,
  TraefikClientError,
} from '@/lib/traefik/client';

export async function POST(): Promise<Response> {
  try {
    const config = await getTraefikConfig();
    const liveness = await traefikPing(config);
    return Response.json({
      ok: true,
      version: liveness.version,
      pingMs: liveness.pingMs,
    });
  } catch (err) {
    if (err instanceof TraefikClientError) {
      return Response.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
          status: err.status,
        },
        { status: err.code === 'NOT_CONFIGURED' ? 400 : 502 },
      );
    }
    console.error('[traefik/test] unexpected error', err);
    return Response.json(
      {
        ok: false,
        code: 'HTTP_ERROR',
        error: err instanceof Error ? err.message : String(err),
        status: null,
      },
      { status: 500 },
    );
  }
}
