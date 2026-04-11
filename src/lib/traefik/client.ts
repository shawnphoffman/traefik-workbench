/**
 * Server-side client for the Traefik REST API.
 *
 * Every call from the workbench server to a user's Traefik instance
 * goes through this module so credentials never reach the browser, all
 * timeouts and TLS handling are uniform, and error translation lives in
 * exactly one place. Routes under `src/app/api/traefik/*` are thin
 * wrappers that call into here and forward the result.
 *
 * The client is intentionally read-only — Traefik's REST API doesn't
 * accept writes, and the workbench's editing flows always go through
 * the file provider in `DATA_DIR`.
 */
import { Agent, type Dispatcher } from 'undici';

import { loadSettings, resolveTraefikConfig } from '@/lib/settings/store';
import type { ResolvedTraefikConfig } from '@/lib/settings/store';

/**
 * Categorized error from a Traefik API call. The page renders the
 * `code` as a short label and the `message` as the body of an error
 * card; raw `fetch failed` strings would be useless to the user.
 */
export type TraefikErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'UNREACHABLE'
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'BAD_RESPONSE'
  | 'HTTP_ERROR';

export class TraefikClientError extends Error {
  constructor(
    public readonly code: TraefikErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'TraefikClientError';
  }
}

/**
 * Cache of undici dispatchers keyed by `insecureTls`. Building an Agent
 * is cheap but reusing one keeps connection pooling working across
 * sequential calls in the same request.
 */
const dispatchers: Record<'secure' | 'insecure', Dispatcher | null> = {
  secure: null,
  insecure: null,
};

function getDispatcher(insecureTls: boolean): Dispatcher {
  const key = insecureTls ? 'insecure' : 'secure';
  let d = dispatchers[key];
  if (d) return d;
  d = new Agent({
    connect: insecureTls ? { rejectUnauthorized: false } : undefined,
  });
  dispatchers[key] = d;
  return d;
}

/**
 * Build the absolute URL for a path against the configured Traefik
 * base. Throws `INVALID_URL` if the user's base + path don't combine
 * cleanly — better to fail loudly than to fan out to a typo'd host.
 */
function buildUrl(base: string, path: string): URL {
  try {
    // Trim trailing slash on base to keep `${base}${path}` joins clean
    // when the user pastes "http://traefik:8080/".
    const cleanBase = base.replace(/\/+$/, '');
    return new URL(`${cleanBase}${path.startsWith('/') ? '' : '/'}${path}`);
  } catch {
    throw new TraefikClientError(
      'INVALID_URL',
      `Could not build a URL from base "${base}" and path "${path}"`,
    );
  }
}

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Translate any thrown error from `fetch` (undici) into a typed
 * `TraefikClientError`. Undici raises `TypeError: fetch failed` with
 * a `cause` chain — the cause's `code`/`name` is what tells us *why*.
 */
function translateFetchError(err: unknown): TraefikClientError {
  if (err instanceof TraefikClientError) return err;
  // AbortError surfaces as `name === 'AbortError'` or `name === 'TimeoutError'`
  // depending on the runtime. Treat both as a timeout — that's the only
  // reason we'd abort a request from inside this module.
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return new TraefikClientError('TIMEOUT', 'Request timed out');
    }
    // Walk the `cause` chain looking for a node-style errno code.
    let cause: unknown = err;
    while (cause instanceof Error) {
      const c = cause as Error & { code?: string };
      if (typeof c.code === 'string') {
        switch (c.code) {
          case 'ECONNREFUSED':
            return new TraefikClientError(
              'UNREACHABLE',
              'Connection refused — is Traefik running and reachable from the workbench?',
            );
          case 'ENOTFOUND':
          case 'EAI_AGAIN':
            return new TraefikClientError(
              'UNREACHABLE',
              'Host not found — check the base URL and DNS reachability',
            );
          case 'ETIMEDOUT':
          case 'UND_ERR_CONNECT_TIMEOUT':
          case 'UND_ERR_HEADERS_TIMEOUT':
          case 'UND_ERR_BODY_TIMEOUT':
            return new TraefikClientError(
              'TIMEOUT',
              'Request timed out before Traefik responded',
            );
          case 'CERT_HAS_EXPIRED':
          case 'DEPTH_ZERO_SELF_SIGNED_CERT':
          case 'SELF_SIGNED_CERT_IN_CHAIN':
          case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
          case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
          case 'ERR_TLS_CERT_ALTNAME_INVALID':
            return new TraefikClientError(
              'TLS_ERROR',
              `TLS verification failed (${c.code}). Enable "Skip TLS verification" if this is a self-signed cert.`,
            );
        }
      }
      cause = (cause as { cause?: unknown }).cause;
    }
    return new TraefikClientError('UNREACHABLE', err.message || 'Network error');
  }
  return new TraefikClientError('UNREACHABLE', String(err));
}

/**
 * Low-level GET against the Traefik API. Always returns parsed JSON on
 * success; throws `TraefikClientError` on any failure (network, TLS,
 * timeout, non-2xx, JSON parse). Callers should not catch generic
 * `Error` — keep error translation here.
 */
export async function traefikGet<T = unknown>(
  config: ResolvedTraefikConfig,
  path: string,
): Promise<T> {
  if (!config.baseUrl) {
    throw new TraefikClientError(
      'NOT_CONFIGURED',
      'No Traefik base URL configured. Set one in Settings.',
    );
  }
  const url = buildUrl(config.baseUrl, path);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (
    config.auth.kind === 'basic' &&
    config.auth.username.length > 0 &&
    config.auth.password
  ) {
    headers.authorization = basicAuthHeader(
      config.auth.username,
      config.auth.password,
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  // Next.js's polyfilled fetch accepts undici's `dispatcher`. Cast
  // through `RequestInit & { dispatcher }` so this stays type-safe
  // without leaking undici types into route handlers.
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    method: 'GET',
    headers,
    signal: controller.signal,
    cache: 'no-store',
    dispatcher: getDispatcher(config.insecureTls),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw translateFetchError(err);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TraefikClientError(
      'AUTH_FAILED',
      res.status === 401
        ? 'Authentication failed (HTTP 401). Check the username and password.'
        : 'Forbidden (HTTP 403). The configured credentials cannot reach this endpoint.',
      res.status,
    );
  }
  if (res.status === 404) {
    throw new TraefikClientError(
      'NOT_FOUND',
      `Endpoint not found at ${path} (HTTP 404)`,
      res.status,
    );
  }
  if (!res.ok) {
    throw new TraefikClientError(
      'HTTP_ERROR',
      `Traefik responded with HTTP ${res.status}`,
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new TraefikClientError(
      'BAD_RESPONSE',
      `Response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      res.status,
    );
  }
  return body as T;
}

/**
 * Liveness check. Tries `pingPath` first (default `/ping`), falling back
 * to `/api/version` if ping is disabled (`pingPath === null`) or returns
 * 404 (some setups don't expose ping but always have `/api/version`).
 *
 * Returns the round-trip time in ms and the version string.
 */
export interface TraefikLiveness {
  reachable: true;
  pingMs: number;
  version: string;
}

export async function traefikPing(
  config: ResolvedTraefikConfig,
): Promise<TraefikLiveness> {
  // Always fetch /api/version — it's the only Traefik endpoint
  // guaranteed to return a payload identifying the instance.
  const start = Date.now();
  const version = await traefikGet<{ Version?: string; version?: string }>(
    config,
    '/api/version',
  );
  const pingMs = Date.now() - start;
  const v = version.Version ?? version.version ?? 'unknown';
  return { reachable: true, pingMs, version: v };
}

/**
 * Convenience: load settings, resolve effective Traefik config, and
 * return it. Throws `NOT_CONFIGURED` if no base URL is available.
 * Use this from route handlers; it's the same handful of lines they'd
 * otherwise duplicate.
 */
export async function getTraefikConfig(): Promise<ResolvedTraefikConfig> {
  const settings = await loadSettings();
  const resolved = resolveTraefikConfig(settings);
  if (!resolved.baseUrl) {
    throw new TraefikClientError(
      'NOT_CONFIGURED',
      'No Traefik base URL configured. Set one in Settings.',
    );
  }
  return resolved;
}
