'use client';

/**
 * Read-only Traefik integration page. Phase 1 is just the connection
 * bar — overview, browse, diagnostics, and AI review come in later
 * phases. The page is reachable via the network icon in `AppHeader`,
 * which only renders when a base URL is configured in Settings.
 *
 * If someone navigates here directly without configuration we still
 * render an empty state with a deep link back to Settings, so the
 * page never crashes on a missing config.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Network,
  RefreshCw,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';

import { fetchSettings, testTraefik } from '@/lib/api-client';
import type { MaskedSettings } from '@/lib/settings/types';

import { BrowseSection } from './BrowseSection';
import { OverviewSection } from './OverviewSection';

type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; version: string; pingMs: number }
  | { kind: 'error'; code: string; message: string; status: number | null };

export function TraefikPage() {
  const [settings, setSettings] = useState<MaskedSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'idle' });
  // Bumped on every re-test so child sections (Overview, Browse) drop
  // their caches and re-fetch in lock-step with the connection check.
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Single bootstrap effect: load settings, then immediately kick off
  // a connection test if configured. Doing both inside one async chain
  // (rather than reacting to `settings.configured` in a second effect)
  // keeps the setState calls outside an effect body, satisfying the
  // react-hooks/set-state-in-effect lint rule, and gives the page a
  // green/red dot on first paint instead of "click to find out".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: MaskedSettings | null = null;
      try {
        loaded = await fetchSettings();
        if (cancelled) return;
        setSettings(loaded);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!loaded.traefik.configured) return;
      setConnection({ kind: 'pending' });
      const result = await testTraefik();
      if (cancelled) return;
      if (result.ok) {
        setConnection({
          kind: 'ok',
          version: result.version ?? 'unknown',
          pingMs: result.pingMs ?? 0,
        });
      } else {
        setConnection({
          kind: 'error',
          code: result.code ?? 'HTTP_ERROR',
          message: result.error ?? 'Unknown error',
          status: result.status ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runTest = useCallback(async () => {
    setConnection({ kind: 'pending' });
    setReloadKey((k) => k + 1);
    const result = await testTraefik();
    if (result.ok) {
      setConnection({
        kind: 'ok',
        version: result.version ?? 'unknown',
        pingMs: result.pingMs ?? 0,
      });
    } else {
      setConnection({
        kind: 'error',
        code: result.code ?? 'HTTP_ERROR',
        message: result.error ?? 'Unknown error',
        status: result.status ?? null,
      });
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
            aria-label="Back to editor"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt=""
              width={28}
              height={28}
              priority
              className="h-6 w-6"
            />
            <span className="text-lg font-semibold tracking-tight text-neutral-100">
              Traefik
            </span>
          </div>
        </div>
        {settings?.traefik.configured && (
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={connection.kind === 'pending'}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Re-test connection"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Re-test
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          )}

          {loadError && (
            <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
              <div className="font-medium">Failed to load settings</div>
              <div className="mt-1 text-red-300">{loadError}</div>
            </div>
          )}

          {settings && !settings.traefik.configured && <EmptyState />}

          {settings?.traefik.configured && (
            <ConnectionCard
              baseUrl={settings.traefik.baseUrl ?? ''}
              source={settings.traefik.baseUrlSource}
              connection={connection}
            />
          )}

          {settings?.traefik.configured && (
            <OverviewSection
              enabled={connection.kind === 'ok'}
              reloadKey={reloadKey}
            />
          )}

          {settings?.traefik.configured && (
            <BrowseSection
              enabled={connection.kind === 'ok'}
              reloadKey={reloadKey}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-6">
      <div className="flex items-center gap-2">
        <Network className="h-5 w-5 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">
          Connect to Traefik
        </h2>
      </div>
      <p className="text-sm text-neutral-400">
        Set the Traefik API base URL in Settings to enable this page. The
        workbench only reads from Traefik — it never writes back.
      </p>
      <Link
        href="/settings"
        className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-md border border-sky-700 bg-sky-950 px-3 text-base font-medium text-sky-100 transition-colors hover:bg-sky-900"
      >
        <SettingsIcon className="h-4 w-4" aria-hidden="true" />
        Open Settings
      </Link>
    </section>
  );
}

function ConnectionCard({
  baseUrl,
  source,
  connection,
}: {
  baseUrl: string;
  source: 'file' | 'env' | 'none';
  connection: ConnectionState;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-sky-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-neutral-100">Connection</h2>
        </div>
        <Link
          href="/settings"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
        >
          <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Edit in Settings
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </header>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <StatusDot connection={connection} />
          <code className="break-all rounded bg-neutral-900 px-2.5 py-1 font-mono text-base text-neutral-200">
            {baseUrl}
          </code>
          {source === 'env' && (
            <span className="inline-flex items-center rounded-full border border-amber-800/60 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
              from env
            </span>
          )}
        </div>
        <ConnectionDetail connection={connection} />
      </div>
    </section>
  );
}

function StatusDot({ connection }: { connection: ConnectionState }) {
  if (connection.kind === 'ok') {
    return (
      <span
        className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30"
        aria-label="Reachable"
      />
    );
  }
  if (connection.kind === 'error') {
    return (
      <span
        className="inline-flex h-2.5 w-2.5 rounded-full bg-red-400 ring-2 ring-red-400/30"
        aria-label="Unreachable"
      />
    );
  }
  if (connection.kind === 'pending') {
    return (
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-neutral-400"
        aria-label="Testing"
      />
    );
  }
  return (
    <span
      className="inline-flex h-2.5 w-2.5 rounded-full bg-neutral-600"
      aria-label="Untested"
    />
  );
}

function ConnectionDetail({ connection }: { connection: ConnectionState }) {
  if (connection.kind === 'ok') {
    return (
      <div className="flex items-center gap-1.5 text-base text-emerald-300">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Connected to Traefik {connection.version} ({connection.pingMs} ms)
      </div>
    );
  }
  if (connection.kind === 'error') {
    const parts: string[] = [];
    if (typeof connection.status === 'number')
      parts.push(`HTTP ${connection.status}`);
    parts.push(connection.code);
    return (
      <div
        role="alert"
        className="flex w-full items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2.5"
      >
        <XCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="text-sm font-semibold text-red-200">
            {parts.join(' · ')}
          </div>
          <div className="break-words text-sm text-red-100/90">
            {connection.message}
          </div>
        </div>
      </div>
    );
  }
  if (connection.kind === 'pending') {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Testing connection…
      </div>
    );
  }
  return null;
}
