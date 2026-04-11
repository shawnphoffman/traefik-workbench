/**
 * Path sanitization and resolution.
 *
 * This module is the security foundation of the file API: every
 * user-supplied path MUST flow through `resolveWithinRoot` (or one of the
 * `resolveData*` / `resolveTemplate*` wrappers) before being passed to the
 * filesystem. Failure to do so risks path traversal.
 */

import path from 'node:path';

/**
 * Absolute directory containing YAML files the user can edit.
 *
 * The `turbopackIgnore` comment tells Next.js's build-time file tracer
 * not to follow this call — otherwise it interprets the dynamic
 * `process.env.DATA_DIR` argument as potentially tracing the entire
 * filesystem and emits a warning. The value is still resolved at
 * runtime as expected.
 */
export const DATA_DIR: string = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATA_DIR ?? '/data',
);

/**
 * Absolute directory containing template YAML files.
 *
 * Templates are always editable from the workbench. Mount the volume
 * read-only at the Docker level if you want to prevent writes.
 */
export const TEMPLATES_DIR: string = path.resolve(
  /*turbopackIgnore: true*/ process.env.TEMPLATES_DIR ?? '/templates',
);

/**
 * Resolve a user-supplied relative path against an absolute root, and
 * guarantee the result lies within that root. Returns `null` if the
 * resolved path would escape the root (traversal) or contains invalid
 * characters (null bytes).
 *
 * Accepts either a single string (e.g., `"routers/web.yml"`) or an
 * already-split array of segments (e.g., what Next.js catch-all route
 * params produce).
 *
 * Notes:
 * - Leading slashes on the input are stripped so the path is always
 *   treated as relative to `root`. This prevents `/etc/passwd`-style
 *   inputs from being resolved as absolute.
 * - This is a purely lexical check; it does not resolve symlinks. If the
 *   data directory contains symlinks that escape it, this function will
 *   not detect that. For the intended use case (a Docker bind-mount of
 *   Traefik config), that is acceptable.
 */
export function resolveWithinRoot(
  root: string,
  userPath: string | string[] | undefined,
): string | null {
  const rootAbs = path.resolve(root);

  if (userPath === undefined) return rootAbs;

  const joined = Array.isArray(userPath) ? userPath.join('/') : userPath;

  // Null bytes are rejected by Node's fs APIs anyway, but reject early for
  // clearer error messages and to avoid logging raw bytes.
  if (joined.includes('\0')) return null;

  // Strip leading slashes so path.resolve always treats the input as
  // relative to `rootAbs`. Without this, a user-supplied "/etc/passwd"
  // would resolve to "/etc/passwd" and escape the root.
  const stripped = joined.replace(/^\/+/, '');

  const resolved = path.resolve(rootAbs, stripped);

  if (resolved === rootAbs) return resolved;
  if (resolved.startsWith(rootAbs + path.sep)) return resolved;

  return null;
}

/**
 * Convenience wrapper: resolve a path against `DATA_DIR`.
 */
export function resolveDataPath(
  userPath: string | string[] | undefined,
): string | null {
  return resolveWithinRoot(DATA_DIR, userPath);
}

/**
 * Convenience wrapper: resolve a path against `TEMPLATES_DIR`.
 */
export function resolveTemplatePath(
  userPath: string | string[] | undefined,
): string | null {
  return resolveWithinRoot(TEMPLATES_DIR, userPath);
}

/**
 * Convert an absolute path inside `root` back to a POSIX-style relative
 * path (as used in API responses and URLs). Returns `''` for the root
 * itself.
 */
export function relativeFromRoot(root: string, absolutePath: string): string {
  const rootAbs = path.resolve(root);
  const rel = path.relative(rootAbs, absolutePath);
  if (rel === '') return '';
  // Always use POSIX separators in API paths, even on Windows.
  return rel.split(path.sep).join('/');
}

const YAML_EXTENSION_RE = /\.ya?ml$/i;

/** True if the given filename has a `.yml` or `.yaml` extension. */
export function isYamlFile(name: string): boolean {
  return YAML_EXTENSION_RE.test(name);
}
