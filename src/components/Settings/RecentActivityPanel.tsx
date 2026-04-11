'use client';

/**
 * Renders the in-memory ring buffer of recent AI calls. Cleared on
 * server restart by design — this is a quick observability window into
 * what Claude is doing, not an audit log.
 */

import { Activity, AlertCircle, CheckCircle2, MinusCircle } from 'lucide-react';

import type { AiActivityEntry, AiActivityStatus } from '@/lib/ai/activity';

export interface RecentActivityPanelProps {
  entries: AiActivityEntry[];
}

export function RecentActivityPanel({ entries }: RecentActivityPanelProps) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Activity className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">
          Recent AI activity
        </h2>
        <span className="text-sm text-neutral-500">
          (last {entries.length}, cleared on server restart)
        </span>
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900">
            <Activity
              className="h-5 w-5 text-neutral-600"
              aria-hidden="true"
            />
          </div>
          <div className="max-w-xs text-base text-neutral-500">
            No AI calls yet. Activity will appear here as you use completion,
            validation, format, or test connection.
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-900">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 px-4 py-3 text-base"
            >
              <StatusIcon status={entry.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm uppercase tracking-wide text-neutral-300">
                    {entry.route}
                  </span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-400">{entry.latencyMs} ms</span>
                  <span className="text-neutral-500">·</span>
                  <time className="text-neutral-500" dateTime={entry.timestamp}>
                    {formatTimestamp(entry.timestamp)}
                  </time>
                </div>
                {entry.activePath && (
                  <div className="mt-0.5 truncate font-mono text-sm text-neutral-500">
                    {entry.activePath}
                  </div>
                )}
                {entry.error && (
                  <div className="mt-0.5 truncate text-sm text-red-300">
                    {entry.error}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: AiActivityStatus }) {
  if (status === 'ok') {
    return (
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
        aria-label="ok"
      />
    );
  }
  if (status === 'error') {
    return (
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
        aria-label="error"
      />
    );
  }
  return (
    <MinusCircle
      className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500"
      aria-label="disabled"
    />
  );
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
