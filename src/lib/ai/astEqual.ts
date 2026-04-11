/**
 * Deep structural equality between two parsed YAML documents.
 *
 * Used by the format route as the "no weird loose ends" guarantee:
 * Claude is allowed to change whitespace, comments position, key order,
 * and quoting — but not values, key names, or document shape. Any
 * formatted output whose parsed AST diverges from the input is
 * rejected and the route returns 422.
 *
 * The comparison normalizes:
 *   - Map key order (object equality is order-independent)
 *   - String/number/boolean/null scalars (compared by value)
 *
 * It does NOT normalize:
 *   - Type coercion (string "1" ≠ number 1, by design — that would let
 *     Claude silently retype values)
 */

import { parse as parseYamlValue } from 'yaml';

export interface AstCompareResult {
  equal: boolean;
  /** First divergence path, if any (e.g. `http.routers.web.rule`). */
  diff?: string;
}

export function yamlAstEqual(a: string, b: string): AstCompareResult {
  let parsedA: unknown;
  let parsedB: unknown;
  try {
    parsedA = parseYamlValue(a);
  } catch (err) {
    return { equal: false, diff: `input: ${(err as Error).message}` };
  }
  try {
    parsedB = parseYamlValue(b);
  } catch (err) {
    return { equal: false, diff: `output: ${(err as Error).message}` };
  }
  const diff = deepDiff(parsedA, parsedB, '');
  return diff == null ? { equal: true } : { equal: false, diff };
}

function deepDiff(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;

  // null / undefined are interchangeable in YAML's empty-value cases.
  if (a == null && b == null) return null;
  if (a == null || b == null) return path || '<root>';

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return path || '<root>';

  if (ta === 'number' || ta === 'string' || ta === 'boolean') {
    return a === b ? null : path || '<root>';
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return path || '<root>';
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const sub = deepDiff(a[i], b[i], `${path}[${i}]`);
      if (sub) return sub;
    }
    return null;
  }

  // Plain object (YAML map → JS object)
  if (ta === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const keysA = Object.keys(oa).sort();
    const keysB = Object.keys(ob).sort();
    if (keysA.length !== keysB.length) return path || '<root>';
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return `${path}.${keysA[i] ?? keysB[i]}`;
    }
    for (const k of keysA) {
      const sub = deepDiff(oa[k], ob[k], path === '' ? k : `${path}.${k}`);
      if (sub) return sub;
    }
    return null;
  }

  return path || '<root>';
}
