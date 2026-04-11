/**
 * GET /api/traefik/diagnose
 *
 * Pulls a full snapshot of the live runtime config from the configured
 * Traefik instance and runs the local `diagnose()` checker. The
 * snapshot fetch fans out the seven dynamic-config endpoints in
 * parallel; if any single fan-out call fails the route still returns
 * a partial result with whatever was reachable, plus a top-level
 * `errors` list so the UI can warn the user.
 *
 * Local-only — no AI, no external services. Used by the
 * DiagnosticsSection on the `/traefik` page.
 */

import {
  getTraefikConfig,
  traefikGet,
  TraefikClientError,
} from '@/lib/traefik/client';
import { diagnose } from '@/lib/traefik/diagnose';
import type {
  DiagnoseInputProtocol,
  TraefikDiagnostic,
  DiagnoseSummary,
} from '@/lib/traefik/diagnose';
import type {
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikRouter,
  TraefikService,
} from '@/lib/traefik/types';

export interface DiagnoseResponse {
  ok: true;
  diagnostics: TraefikDiagnostic[];
  summary: DiagnoseSummary;
  /** Per-endpoint fetch errors. Empty when everything came back. */
  errors: { path: string; code: string; message: string }[];
}

export interface DiagnoseErrorResponse {
  ok: false;
  code: string;
  error: string;
  status: number | null;
}

function statusForCode(code: string): number {
  if (code === 'NOT_CONFIGURED') return 400;
  return 502;
}

export async function GET(): Promise<Response> {
  let config;
  try {
    config = await getTraefikConfig();
  } catch (err) {
    if (err instanceof TraefikClientError) {
      const body: DiagnoseErrorResponse = {
        ok: false,
        code: err.code,
        error: err.message,
        status: err.status,
      };
      return Response.json(body, { status: statusForCode(err.code) });
    }
    throw err;
  }

  // Fan out — every endpoint independently. We use Promise.allSettled
  // so a single 404 (e.g. UDP middlewares aren't always present) or a
  // transient hiccup doesn't poison the whole diagnostic pass.
  const targets = [
    { key: 'entryPoints', path: '/api/entrypoints' },
    { key: 'http/routers', path: '/api/http/routers' },
    { key: 'http/services', path: '/api/http/services' },
    { key: 'http/middlewares', path: '/api/http/middlewares' },
    { key: 'tcp/routers', path: '/api/tcp/routers' },
    { key: 'tcp/services', path: '/api/tcp/services' },
    { key: 'tcp/middlewares', path: '/api/tcp/middlewares' },
    { key: 'udp/routers', path: '/api/udp/routers' },
    { key: 'udp/services', path: '/api/udp/services' },
  ] as const;

  const settled = await Promise.allSettled(
    targets.map((t) => traefikGet<unknown>(config, t.path)),
  );

  const errors: DiagnoseResponse['errors'] = [];
  const dataByKey: Record<string, unknown> = {};
  settled.forEach((res, i) => {
    const t = targets[i];
    if (res.status === 'fulfilled') {
      dataByKey[t.key] = res.value;
      return;
    }
    const err = res.reason;
    if (err instanceof TraefikClientError) {
      // 404s are an expected "this protocol has no items" signal —
      // record an empty list rather than an error.
      if (err.code === 'NOT_FOUND') {
        dataByKey[t.key] = [];
        return;
      }
      errors.push({ path: t.path, code: err.code, message: err.message });
    } else {
      errors.push({
        path: t.path,
        code: 'HTTP_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const result = diagnose({
    entryPoints: asArray<TraefikEntryPoint>(dataByKey['entryPoints']),
    http: protocol(dataByKey, 'http', true),
    tcp: protocol(dataByKey, 'tcp', true),
    udp: protocol(dataByKey, 'udp', false),
  });

  const body: DiagnoseResponse = {
    ok: true,
    diagnostics: result.diagnostics,
    summary: result.summary,
    errors,
  };
  return Response.json(body);
}

function protocol(
  data: Record<string, unknown>,
  proto: 'http' | 'tcp' | 'udp',
  withMiddlewares: boolean,
): DiagnoseInputProtocol {
  const out: DiagnoseInputProtocol = {
    routers: asArray<TraefikRouter>(data[`${proto}/routers`]),
    services: asArray<TraefikService>(data[`${proto}/services`]),
  };
  if (withMiddlewares) {
    out.middlewares = asArray<TraefikMiddleware>(data[`${proto}/middlewares`]);
  }
  return out;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
