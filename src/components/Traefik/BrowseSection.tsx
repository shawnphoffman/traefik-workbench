'use client';

/**
 * Browse panel for the `/traefik` page. Lets the user explore the
 * live runtime config without leaving the workbench:
 *
 *   - Entry points (listening sockets)
 *   - HTTP / TCP / UDP routers, services, middlewares
 *
 * Each tab fetches lazily on first activation and caches the result
 * for the lifetime of the section. The parent's `reloadKey` busts
 * the cache so "Re-test" pulls fresh data. A search box filters by
 * name (and rule, for routers). Items expand inline to show their
 * full JSON — handy when you want to confirm what Traefik actually
 * resolved a label/file/CRD config to.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListTree,
  Loader2,
  Search,
  XCircle,
} from 'lucide-react';

import {
  fetchTraefikEntryPoints,
  fetchTraefikHttpMiddlewares,
  fetchTraefikHttpRouters,
  fetchTraefikHttpServices,
  fetchTraefikTcpRouters,
  fetchTraefikTcpServices,
  fetchTraefikUdpRouters,
  fetchTraefikUdpServices,
  TraefikProxyClientError,
} from '@/lib/api-client';
import type {
  TraefikEntryPoint,
  TraefikItemStatus,
  TraefikMiddleware,
  TraefikRouter,
  TraefikService,
} from '@/lib/traefik/types';

export interface BrowseSectionProps {
  /** Only fetch once the connection card goes green. */
  enabled: boolean;
  /** Bumped by the parent's "Re-test" button to bust the per-tab cache. */
  reloadKey: number;
}

type Protocol = 'http' | 'tcp' | 'udp';

type TabKey =
  | 'entrypoints'
  | 'http/routers'
  | 'http/services'
  | 'http/middlewares'
  | 'tcp/routers'
  | 'tcp/services'
  | 'tcp/middlewares'
  | 'udp/routers'
  | 'udp/services';

interface TabDef {
  key: TabKey;
  label: string;
  protocol: Protocol | null;
}

const TABS: TabDef[] = [
  { key: 'entrypoints', label: 'Entry points', protocol: null },
  { key: 'http/routers', label: 'HTTP routers', protocol: 'http' },
  { key: 'http/services', label: 'HTTP services', protocol: 'http' },
  { key: 'http/middlewares', label: 'HTTP middlewares', protocol: 'http' },
  { key: 'tcp/routers', label: 'TCP routers', protocol: 'tcp' },
  { key: 'tcp/services', label: 'TCP services', protocol: 'tcp' },
  { key: 'udp/routers', label: 'UDP routers', protocol: 'udp' },
  { key: 'udp/services', label: 'UDP services', protocol: 'udp' },
];

/**
 * A completed fetch (success or typed error). The `key` field is the
 * `reloadKey` the entry was fetched for so we can detect stale entries
 * after the parent's "Re-test" bumps the key, without having to reset
 * any state synchronously inside an effect.
 */
type CacheEntry =
  | { kind: 'ok'; data: BrowseItem[]; key: number }
  | { kind: 'error'; code: string; message: string; key: number };

type Cache = Partial<Record<TabKey, CacheEntry>>;

/**
 * Discriminated row type so the renderer can specialize per kind
 * without prop-drilling the active tab everywhere.
 */
type BrowseItem =
  | { kind: 'entrypoint'; data: TraefikEntryPoint }
  | { kind: 'router'; data: TraefikRouter }
  | { kind: 'service'; data: TraefikService }
  | { kind: 'middleware'; data: TraefikMiddleware };

export function BrowseSection({ enabled, reloadKey }: BrowseSectionProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('http/routers');
  const [cache, setCache] = useState<Cache>({});
  const [search, setSearch] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Mirror cache into a ref so the fetch effect can read it without
  // listing `cache` as a dependency. Listing it would re-run the
  // effect on every cache write and create a loop or wasted work.
  // Sync the ref in an effect (never during render) so the read in
  // the fetch effect always sees a stable, committed value.
  const cacheRef = useRef<Cache>(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  // Fetch the active tab whenever it changes or the parent bumps
  // `reloadKey`. The effect performs zero sync setState calls — every
  // mutation happens inside a Promise callback, satisfying the
  // react-hooks/set-state-in-effect rule. Stale-cache invalidation is
  // handled via the per-entry `key` field rather than a reset effect.
  useEffect(() => {
    if (!enabled) return;
    const existing = cacheRef.current[activeTab];
    if (existing && existing.key === reloadKey) return;

    let cancelled = false;
    fetchTab(activeTab)
      .then((data) => {
        if (cancelled) return;
        setCache((prev) => ({
          ...prev,
          [activeTab]: { kind: 'ok', data, key: reloadKey },
        }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const entry: CacheEntry =
          err instanceof TraefikProxyClientError
            ? {
                kind: 'error',
                code: err.code,
                message: err.message,
                key: reloadKey,
              }
            : {
                kind: 'error',
                code: 'HTTP_ERROR',
                message: err instanceof Error ? err.message : String(err),
                key: reloadKey,
              };
        setCache((prev) => ({ ...prev, [activeTab]: entry }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, enabled, reloadKey]);

  // Treat cache entries from a previous reloadKey as if they weren't
  // there yet — they'll be replaced as soon as the in-flight fetch
  // resolves, and meanwhile we render a spinner.
  const rawEntry = cache[activeTab];
  const current: CacheEntry | undefined =
    rawEntry && rawEntry.key === reloadKey ? rawEntry : undefined;
  const isLoading = enabled && current === undefined;

  const filtered = useMemo<BrowseItem[]>(() => {
    if (current?.kind !== 'ok') return [];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return current.data;
    return current.data.filter((item) => matchesSearch(item, q));
  }, [current, search]);

  if (!enabled) return null;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <ListTree className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">Browse</h2>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <nav
          aria-label="Browse categories"
          className="flex flex-wrap gap-1.5"
        >
          {TABS.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={
                  isActive
                    ? 'inline-flex h-8 items-center rounded-md border border-sky-700 bg-sky-950 px-2.5 text-sm font-medium text-sky-100'
                    : 'inline-flex h-8 items-center rounded-md border border-neutral-800 bg-neutral-900 px-2.5 text-sm font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200'
                }
                aria-pressed={isActive}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="h-9 w-full rounded-md border border-neutral-800 bg-neutral-900 pl-8 pr-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-sky-700 focus:outline-none focus:ring-1 focus:ring-sky-700"
            aria-label="Filter list"
          />
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {current?.kind === 'error' && (
          <ErrorCard code={current.code} message={current.message} />
        )}

        {current?.kind === 'ok' && current.data.length === 0 && (
          <EmptyHint message="Traefik returned no items for this collection." />
        )}

        {current?.kind === 'ok' &&
          current.data.length > 0 &&
          filtered.length === 0 && (
            <EmptyHint message={`No matches for "${search}".`} />
          )}

        {current?.kind === 'ok' && filtered.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {filtered.map((item) => {
              const id = itemId(item);
              const isOpen = expanded.has(id);
              return (
                <li key={id}>
                  <BrowseRow
                    item={item}
                    open={isOpen}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

async function fetchTab(tab: TabKey): Promise<BrowseItem[]> {
  switch (tab) {
    case 'entrypoints': {
      const data = await fetchTraefikEntryPoints();
      return data.map((d) => ({ kind: 'entrypoint', data: d }));
    }
    case 'http/routers': {
      const data = await fetchTraefikHttpRouters();
      return data.map((d) => ({ kind: 'router', data: d }));
    }
    case 'http/services': {
      const data = await fetchTraefikHttpServices();
      return data.map((d) => ({ kind: 'service', data: d }));
    }
    case 'http/middlewares': {
      const data = await fetchTraefikHttpMiddlewares();
      return data.map((d) => ({ kind: 'middleware', data: d }));
    }
    case 'tcp/routers': {
      const data = await fetchTraefikTcpRouters();
      return data.map((d) => ({ kind: 'router', data: d }));
    }
    case 'tcp/services': {
      const data = await fetchTraefikTcpServices();
      return data.map((d) => ({ kind: 'service', data: d }));
    }
    case 'tcp/middlewares': {
      // TCP middlewares aren't wired into the proxy because they're
      // rare in practice; the tab definition above also omits them.
      // This case exists only to keep the switch exhaustive.
      return [];
    }
    case 'udp/routers': {
      const data = await fetchTraefikUdpRouters();
      return data.map((d) => ({ kind: 'router', data: d }));
    }
    case 'udp/services': {
      const data = await fetchTraefikUdpServices();
      return data.map((d) => ({ kind: 'service', data: d }));
    }
  }
}

function itemId(item: BrowseItem): string {
  if (item.kind === 'entrypoint') return `ep:${item.data.name}`;
  return `${item.kind}:${item.data.name}`;
}

function matchesSearch(item: BrowseItem, q: string): boolean {
  if (item.kind === 'entrypoint') {
    return (
      item.data.name.toLowerCase().includes(q) ||
      item.data.address.toLowerCase().includes(q)
    );
  }
  if (item.data.name.toLowerCase().includes(q)) return true;
  if (item.kind === 'router' && item.data.rule.toLowerCase().includes(q)) {
    return true;
  }
  return false;
}

function BrowseRow({
  item,
  open,
  onToggle,
}: {
  item: BrowseItem;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-neutral-800/60"
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-neutral-500">
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <StatusDot status={getStatus(item)} />
            <span className="truncate font-mono text-sm text-neutral-100">
              {item.data.name}
            </span>
            {'provider' in item.data && item.data.provider && (
              <ProviderBadge provider={item.data.provider} />
            )}
          </span>
          <RowSummary item={item} />
        </span>
      </button>
      {open && (
        <div className="border-t border-neutral-800 px-3 py-2.5">
          <RowDetails item={item} />
        </div>
      )}
    </div>
  );
}

function getStatus(item: BrowseItem): TraefikItemStatus | null {
  if (item.kind === 'entrypoint') return null;
  return item.data.status ?? null;
}

function StatusDot({ status }: { status: TraefikItemStatus | null }) {
  if (status === null) {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-neutral-600"
        aria-hidden="true"
      />
    );
  }
  if (status === 'enabled') {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400"
        aria-label="Enabled"
      />
    );
  }
  if (status === 'warning') {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400"
        aria-label="Warning"
      />
    );
  }
  return (
    <span
      className="inline-flex h-2 w-2 shrink-0 rounded-full bg-red-400"
      aria-label="Disabled"
    />
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-xs text-neutral-400">
      {provider}
    </span>
  );
}

function RowSummary({ item }: { item: BrowseItem }) {
  if (item.kind === 'entrypoint') {
    return (
      <span className="truncate font-mono text-xs text-neutral-500">
        {item.data.address}
      </span>
    );
  }
  if (item.kind === 'router') {
    return (
      <span className="truncate font-mono text-xs text-neutral-500">
        {item.data.rule}
      </span>
    );
  }
  if (item.kind === 'service') {
    const summary = serviceSummary(item.data);
    return (
      <span className="truncate font-mono text-xs text-neutral-500">
        {summary}
      </span>
    );
  }
  // middleware
  return (
    <span className="truncate font-mono text-xs text-neutral-500">
      {item.data.type ?? '—'}
    </span>
  );
}

function serviceSummary(svc: TraefikService): string {
  if (svc.loadBalancer?.servers && svc.loadBalancer.servers.length > 0) {
    const first = svc.loadBalancer.servers[0];
    const target = first.url ?? first.address ?? '?';
    const more = svc.loadBalancer.servers.length - 1;
    return more > 0 ? `${target} (+${more} more)` : target;
  }
  return svc.type ?? '—';
}

function RowDetails({ item }: { item: BrowseItem }) {
  return (
    <div className="flex flex-col gap-2.5">
      <KeyFields item={item} />
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200">
          Raw JSON
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs leading-relaxed text-neutral-300">
          {JSON.stringify(item.data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/**
 * Highlights the fields users actually care about per kind, so they
 * don't have to skim through the raw JSON for routine inspection.
 */
function KeyFields({ item }: { item: BrowseItem }) {
  if (item.kind === 'entrypoint') {
    const ep = item.data;
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <Field label="Address" value={ep.address} />
        {ep.asDefault && <Field label="Default" value="yes" />}
        {ep.http?.middlewares && ep.http.middlewares.length > 0 && (
          <Field label="Middlewares" value={ep.http.middlewares.join(', ')} />
        )}
      </dl>
    );
  }

  if (item.kind === 'router') {
    const r = item.data;
    return (
      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          <Field label="Rule" value={r.rule} mono />
          <Field label="Service" value={r.service} mono />
          {r.entryPoints && r.entryPoints.length > 0 && (
            <Field label="Entry points" value={r.entryPoints.join(', ')} />
          )}
          {r.middlewares && r.middlewares.length > 0 && (
            <Field label="Middlewares" value={r.middlewares.join(' → ')} mono />
          )}
          {typeof r.priority === 'number' && (
            <Field label="Priority" value={String(r.priority)} />
          )}
          {r.tls && <Field label="TLS" value="yes" />}
        </dl>
        <ErrorList errors={r.error} />
      </div>
    );
  }

  if (item.kind === 'service') {
    const s = item.data;
    const servers = s.loadBalancer?.servers ?? [];
    return (
      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          {s.type && <Field label="Type" value={s.type} />}
          {s.usedBy && s.usedBy.length > 0 && (
            <Field label="Used by" value={s.usedBy.join(', ')} mono />
          )}
        </dl>
        {servers.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              Servers
            </div>
            <ul className="flex flex-col gap-0.5">
              {servers.map((srv, i) => {
                const target = srv.url ?? srv.address ?? '?';
                const status = s.serverStatus?.[target];
                return (
                  <li
                    key={`${target}-${i}`}
                    className="flex items-center gap-2 font-mono text-xs"
                  >
                    {status && <ServerStatusDot status={status} />}
                    <span className="truncate text-neutral-200">{target}</span>
                    {status && (
                      <span
                        className={
                          status === 'UP'
                            ? 'text-emerald-300'
                            : 'text-red-300'
                        }
                      >
                        {status}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <ErrorList errors={s.error} />
      </div>
    );
  }

  // middleware
  const m = item.data;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {m.type && <Field label="Type" value={m.type} />}
        {m.usedBy && m.usedBy.length > 0 && (
          <Field label="Used by" value={m.usedBy.join(', ')} mono />
        )}
      </dl>
      <ErrorList errors={m.error} />
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={
          mono
            ? 'break-all font-mono text-neutral-200'
            : 'break-words text-neutral-200'
        }
      >
        {value}
      </dd>
    </>
  );
}

function ErrorList({ errors }: { errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded border border-red-900/60 bg-red-950/40 px-2.5 py-2">
      {errors.map((e, i) => (
        <li
          key={i}
          className="flex items-start gap-1.5 text-xs text-red-100/90"
        >
          <AlertTriangle
            className="mt-0.5 h-3 w-3 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <span className="break-words">{e}</span>
        </li>
      ))}
    </ul>
  );
}

function ServerStatusDot({ status }: { status: string }) {
  if (status === 'UP') {
    return (
      <span
        className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-red-400"
      aria-hidden="true"
    />
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-500">
      {message}
    </div>
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
