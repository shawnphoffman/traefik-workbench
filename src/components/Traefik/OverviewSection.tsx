'use client';

/**
 * Overview cards for the `/traefik` page. Fetches `/api/traefik/overview`
 * once when the connection comes up and renders:
 *
 *   - HTTP / TCP / UDP count blocks (total, warnings, errors) for
 *     routers, services, and middlewares
 *   - Feature flags (tracing, metrics, accessLog, hub)
 *   - Active provider list
 *
 * Failure mode: a typed error card scoped to the section. The page
 * keeps rendering — Browse and Diagnostics still work even if
 * /api/overview happens to be 404 on a stripped-down build.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, XCircle } from 'lucide-react';

import { fetchTraefikOverview, TraefikProxyClientError } from '@/lib/api-client';
import type {
  TraefikCountBlock,
  TraefikOverview,
  TraefikOverviewSection as TraefikOverviewSectionData,
} from '@/lib/traefik/types';

export interface OverviewSectionProps {
  /** Only fetch when the connection card is green. */
  enabled: boolean;
  /** Bumped by the parent's "Re-test" button so we re-fetch in step. */
  reloadKey: number;
}

/**
 * Result of the most recently completed fetch. The `key` field is the
 * `reloadKey` it was fetched for; we compare it against the current
 * `reloadKey` to know whether the result is stale (i.e. a re-test was
 * requested but hasn't completed yet) and should render as loading.
 */
type Result =
  | { kind: 'ok'; data: TraefikOverview; key: number }
  | { kind: 'error'; code: string; message: string; key: number };

export function OverviewSection({ enabled, reloadKey }: OverviewSectionProps) {
  const [result, setResult] = useState<Result | null>(null);

  // Effect contains zero sync setState calls — every state mutation
  // happens inside a Promise callback (post-await), satisfying the
  // react-hooks/set-state-in-effect lint rule. Loading is derived
  // below from `result` vs the current `reloadKey`.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchTraefikOverview()
      .then((data) => {
        if (cancelled) return;
        setResult({ kind: 'ok', data, key: reloadKey });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof TraefikProxyClientError) {
          setResult({
            kind: 'error',
            code: err.code,
            message: err.message,
            key: reloadKey,
          });
        } else {
          setResult({
            kind: 'error',
            code: 'HTTP_ERROR',
            message: err instanceof Error ? err.message : String(err),
            key: reloadKey,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  if (!enabled) return null;

  const isLoading = result === null || result.key !== reloadKey;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <BarChart3 className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">Overview</h2>
      </header>
      <div className="p-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading overview…
          </div>
        )}
        {!isLoading && result?.kind === 'error' && (
          <ErrorCard code={result.code} message={result.message} />
        )}
        {!isLoading && result?.kind === 'ok' && (
          <OverviewBody data={result.data} />
        )}
      </div>
    </section>
  );
}

function OverviewBody({ data }: { data: TraefikOverview }) {
  const protocols: Array<{
    label: string;
    section: TraefikOverviewSectionData | undefined;
  }> = [
    { label: 'HTTP', section: data.http },
    { label: 'TCP', section: data.tcp },
    { label: 'UDP', section: data.udp },
  ];

  return (
    <div className="flex flex-col gap-5">
      {protocols.map(({ label, section }) => {
        // Skip whole protocols that have nothing — TCP/UDP are usually
        // empty in basic deployments and an empty card is just noise.
        if (!section || isEmptySection(section)) return null;
        return (
          <div key={label} className="flex flex-col gap-2">
            <div className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
              {label}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <CountCard label="Routers" block={section.routers} />
              <CountCard label="Services" block={section.services} />
              <CountCard label="Middlewares" block={section.middlewares} />
            </div>
          </div>
        );
      })}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
          Features
        </div>
        <div className="flex flex-wrap gap-2">
          <FeatureBadge label="Access log" on={data.features?.accessLog} />
          <FeatureBadge label="Hub" on={data.features?.hub} />
          {data.features?.tracing && (
            <FeatureBadge label={`Tracing: ${data.features.tracing}`} on />
          )}
          {data.features?.metrics && (
            <FeatureBadge label={`Metrics: ${data.features.metrics}`} on />
          )}
        </div>
      </div>

      {data.providers && data.providers.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
            Providers
          </div>
          <div className="flex flex-wrap gap-2">
            {data.providers.map((p) => (
              <span
                key={p}
                className="inline-flex items-center rounded-full border border-sky-800/60 bg-sky-500/10 px-2.5 py-0.5 text-sm font-medium text-sky-200"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isEmptySection(s: TraefikOverviewSectionData): boolean {
  const blocks = [s.routers, s.services, s.middlewares];
  return blocks.every((b) => !b || (b.total ?? 0) === 0);
}

function CountCard({
  label,
  block,
}: {
  label: string;
  block: TraefikCountBlock | undefined;
}) {
  const total = block?.total ?? 0;
  const warnings = block?.warnings ?? 0;
  const errors = block?.errors ?? 0;
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-neutral-100">
        {total}
      </div>
      {(warnings > 0 || errors > 0) && (
        <div className="mt-1 flex items-center gap-3 text-xs">
          {warnings > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {warnings} warn
            </span>
          )}
          {errors > 0 && (
            <span className="inline-flex items-center gap-1 text-red-300">
              <XCircle className="h-3 w-3" aria-hidden="true" />
              {errors} error
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureBadge({
  label,
  on,
}: {
  label: string;
  on: boolean | undefined;
}) {
  const cls = on
    ? 'border-emerald-800/60 bg-emerald-500/10 text-emerald-200'
    : 'border-neutral-800 bg-neutral-900 text-neutral-500';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium ${cls}`}
    >
      {label}
      {!on && ' · off'}
    </span>
  );
}

function ErrorCard({ code, message }: { code: string; message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2.5"
    >
      <XCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-sm font-semibold text-red-200">{code}</div>
        <div className="break-words text-sm text-red-100/90">{message}</div>
      </div>
    </div>
  );
}
