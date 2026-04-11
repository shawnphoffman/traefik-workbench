'use client';

/**
 * On-demand AI review of the live Traefik runtime config. Hidden when
 * AI is disabled in Settings.
 *
 * The user clicks "Run review" to trigger a server-side fetch + Claude
 * call. Findings render in the same severity-bucketed style as the
 * local diagnostics panel so the two feel consistent. The result is
 * cleared whenever the parent bumps `reloadKey` (i.e. on "Re-test"),
 * since stale findings against a now-different snapshot would mislead
 * the user.
 *
 * AI calls are user-initiated only — we never auto-run on mount, both
 * to keep latency off the page load and to avoid spending tokens on
 * pages the user only opened to look at the local diagnostics.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  XCircle,
} from 'lucide-react';

import {
  fetchTraefikAiReview,
  ApiClientError,
  type TraefikAiReviewFinding,
  type TraefikAiReviewResponse,
} from '@/lib/api-client';
import { useAiStatus } from '@/hooks/useAiStatus';

export interface AiReviewSectionProps {
  /** Only render when the connection card is green. */
  enabled: boolean;
  /** Bumped by the parent's "Re-test" button so we drop the previous result. */
  reloadKey: number;
}

type ReviewStateKind =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; data: TraefikAiReviewResponse }
  | { kind: 'error'; message: string };

/** Stamped with the reloadKey it was created under so we can derive
 * staleness without an effect-driven reset (which the React 19 lint
 * rule forbids). */
type ReviewState = ReviewStateKind & { key: number };

export function AiReviewSection({ enabled, reloadKey }: AiReviewSectionProps) {
  const { status, loading: statusLoading } = useAiStatus();
  const [stored, setStored] = useState<ReviewState>({
    kind: 'idle',
    key: reloadKey,
  });

  // Derive: if the stored state was tagged with an older reloadKey,
  // treat it as idle. This avoids any synchronous setState-in-effect
  // when the parent re-tests, which would otherwise trip the
  // react-hooks/set-state-in-effect rule.
  const state: ReviewStateKind =
    stored.key === reloadKey ? stored : { kind: 'idle' };

  if (!enabled) return null;
  // Hide the section entirely while we're still figuring out whether
  // AI is configured and once we know it isn't. The Settings page is
  // where users go to fix that — no point nagging from here.
  if (statusLoading) return null;
  if (!status.enabled) return null;

  const runReview = () => {
    const key = reloadKey;
    setStored({ kind: 'pending', key });
    const ctrl = new AbortController();
    fetchTraefikAiReview(ctrl.signal)
      .then((res) => {
        if (res.enabled) {
          setStored({ kind: 'ok', data: res, key });
        } else {
          // AI was disabled between page load and the click. Mirror the
          // empty state — useAiStatus will catch up next render.
          setStored({ kind: 'idle', key });
        }
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setStored({ kind: 'error', message, key });
      });
  };

  const isPending = state.kind === 'pending';

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-neutral-100">AI review</h2>
        </div>
        <button
          type="button"
          onClick={runReview}
          disabled={isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-800 bg-violet-950/40 px-2.5 text-sm font-medium text-violet-100 transition-colors hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {state.kind === 'ok' || state.kind === 'error'
            ? 'Re-run review'
            : 'Run review'}
        </button>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {state.kind === 'idle' && (
          <div className="text-sm text-neutral-400">
            Click{' '}
            <span className="font-medium text-neutral-200">Run review</span>{' '}
            to ask Claude to inspect your live runtime config for issues
            the local checker may have missed (security, fragile patterns,
            exposed dashboards, …).
          </div>
        )}

        {state.kind === 'pending' && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Asking Claude for a review of your Traefik configuration…
          </div>
        )}

        {state.kind === 'error' && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2.5"
          >
            <XCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="text-sm font-semibold text-red-200">
                AI review failed
              </div>
              <div className="break-words text-sm text-red-100/90">
                {state.message}
              </div>
            </div>
          </div>
        )}

        {state.kind === 'ok' && <ReviewBody data={state.data} />}
      </div>
    </section>
  );
}

function ReviewBody({ data }: { data: TraefikAiReviewResponse }) {
  const grouped: Record<'error' | 'warning' | 'info', TraefikAiReviewFinding[]> =
    { error: [], warning: [], info: [] };
  for (const f of data.findings) grouped[f.severity].push(f);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-violet-900/60 bg-violet-950/30 px-3 py-2.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-violet-300">
          Summary
        </div>
        <p className="mt-1 text-sm text-violet-100/90">{data.summary}</p>
      </div>

      {data.findings.length === 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Claude has no additional findings.
        </div>
      )}

      {data.findings.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {(['error', 'warning', 'info'] as const).map((sev) => {
            const items = grouped[sev];
            if (items.length === 0) return null;
            return (
              <div key={sev} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  <SeverityIcon severity={sev} />
                  {severityLabel(sev)} ({items.length})
                </div>
                <ul className="flex flex-col gap-1.5">
                  {items.map((f, i) => (
                    <li key={`${sev}-${i}`}>
                      <FindingRow finding={f} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: TraefikAiReviewFinding }) {
  const tint = severityRowTint(finding.severity);
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 ${tint}`}>
      <SeverityIcon severity={finding.severity} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {finding.subject && (
          <span className="truncate font-mono text-xs text-neutral-400">
            {finding.subject}
          </span>
        )}
        <div className="break-words text-sm text-neutral-100/90">
          {finding.message}
        </div>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: 'error' | 'warning' | 'info' }) {
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
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
  );
}

function severityLabel(severity: 'error' | 'warning' | 'info'): string {
  if (severity === 'error') return 'Errors';
  if (severity === 'warning') return 'Warnings';
  return 'Info';
}

function severityRowTint(severity: 'error' | 'warning' | 'info'): string {
  if (severity === 'error') return 'border-red-900/60 bg-red-950/30';
  if (severity === 'warning') return 'border-amber-900/60 bg-amber-950/30';
  return 'border-neutral-800 bg-neutral-900';
}
