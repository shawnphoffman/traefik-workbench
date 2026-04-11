'use client';

/**
 * Diagnostics panel for the `/traefik` page. Pulls a runtime snapshot
 * via `/api/traefik/diagnose`, runs the local pure-function checker,
 * and renders the result grouped by severity.
 *
 * Each row carries an "Open in editor" affordance: we batch a single
 * `/api/traefik/locate` call after the diagnose round-trip to map the
 * subject names back to workspace YAML files, then store a one-shot
 * pending-open instruction in sessionStorage and navigate to /. The
 * workbench shell consumes that on mount.
 *
 * Per-section error card on failure — keeps the rest of the /traefik
 * page usable when only this endpoint is sad.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import {
  fetchTraefikDiagnose,
  locateTraefikResources,
  TraefikProxyClientError,
  type TraefikLocateMatch,
} from '@/lib/api-client';
import { setPendingOpen } from '@/lib/pending-open';
import type {
  DiagnosticSeverity,
  TraefikDiagnostic,
} from '@/lib/traefik/diagnose';

export interface DiagnosticsSectionProps {
  /** Only fetch when the connection card is green. */
  enabled: boolean;
  /** Bumped by the parent's "Re-test" button so we re-fetch in step. */
  reloadKey: number;
}

interface OkResult {
  kind: 'ok';
  diagnostics: TraefikDiagnostic[];
  summary: { errors: number; warnings: number; infos: number };
  errors: { path: string; code: string; message: string }[];
  /** subject.name → workspace match. Empty when locate hasn't returned. */
  locations: Map<string, TraefikLocateMatch>;
  key: number;
}

interface ErrResult {
  kind: 'error';
  code: string;
  message: string;
  key: number;
}

type Result = OkResult | ErrResult;

export function DiagnosticsSection({
  enabled,
  reloadKey,
}: DiagnosticsSectionProps) {
  const [result, setResult] = useState<Result | null>(null);

  // Diagnose + locate fan-out. Effect contains zero sync setState
  // calls; everything happens after `await` inside the IIFE,
  // satisfying the react-hooks/set-state-in-effect rule. Stale
  // results are detected via the per-result `key` field rather than
  // a reset.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await fetchTraefikDiagnose();
        if (cancelled) return;
        // Now ask the locate route which workspace files (if any)
        // define each unique subject. We collapse to a Set first to
        // avoid sending the same name twice — the locate route also
        // dedups, but it costs us nothing to be polite.
        const uniqueNames = Array.from(
          new Set(body.diagnostics.map((d) => d.subject.name)),
        );
        let matches: TraefikLocateMatch[] = [];
        if (uniqueNames.length > 0) {
          try {
            matches = await locateTraefikResources(uniqueNames);
          } catch {
            // Locate failures are non-fatal — we still render the
            // diagnostics, just without "Open in editor" buttons.
            matches = [];
          }
        }
        if (cancelled) return;
        const locations = new Map<string, TraefikLocateMatch>();
        for (const m of matches) locations.set(m.name, m);
        setResult({
          kind: 'ok',
          diagnostics: body.diagnostics,
          summary: body.summary,
          errors: body.errors,
          locations,
          key: reloadKey,
        });
      } catch (err: unknown) {
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  const isLoading = enabled && (result === null || result.key !== reloadKey);

  // Bucket by severity in render-time so we can show separate panels
  // with their own icons and tinting.
  const grouped = useMemo(() => {
    if (result?.kind !== 'ok') {
      return { error: [], warning: [], info: [] } as Record<
        DiagnosticSeverity,
        TraefikDiagnostic[]
      >;
    }
    const out: Record<DiagnosticSeverity, TraefikDiagnostic[]> = {
      error: [],
      warning: [],
      info: [],
    };
    for (const d of result.diagnostics) out[d.severity].push(d);
    return out;
  }, [result]);

  if (!enabled) return null;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-sky-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-neutral-100">
            Diagnostics
          </h2>
        </div>
        {result?.kind === 'ok' && !isLoading && (
          <SummaryBadges summary={result.summary} />
        )}
      </header>
      <div className="flex flex-col gap-3 p-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Running diagnostics…
          </div>
        )}

        {!isLoading && result?.kind === 'error' && (
          <ErrorCard code={result.code} message={result.message} />
        )}

        {!isLoading && result?.kind === 'ok' && result.errors.length > 0 && (
          <PartialNotice errors={result.errors} />
        )}

        {!isLoading &&
          result?.kind === 'ok' &&
          result.diagnostics.length === 0 && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-200"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              No issues detected in the live runtime config.
            </div>
          )}

        {!isLoading && result?.kind === 'ok' && result.diagnostics.length > 0 && (
          <>
            {(['error', 'warning', 'info'] as const).map((sev) => {
              const items = grouped[sev];
              if (items.length === 0) return null;
              return (
                <SeverityGroup
                  key={sev}
                  severity={sev}
                  diagnostics={items}
                  locations={result.locations}
                />
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function SummaryBadges({
  summary,
}: {
  summary: { errors: number; warnings: number; infos: number };
}) {
  const items: Array<{
    label: string;
    count: number;
    cls: string;
  }> = [
    {
      label: 'errors',
      count: summary.errors,
      cls: 'border-red-900/60 bg-red-950/40 text-red-200',
    },
    {
      label: 'warnings',
      count: summary.warnings,
      cls: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
    },
    {
      label: 'info',
      count: summary.infos,
      cls: 'border-sky-900/60 bg-sky-950/40 text-sky-200',
    },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${it.cls}`}
        >
          <span className="tabular-nums">{it.count}</span>
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function PartialNotice({
  errors,
}: {
  errors: { path: string; code: string; message: string }[];
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2.5"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1 text-sm text-amber-100/90">
        <div className="font-medium text-amber-200">
          Some Traefik endpoints could not be reached. Diagnostics may be
          incomplete.
        </div>
        <ul className="flex flex-col gap-0.5 font-mono text-xs">
          {errors.map((e) => (
            <li key={e.path} className="break-all">
              <span className="text-amber-300">{e.path}</span>
              {' — '}
              <span className="text-amber-200">{e.code}</span>
              {': '}
              <span className="text-amber-100/80">{e.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SeverityGroup({
  severity,
  diagnostics,
  locations,
}: {
  severity: DiagnosticSeverity;
  diagnostics: TraefikDiagnostic[];
  locations: Map<string, TraefikLocateMatch>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        <SeverityIcon severity={severity} />
        {severityLabel(severity)} ({diagnostics.length})
      </div>
      <ul className="flex flex-col gap-1.5">
        {diagnostics.map((d) => (
          <li key={d.id}>
            <DiagnosticRow diagnostic={d} location={locations.get(d.subject.name)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
  location,
}: {
  diagnostic: TraefikDiagnostic;
  location: TraefikLocateMatch | undefined;
}) {
  const tint = severityRowTint(diagnostic.severity);
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2.5 ${tint}`}
    >
      <SeverityIcon severity={diagnostic.severity} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <KindBadge kind={diagnostic.subject.kind} />
          {diagnostic.subject.protocol && (
            <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] uppercase text-neutral-400">
              {diagnostic.subject.protocol}
            </span>
          )}
          <span className="truncate font-mono text-neutral-200">
            {diagnostic.subject.name}
          </span>
          <CategoryBadge category={diagnostic.category} />
        </div>
        <div className="break-words text-sm text-neutral-100/90">
          {diagnostic.message}
        </div>
      </div>
      {location && <OpenInEditorButton location={location} />}
    </div>
  );
}

function OpenInEditorButton({ location }: { location: TraefikLocateMatch }) {
  return (
    <Link
      href="/"
      onClick={() =>
        setPendingOpen({ path: location.path, line: location.line })
      }
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-xs font-medium text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
      title={`${location.path}:${location.line}`}
    >
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      Open
    </Link>
  );
}

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  if (severity === 'error') {
    return (
      <XCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
        aria-hidden="true"
      />
    );
  }
  if (severity === 'warning') {
    return (
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <Info
      className="mt-0.5 h-4 w-4 shrink-0 text-sky-400"
      aria-hidden="true"
    />
  );
}

function severityLabel(severity: DiagnosticSeverity): string {
  if (severity === 'error') return 'Errors';
  if (severity === 'warning') return 'Warnings';
  return 'Info';
}

function severityRowTint(severity: DiagnosticSeverity): string {
  if (severity === 'error') return 'border-red-900/60 bg-red-950/30';
  if (severity === 'warning') return 'border-amber-900/60 bg-amber-950/30';
  return 'border-neutral-800 bg-neutral-900';
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
      {kind}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-500">
      {category}
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
