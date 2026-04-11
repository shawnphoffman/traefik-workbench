/**
 * Classify a YAML file as Traefik static, dynamic, or unknown.
 *
 * Static config (typically `traefik.yml`) and dynamic config (router /
 * service / middleware files) have disjoint top-level keys. Mixing
 * suggestions from one type into the other would lead Claude to
 * recommend nonsense, so we tag every file and filter the AI context
 * accordingly.
 *
 * Reference: https://doc.traefik.io/traefik/reference/static-configuration/file/
 *            https://doc.traefik.io/traefik/reference/dynamic-configuration/file/
 *
 * The classifier intentionally uses a string-level scan over top-level
 * keys (rather than a full YAML parse) so it can run on the
 * before-cursor partial document during completion without crashing on
 * mid-edit syntax errors.
 */

import type { TraefikConfigType } from './types';

const STATIC_KEYS = new Set([
  'entryPoints',
  'providers',
  'api',
  'log',
  'accessLog',
  'metrics',
  'ping',
  'tracing',
  'experimental',
  'serversTransport',
  'tcpServersTransport',
  'certificatesResolvers',
  'global',
  'hostResolver',
  'spiffe',
]);

const DYNAMIC_KEYS = new Set(['http', 'tcp', 'udp', 'tls']);

/**
 * Extract top-level YAML keys from a (possibly partial) source string.
 * Cheap regex scan: a top-level key is any line at column 0 that ends
 * in `:`. Skips comments and lines indented under another key. Good
 * enough for classification — we don't need to be a full parser.
 */
function topLevelKeys(source: string): string[] {
  const keys: string[] = [];
  for (const rawLine of source.split('\n')) {
    // Skip blank/comment lines.
    if (rawLine.length === 0 || rawLine[0] === ' ' || rawLine[0] === '\t') {
      continue;
    }
    if (rawLine.startsWith('#') || rawLine.startsWith('---')) continue;
    // Top-level key: matches `name:` or `name: value` (no leading whitespace).
    const match = /^([A-Za-z_][\w-]*)\s*:/.exec(rawLine);
    if (match) keys.push(match[1]);
  }
  return keys;
}

export function classifyTraefikFile(source: string): TraefikConfigType {
  const keys = topLevelKeys(source);
  if (keys.length === 0) return 'unknown';

  let staticHits = 0;
  let dynamicHits = 0;
  for (const k of keys) {
    if (STATIC_KEYS.has(k)) staticHits++;
    if (DYNAMIC_KEYS.has(k)) dynamicHits++;
  }

  if (staticHits > 0 && dynamicHits === 0) return 'static';
  if (dynamicHits > 0 && staticHits === 0) return 'dynamic';
  // Mixed (rare but legal in Traefik) or no recognised top-level keys.
  return 'unknown';
}

/**
 * True if Claude should be allowed to use `b` as context when editing a
 * file of type `a`. Static and dynamic never mix; unknown is permissive
 * (we don't want to silo a `docker-compose.yml` from anything).
 */
export function typesCompatible(
  a: TraefikConfigType,
  b: TraefikConfigType,
): boolean {
  if (a === 'unknown' || b === 'unknown') return true;
  return a === b;
}
