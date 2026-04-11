/**
 * POST /api/traefik/ai-review
 *
 * Take a fresh snapshot of the live Traefik runtime config, run the
 * local diagnose() pass, and ship a compact summary to Claude with the
 * forced `emit_traefik_review` tool. Claude reports issues the local
 * checker may have missed (security, fragile patterns, dashboards
 * exposed without auth, etc).
 *
 * Lock-down mirrors the editor AI routes:
 *   - forced single-tool, schema re-validation
 *   - 20s hard timeout via invokeTool
 *   - max 20 findings, length-capped strings
 *   - no free-text path; failures translate to typed errors
 *
 * Auth: gated only on `getAi()` succeeding (AI enabled + key present).
 * No additional per-feature flag — review is a top-level Traefik feature
 * that the user explicitly triggers from the page.
 *
 * Returns `{ enabled: false }` (HTTP 200) when AI is off / unkeyed so
 * the UI can hide the section without rendering an error.
 */

import { recordActivity } from '@/lib/ai/activity';
import { getAi, AiDisabledError, AiNoKeyError } from '@/lib/ai/client';
import { invokeTool, AiTimeoutError } from '@/lib/ai/invoke';
import { traefikReviewSystemPrompt } from '@/lib/ai/prompts';
import {
  EMIT_TRAEFIK_REVIEW_TOOL,
  validateTraefikReview,
  type TraefikReviewFinding,
} from '@/lib/ai/tools';
import { jsonError } from '@/lib/api-errors';
import {
  getTraefikConfig,
  traefikGet,
  TraefikClientError,
} from '@/lib/traefik/client';
import { diagnose } from '@/lib/traefik/diagnose';
import type { TraefikDiagnostic } from '@/lib/traefik/diagnose';
import type {
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikRouter,
  TraefikService,
} from '@/lib/traefik/types';

export interface AiReviewResponse {
  enabled: true;
  summary: string;
  findings: TraefikReviewFinding[];
}

export interface AiReviewDisabledResponse {
  enabled: false;
}

interface Snapshot {
  entryPoints: TraefikEntryPoint[];
  http: {
    routers: TraefikRouter[];
    services: TraefikService[];
    middlewares: TraefikMiddleware[];
  };
  tcp: {
    routers: TraefikRouter[];
    services: TraefikService[];
    middlewares: TraefikMiddleware[];
  };
  udp: {
    routers: TraefikRouter[];
    services: TraefikService[];
  };
}

export async function POST(): Promise<Response> {
  const start = Date.now();

  // ----- AI gating -----
  let resolved;
  try {
    resolved = await getAi();
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiNoKeyError) {
      const disabled: AiReviewDisabledResponse = { enabled: false };
      return Response.json(disabled);
    }
    throw err;
  }

  // ----- Traefik snapshot -----
  let config;
  try {
    config = await getTraefikConfig();
  } catch (err) {
    if (err instanceof TraefikClientError) {
      // Configuration / connectivity error: surface a typed error so the
      // UI can show a per-section card without disabling the whole page.
      const status = err.code === 'NOT_CONFIGURED' ? 400 : 502;
      return Response.json(
        { error: err.message, code: err.code, status: err.status },
        { status },
      );
    }
    throw err;
  }

  let snapshot: Snapshot;
  try {
    snapshot = await fetchSnapshot(config);
  } catch (err) {
    if (err instanceof TraefikClientError) {
      return Response.json(
        { error: err.message, code: err.code, status: err.status },
        { status: 502 },
      );
    }
    throw err;
  }

  // ----- Local diagnostics (provided to Claude as context) -----
  const localResult = diagnose({
    entryPoints: snapshot.entryPoints,
    http: snapshot.http,
    tcp: snapshot.tcp,
    udp: { routers: snapshot.udp.routers, services: snapshot.udp.services },
  });

  // ----- Claude call -----
  try {
    const userContent = buildReviewUserMessage(snapshot, localResult.diagnostics);
    const raw = await invokeTool({
      client: resolved.client,
      model: resolved.model,
      system: traefikReviewSystemPrompt(),
      userContent,
      tool: EMIT_TRAEFIK_REVIEW_TOOL,
      maxTokens: 2048,
      timeoutMs: 20_000,
    });

    let payload;
    try {
      payload = validateTraefikReview(raw);
    } catch {
      recordActivity({
        route: 'traefik-review',
        latencyMs: Date.now() - start,
        status: 'error',
        error: 'invalid tool output',
      });
      return jsonError(502, 'AI returned invalid output');
    }

    recordActivity({
      route: 'traefik-review',
      latencyMs: Date.now() - start,
      status: 'ok',
    });
    const responseBody: AiReviewResponse = {
      enabled: true,
      summary: payload.summary,
      findings: payload.findings,
    };
    return Response.json(responseBody);
  } catch (err) {
    const message =
      err instanceof AiTimeoutError
        ? 'AI request timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('[traefik/ai-review] error', err);
    recordActivity({
      route: 'traefik-review',
      latencyMs: Date.now() - start,
      status: 'error',
      error: message.slice(0, 200),
    });
    return jsonError(
      err instanceof AiTimeoutError ? 504 : 502,
      message.slice(0, 200),
    );
  }
}

/**
 * Fan out the same nine endpoints the diagnose route uses. Unlike
 * diagnose, AI review is a one-shot user-triggered action, so a 502 on
 * any endpoint we actually need (HTTP routers, services) bubbles up;
 * we only soft-fail on TCP/UDP middlewares which are commonly absent.
 */
async function fetchSnapshot(
  config: Awaited<ReturnType<typeof getTraefikConfig>>,
): Promise<Snapshot> {
  const get = <T>(p: string) => traefikGet<T>(config, p);
  // Wrap optional fetches that return [] on NOT_FOUND.
  const optional = async <T>(p: string): Promise<T[]> => {
    try {
      return await get<T[]>(p);
    } catch (err) {
      if (err instanceof TraefikClientError && err.code === 'NOT_FOUND') {
        return [];
      }
      throw err;
    }
  };

  const [
    entryPoints,
    httpRouters,
    httpServices,
    httpMiddlewares,
    tcpRouters,
    tcpServices,
    tcpMiddlewares,
    udpRouters,
    udpServices,
  ] = await Promise.all([
    get<TraefikEntryPoint[]>('/api/entrypoints'),
    get<TraefikRouter[]>('/api/http/routers'),
    get<TraefikService[]>('/api/http/services'),
    optional<TraefikMiddleware>('/api/http/middlewares'),
    optional<TraefikRouter>('/api/tcp/routers'),
    optional<TraefikService>('/api/tcp/services'),
    optional<TraefikMiddleware>('/api/tcp/middlewares'),
    optional<TraefikRouter>('/api/udp/routers'),
    optional<TraefikService>('/api/udp/services'),
  ]);

  return {
    entryPoints,
    http: {
      routers: httpRouters,
      services: httpServices,
      middlewares: httpMiddlewares,
    },
    tcp: {
      routers: tcpRouters,
      services: tcpServices,
      middlewares: tcpMiddlewares,
    },
    udp: { routers: udpRouters, services: udpServices },
  };
}

/**
 * Build a compact text representation of the snapshot for Claude. We
 * deliberately strip raw JSON to keep the prompt small — the model
 * doesn't need every field, just enough to reason about cross-references
 * and security shape. Local diagnostics are appended verbatim so Claude
 * can avoid duplicating them.
 */
function buildReviewUserMessage(
  snapshot: Snapshot,
  localDiagnostics: TraefikDiagnostic[],
): string {
  const lines: string[] = [];

  lines.push('<snapshot>');
  lines.push('');
  lines.push('<entrypoints>');
  for (const ep of snapshot.entryPoints) {
    const parts = [`${ep.name}=${ep.address}`];
    if (ep.asDefault) parts.push('default');
    if (ep.http?.middlewares && ep.http.middlewares.length > 0) {
      parts.push(`middlewares=[${ep.http.middlewares.join(',')}]`);
    }
    lines.push(parts.join(' '));
  }
  lines.push('</entrypoints>');
  lines.push('');

  for (const proto of ['http', 'tcp', 'udp'] as const) {
    const section = snapshot[proto];
    lines.push(`<${proto}>`);
    lines.push('routers:');
    for (const r of section.routers) {
      const parts = [`  - ${r.name}`];
      parts.push(`status=${r.status ?? '?'}`);
      if (r.rule) parts.push(`rule=${truncate(r.rule, 200)}`);
      if (r.service) parts.push(`service=${r.service}`);
      if (r.entryPoints && r.entryPoints.length > 0) {
        parts.push(`entryPoints=[${r.entryPoints.join(',')}]`);
      }
      if (r.middlewares && r.middlewares.length > 0) {
        parts.push(`middlewares=[${r.middlewares.join(',')}]`);
      }
      if (r.tls) parts.push('tls');
      if (typeof r.priority === 'number') parts.push(`priority=${r.priority}`);
      lines.push(parts.join(' '));
    }
    lines.push('services:');
    for (const s of section.services) {
      const parts = [`  - ${s.name}`];
      parts.push(`status=${s.status ?? '?'}`);
      if (s.type) parts.push(`type=${s.type}`);
      if (s.loadBalancer?.servers && s.loadBalancer.servers.length > 0) {
        const targets = s.loadBalancer.servers
          .map((srv) => srv.url ?? srv.address ?? '?')
          .slice(0, 5);
        parts.push(`servers=[${targets.join(',')}]`);
      }
      if (s.usedBy && s.usedBy.length > 0) {
        parts.push(`usedBy=[${s.usedBy.join(',')}]`);
      }
      lines.push(parts.join(' '));
    }
    if ('middlewares' in section) {
      lines.push('middlewares:');
      for (const m of section.middlewares) {
        const parts = [`  - ${m.name}`];
        parts.push(`status=${m.status ?? '?'}`);
        if (m.type) parts.push(`type=${m.type}`);
        if (m.usedBy && m.usedBy.length > 0) {
          parts.push(`usedBy=[${m.usedBy.join(',')}]`);
        }
        lines.push(parts.join(' '));
      }
    }
    lines.push(`</${proto}>`);
    lines.push('');
  }

  lines.push('</snapshot>');
  lines.push('');
  lines.push('<local_diagnostics>');
  if (localDiagnostics.length === 0) {
    lines.push('(none)');
  } else {
    for (const d of localDiagnostics) {
      lines.push(
        `${d.severity} ${d.category} ${d.subject.kind}:${d.subject.name} — ${d.message}`,
      );
    }
  }
  lines.push('</local_diagnostics>');
  lines.push('');
  lines.push(
    'Review this snapshot. Report only issues the local diagnostics did not catch. Use the emit_traefik_review tool.',
  );
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
