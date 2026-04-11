/**
 * Subset of Traefik API response types we actually consume.
 *
 * Traefik's `/api/*` endpoints return rich JSON with many fields we
 * don't care about (provider internals, transport sub-objects, etc.).
 * Modeling only what the workbench needs keeps the surface tight and
 * avoids tying our UI to Traefik's full schema.
 *
 * All field names match Traefik's wire format exactly (camelCase for
 * the dynamic-config sections, lowercase for the overview counters).
 * Don't rename — these are pass-through types straight off the wire.
 */

/** Lifecycle status of any router/service/middleware. */
export type TraefikItemStatus = 'enabled' | 'disabled' | 'warning';

/** `/api/overview` — counts + provider/feature summary. */
export interface TraefikOverview {
  http?: TraefikOverviewSection;
  tcp?: TraefikOverviewSection;
  udp?: TraefikOverviewSection;
  features?: {
    tracing?: string;
    metrics?: string;
    accessLog?: boolean;
    hub?: boolean;
  };
  providers?: string[];
}

export interface TraefikOverviewSection {
  routers?: TraefikCountBlock;
  services?: TraefikCountBlock;
  middlewares?: TraefikCountBlock;
}

export interface TraefikCountBlock {
  total?: number;
  warnings?: number;
  errors?: number;
}

/** `/api/entrypoints` — listening sockets. */
export interface TraefikEntryPoint {
  name: string;
  address: string;
  asDefault?: boolean;
  http?: {
    middlewares?: string[];
    tls?: Record<string, unknown>;
  };
}

/** Common fields shared by routers/services/middlewares. */
interface TraefikItemBase {
  name: string;
  provider: string;
  status?: TraefikItemStatus;
  /** Free-form error strings from Traefik when status is `disabled`. */
  error?: string[];
}

export interface TraefikRouter extends TraefikItemBase {
  entryPoints?: string[];
  service: string;
  rule: string;
  ruleSyntax?: string;
  priority?: number;
  middlewares?: string[];
  tls?: Record<string, unknown>;
  using?: string[];
}

/**
 * Service shape covers loadBalancer / weighted / mirroring / failover.
 * The workbench only ever inspects load-balancer details (URL list and
 * per-server up/down status), so the other variants stay loosely typed.
 */
export interface TraefikService extends TraefikItemBase {
  type?: string;
  usedBy?: string[];
  loadBalancer?: {
    servers?: { url?: string; address?: string }[];
    passHostHeader?: boolean;
    serversTransport?: string;
  };
  weighted?: { services?: { name: string; weight?: number }[] };
  mirroring?: { service?: string; mirrors?: { name: string }[] };
  failover?: { service?: string; fallback?: string };
  serverStatus?: Record<string, 'UP' | 'DOWN' | string>;
}

export interface TraefikMiddleware extends TraefikItemBase {
  type?: string;
  usedBy?: string[];
  /**
   * Middleware config keys vary by type (basicAuth, stripPrefix, …).
   * We render the JSON verbatim in the expand panel; no need to model
   * every variant up front.
   */
  [key: string]: unknown;
}

/** `/api/version`. Traefik returns `Version` (capitalized) on most builds. */
export interface TraefikVersion {
  Version?: string;
  version?: string;
  Codename?: string;
  codeName?: string;
  startDate?: string;
}
