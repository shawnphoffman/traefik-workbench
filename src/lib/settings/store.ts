/**
 * Persistence layer for app settings.
 *
 * Settings live as a single JSON file under `CONFIG_DIR` (default
 * `/config`, dev default `./.local-dev/config`). The file is mode 0600
 * because it stores the Anthropic API key in plaintext — see the README
 * "AI features (optional)" section for the trust model.
 *
 * Concurrency: this is a single-user workbench, so the only race we care
 * about is two PUT /api/settings requests landing in the same tick. We
 * use atomic write (temp + rename) for crash-safety, but no in-process
 * locking — last write wins. Acceptable for the v1 scope.
 *
 * Caching: we deliberately re-read on every call. Settings are tiny and
 * the read happens at most once per AI call, so the cost is negligible
 * compared to a Claude round-trip. Avoiding a cache means a Settings
 * page save is reflected immediately by all subsequent AI requests
 * without any invalidation plumbing.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { defaultSettings, parseSettings } from './schema';
import type { Settings } from './types';

/**
 * Absolute directory containing the workbench's own settings (not user
 * YAML — that's `DATA_DIR`). The `turbopackIgnore` comment matches the
 * pattern used in `paths.ts` so the build-time tracer doesn't try to
 * follow this dynamic path.
 *
 * Container default is `/config` (matches the docker-compose volume).
 * In dev (`NODE_ENV !== 'production'`) we fall back to a writable
 * sibling of the project root so the workbench Just Works without root
 * permissions or volume setup.
 */
function defaultConfigDir(): string {
  if (process.env.NODE_ENV === 'production') return '/config';
  return path.resolve(process.cwd(), '.local-dev', 'config');
}

export const CONFIG_DIR: string = path.resolve(
  /*turbopackIgnore: true*/ process.env.CONFIG_DIR ?? defaultConfigDir(),
);

const SETTINGS_FILENAME = 'settings.json';

export function settingsFilePath(): string {
  return path.join(CONFIG_DIR, SETTINGS_FILENAME);
}

/**
 * Ensure the config directory exists. Called lazily before any read or
 * write so the workbench works on first run with no manual setup.
 */
async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Load settings from disk. Returns the defaults if the file doesn't
 * exist. Throws if the file exists but is unreadable or contains
 * invalid JSON — those are real errors the operator should see.
 */
export async function loadSettings(): Promise<Settings> {
  const file = settingsFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (isErrno(err) && err.code === 'ENOENT') {
      return defaultSettings();
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `settings.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const result = parseSettings(parsed);
  if (!result.ok) {
    throw new Error(`Invalid settings.json: ${result.error}`);
  }
  return result.value;
}

/**
 * Atomically persist settings to disk. The file is written with mode
 * 0600 because it contains the API key in plaintext. We always set the
 * mode explicitly (rather than just `chmod` after the rename) so a
 * concurrent reader can never see a world-readable temp file.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await ensureConfigDir();
  const file = settingsFilePath();
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify(settings, null, 2) + '\n';
  // Open with explicit mode so the temp file is also 0600.
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(body, 'utf8');
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  // Belt-and-braces: re-chmod after rename in case the umask altered things
  // on the first creation.
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Best-effort — Windows / unusual filesystems may not support it.
  }
}

/**
 * Resolve which API key the server should use for Claude calls. The
 * file-stored key wins; the `ANTHROPIC_API_KEY` env var is the fallback
 * (so Docker secrets users don't have to use the UI).
 *
 * Returns `{ key, source }` where `source` is what the Settings page
 * displays in its banner.
 */
export function resolveApiKey(settings: Settings): {
  key: string | null;
  source: 'file' | 'env' | 'none';
} {
  if (settings.ai.apiKey) {
    return { key: settings.ai.apiKey, source: 'file' };
  }
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.length > 0) {
    return { key: envKey, source: 'env' };
  }
  return { key: null, source: 'none' };
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}
