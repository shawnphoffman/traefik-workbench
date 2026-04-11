/**
 * Pure local diagnostics for a Traefik runtime snapshot.
 *
 * This module looks at what `/api/{http,tcp,udp}/*` and `/api/entrypoints`
 * returned and flags everything we can detect *without* needing AI:
 *
 *   - items Traefik already marked `disabled` / `warning` (with the
 *     reason strings it gave back)
 *   - dangling references — routers pointing at services / middlewares
 *     that don't exist anywhere in the runtime
 *   - dangling entry-point references
 *   - orphans — services / middlewares nothing references
 *   - duplicate rules — multiple routers competing for the same match
 *   - servers reported `DOWN` by Traefik's health checks
 *
 * Stays a pure function (no I/O, no fetch, no logging) so it's trivially
 * testable and easy to reason about. The route handler does the I/O.
 */

import type {
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikRouter,
  TraefikService,
} from './types';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCategory =
  | 'status' // item Traefik itself flagged
  | 'reference' // dangling reference to a non-existent thing
  | 'orphan' // unused service / middleware
  | 'conflict' // overlapping rules, etc.
  | 'health'; // server marked DOWN

export type DiagnosticKind =
  | 'router'
  | 'service'
  | 'middleware'
  | 'entrypoint';

export type TraefikProtocol = 'http' | 'tcp' | 'udp';

export interface DiagnosticSubject {
  kind: DiagnosticKind;
  /** Fully-qualified name as Traefik returns it (e.g. `api@file`). */
  name: string;
  protocol?: TraefikProtocol;
}

export interface TraefikDiagnostic {
  /**
   * Stable ID, used as a React key and for deduplication. Format:
   * `{category}:{kind}:{protocol}:{name}[:detail]`.
   */
  id: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  message: string;
  subject: DiagnosticSubject;
}

export interface DiagnoseInputProtocol {
  routers: TraefikRouter[];
  services: TraefikService[];
  /** Optional — UDP has none. */
  middlewares?: TraefikMiddleware[];
}

export interface DiagnoseInput {
  http: DiagnoseInputProtocol;
  tcp: DiagnoseInputProtocol;
  udp: DiagnoseInputProtocol;
  entryPoints: TraefikEntryPoint[];
}

export interface DiagnoseSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface DiagnoseResult {
  diagnostics: TraefikDiagnostic[];
  summary: DiagnoseSummary;
}

/**
 * Run all diagnostic checks against a runtime snapshot. Pure — same
 * input always produces the same output, in the same order.
 */
export function diagnose(input: DiagnoseInput): DiagnoseResult {
  const out: TraefikDiagnostic[] = [];

  const entryPointNames = new Set(input.entryPoints.map((e) => e.name));

  for (const proto of ['http', 'tcp', 'udp'] as const) {
    const section = input[proto];
    const serviceNames = nameSet(section.services);
    const middlewareNames = nameSet(section.middlewares ?? []);
    const referencedServices = new Set<string>();
    const referencedMiddlewares = new Set<string>();

    // ----- Router checks -----
    const ruleBuckets = new Map<string, TraefikRouter[]>();
    for (const r of section.routers) {
      pushItemStatus(out, r, 'router', proto);

      // Service reference
      if (r.service) {
        const target = canonicalName(r.service, r.provider);
        if (!hasName(serviceNames, target)) {
          out.push({
            id: `reference:router:${proto}:${r.name}:service:${target}`,
            severity: 'error',
            category: 'reference',
            message: `Router references service "${r.service}" which does not exist in ${proto.toUpperCase()} services.`,
            subject: { kind: 'router', name: r.name, protocol: proto },
          });
        } else {
          referencedServices.add(target);
        }
      }

      // Middleware references
      if (r.middlewares && r.middlewares.length > 0) {
        for (const m of r.middlewares) {
          const target = canonicalName(m, r.provider);
          if (!hasName(middlewareNames, target)) {
            out.push({
              id: `reference:router:${proto}:${r.name}:middleware:${target}`,
              severity: 'error',
              category: 'reference',
              message: `Router references middleware "${m}" which does not exist in ${proto.toUpperCase()} middlewares.`,
              subject: { kind: 'router', name: r.name, protocol: proto },
            });
          } else {
            referencedMiddlewares.add(target);
          }
        }
      }

      // Entry-point references
      if (r.entryPoints && r.entryPoints.length > 0) {
        for (const ep of r.entryPoints) {
          if (!entryPointNames.has(ep)) {
            out.push({
              id: `reference:router:${proto}:${r.name}:entrypoint:${ep}`,
              severity: 'error',
              category: 'reference',
              message: `Router references entry point "${ep}" which is not defined in static config.`,
              subject: { kind: 'router', name: r.name, protocol: proto },
            });
          }
        }
      } else {
        out.push({
          id: `config:router:${proto}:${r.name}:no-entrypoints`,
          severity: 'warning',
          category: 'reference',
          message: `Router has no entry points and will not match any traffic.`,
          subject: { kind: 'router', name: r.name, protocol: proto },
        });
      }

      // Bucket by rule for duplicate detection
      if (r.rule) {
        const key = r.rule;
        const arr = ruleBuckets.get(key);
        if (arr) arr.push(r);
        else ruleBuckets.set(key, [r]);
      }
    }

    // ----- Duplicate-rule conflict -----
    for (const [rule, routers] of ruleBuckets) {
      if (routers.length < 2) continue;
      // Only flag when the duplicates share at least one entry point —
      // otherwise they're not actually competing for the same traffic.
      const groups = groupByEntryPoint(routers);
      for (const [ep, group] of groups) {
        if (group.length < 2) continue;
        const names = group.map((g) => g.name).join(', ');
        out.push({
          id: `conflict:router:${proto}:${ep}:${rule}`,
          severity: 'warning',
          category: 'conflict',
          message: `Multiple routers share rule "${rule}" on entry point "${ep}": ${names}. Priority will decide which one wins.`,
          subject: { kind: 'router', name: group[0].name, protocol: proto },
        });
      }
    }

    // ----- Service checks -----
    for (const s of section.services) {
      pushItemStatus(out, s, 'service', proto);

      // Server health
      if (s.serverStatus) {
        for (const [target, status] of Object.entries(s.serverStatus)) {
          if (status !== 'UP') {
            out.push({
              id: `health:service:${proto}:${s.name}:${target}`,
              severity: 'warning',
              category: 'health',
              message: `Backend ${target} is reporting ${status}.`,
              subject: { kind: 'service', name: s.name, protocol: proto },
            });
          }
        }
      }

      // Empty load balancer
      if (
        s.loadBalancer &&
        (!s.loadBalancer.servers || s.loadBalancer.servers.length === 0)
      ) {
        out.push({
          id: `config:service:${proto}:${s.name}:empty-lb`,
          severity: 'warning',
          category: 'reference',
          message: `Service has no backend servers configured.`,
          subject: { kind: 'service', name: s.name, protocol: proto },
        });
      }

      // Orphan: nothing references this service.
      // We rely on Traefik's own usedBy when present and fall back to
      // our own scan otherwise.
      const isUsed =
        (s.usedBy && s.usedBy.length > 0) ||
        referencedServices.has(canonicalName(s.name, s.provider));
      if (!isUsed && !isInternal(s)) {
        out.push({
          id: `orphan:service:${proto}:${s.name}`,
          severity: 'info',
          category: 'orphan',
          message: `Service is not referenced by any ${proto.toUpperCase()} router.`,
          subject: { kind: 'service', name: s.name, protocol: proto },
        });
      }
    }

    // ----- Middleware checks -----
    for (const m of section.middlewares ?? []) {
      pushItemStatus(out, m, 'middleware', proto);

      const isUsed =
        (m.usedBy && m.usedBy.length > 0) ||
        referencedMiddlewares.has(canonicalName(m.name, m.provider));
      if (!isUsed && !isInternal(m)) {
        out.push({
          id: `orphan:middleware:${proto}:${m.name}`,
          severity: 'info',
          category: 'orphan',
          message: `Middleware is not referenced by any ${proto.toUpperCase()} router.`,
          subject: { kind: 'middleware', name: m.name, protocol: proto },
        });
      }
    }
  }

  // Stable ordering: errors → warnings → info, then by id within each
  // bucket so renders don't shuffle from one fetch to the next.
  const severityRank: Record<DiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  out.sort((a, b) => {
    const sd = severityRank[a.severity] - severityRank[b.severity];
    if (sd !== 0) return sd;
    return a.id.localeCompare(b.id);
  });

  const summary: DiagnoseSummary = { errors: 0, warnings: 0, infos: 0 };
  for (const d of out) {
    if (d.severity === 'error') summary.errors++;
    else if (d.severity === 'warning') summary.warnings++;
    else summary.infos++;
  }

  return { diagnostics: out, summary };
}

/**
 * Convert any item with a `status` field into a diagnostic if Traefik
 * itself flagged it. We trust Traefik's own classification — its
 * `error[]` strings are the most actionable signal we have.
 */
function pushItemStatus(
  out: TraefikDiagnostic[],
  item: TraefikRouter | TraefikService | TraefikMiddleware,
  kind: DiagnosticKind,
  protocol: TraefikProtocol,
): void {
  if (!item.status) return;
  if (item.status === 'enabled') return;

  const errors = item.error ?? [];
  if (errors.length === 0) {
    out.push({
      id: `status:${kind}:${protocol}:${item.name}`,
      severity: item.status === 'disabled' ? 'error' : 'warning',
      category: 'status',
      message:
        item.status === 'disabled'
          ? `${capitalize(kind)} is disabled by Traefik.`
          : `${capitalize(kind)} has a warning from Traefik.`,
      subject: { kind, name: item.name, protocol },
    });
    return;
  }
  for (const [i, err] of errors.entries()) {
    out.push({
      id: `status:${kind}:${protocol}:${item.name}:${i}`,
      severity: item.status === 'disabled' ? 'error' : 'warning',
      category: 'status',
      message: err,
      subject: { kind, name: item.name, protocol },
    });
  }
}

/**
 * Traefik returns names with provider suffixes (`auth@file`). When a
 * router references `auth`, the resolver's behavior depends on the
 * router's own provider; from the workbench's point of view we treat
 * either form as a match by canonicalizing both sides.
 */
function canonicalName(name: string, providerHint?: string): string {
  if (name.includes('@')) return name;
  if (providerHint) return `${name}@${providerHint}`;
  return name;
}

function nameSet(items: { name: string }[]): Set<string> {
  const s = new Set<string>();
  for (const it of items) {
    s.add(it.name);
    // Also index the bare form so canonicalName matches succeed even
    // when the reference omits the provider.
    const at = it.name.indexOf('@');
    if (at >= 0) s.add(it.name.slice(0, at));
  }
  return s;
}

function hasName(set: Set<string>, candidate: string): boolean {
  if (set.has(candidate)) return true;
  const at = candidate.indexOf('@');
  if (at >= 0) return set.has(candidate.slice(0, at));
  return false;
}

function groupByEntryPoint(
  routers: TraefikRouter[],
): Map<string, TraefikRouter[]> {
  const out = new Map<string, TraefikRouter[]>();
  for (const r of routers) {
    const eps = r.entryPoints && r.entryPoints.length > 0 ? r.entryPoints : ['*'];
    for (const ep of eps) {
      const arr = out.get(ep);
      if (arr) arr.push(r);
      else out.set(ep, [r]);
    }
  }
  return out;
}

/**
 * Internal Traefik items (`api@internal`, `dashboard@internal`, …)
 * always exist and aren't user-actionable, so we suppress orphan
 * warnings about them.
 */
function isInternal(item: { provider?: string; name?: string }): boolean {
  if (item.provider === 'internal') return true;
  if (item.name?.endsWith('@internal')) return true;
  return false;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
