/**
 * Hand-rolled validators for settings JSON. Matches the project's
 * existing zero-runtime-deps style (`api-errors.ts`, `paths.ts`).
 *
 * Every validator returns either `{ ok: true, value }` (parsed and
 * normalized) or `{ ok: false, error }` (with a human-readable message
 * naming the offending field). Used by both the settings store on read
 * and the `PUT /api/settings` route on write.
 */

import {
  AI_MODEL_CHOICES,
  DEFAULT_AI_MODEL,
  type AiFeatureFlags,
  type AiModel,
  type Settings,
  type SettingsPatch,
  type TraefikAuth,
  type TraefikSettings,
} from './types';

/** Hard ceiling for `traefik.timeoutMs` so a typo can't wedge the page. */
const TRAEFIK_TIMEOUT_MIN = 250;
const TRAEFIK_TIMEOUT_MAX = 60_000;
const TRAEFIK_TIMEOUT_DEFAULT = 5_000;

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Default ignore patterns applied to a fresh settings file. We seed
 * the obvious noise (`.git/`, `node_modules/`, OS metadata) so the
 * file tree doesn't look like a junk drawer on first boot. Users can
 * remove or extend these from the Settings page.
 */
export const DEFAULT_TREE_IGNORE_PATTERNS: readonly string[] = [
  '.git/',
  '.DS_Store',
  'node_modules/',
];

/** Default settings used when no settings file exists yet. */
export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    ai: {
      enabled: false,
      apiKey: null,
      model: DEFAULT_AI_MODEL,
      features: {
        completion: true,
        validation: true,
        format: true,
      },
    },
    tree: {
      ignorePatterns: [...DEFAULT_TREE_IGNORE_PATTERNS],
    },
    traefik: defaultTraefikSettings(),
  };
}

export function defaultTraefikSettings(): TraefikSettings {
  return {
    baseUrl: null,
    auth: { kind: 'none' },
    insecureTls: false,
    pingPath: '/ping',
    timeoutMs: TRAEFIK_TIMEOUT_DEFAULT,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAiModel(v: unknown): v is AiModel {
  return typeof v === 'string' && (AI_MODEL_CHOICES as readonly string[]).includes(v);
}

/**
 * Parse an arbitrary JSON value into a Settings record. Unknown fields
 * are dropped (no `additionalProperties`). Missing fields fall back to
 * defaults so partial / older files still load.
 */
export function parseSettings(raw: unknown): ValidateResult<Settings> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'settings.json is not a JSON object' };
  }

  const defaults = defaultSettings();
  const ai = isPlainObject(raw.ai) ? raw.ai : {};

  // enabled
  const enabled =
    typeof ai.enabled === 'boolean' ? ai.enabled : defaults.ai.enabled;

  // apiKey
  let apiKey: string | null;
  if (ai.apiKey === null || ai.apiKey === undefined) {
    apiKey = null;
  } else if (typeof ai.apiKey === 'string') {
    apiKey = ai.apiKey.length > 0 ? ai.apiKey : null;
  } else {
    return { ok: false, error: 'ai.apiKey must be a string or null' };
  }

  // model
  const model = isAiModel(ai.model) ? ai.model : defaults.ai.model;

  // features
  const featuresRaw = isPlainObject(ai.features) ? ai.features : {};
  const features: AiFeatureFlags = {
    completion:
      typeof featuresRaw.completion === 'boolean'
        ? featuresRaw.completion
        : defaults.ai.features.completion,
    validation:
      typeof featuresRaw.validation === 'boolean'
        ? featuresRaw.validation
        : defaults.ai.features.validation,
    format:
      typeof featuresRaw.format === 'boolean'
        ? featuresRaw.format
        : defaults.ai.features.format,
  };

  // tree
  const treeRaw = isPlainObject(raw.tree) ? raw.tree : {};
  let ignorePatterns: string[];
  if (Array.isArray(treeRaw.ignorePatterns)) {
    // Drop non-strings and empty entries silently — unknown shapes
    // shouldn't take down the whole settings file.
    ignorePatterns = treeRaw.ignorePatterns
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  } else {
    // Missing field falls back to defaults so older settings files
    // pick up the new noise filters automatically.
    ignorePatterns = [...defaults.tree.ignorePatterns];
  }

  // traefik
  const traefikResult = parseTraefikSection(raw.traefik, defaults.traefik);
  if (!traefikResult.ok) return traefikResult;

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      ai: { enabled, apiKey, model, features },
      tree: { ignorePatterns },
      traefik: traefikResult.value,
    },
  };
}

function parseTraefikSection(
  raw: unknown,
  defaults: TraefikSettings,
): ValidateResult<TraefikSettings> {
  if (raw === undefined) return { ok: true, value: { ...defaults } };
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'traefik must be an object' };
  }

  // baseUrl
  let baseUrl: string | null;
  if (raw.baseUrl === undefined || raw.baseUrl === null) {
    baseUrl = null;
  } else if (typeof raw.baseUrl === 'string') {
    const trimmed = raw.baseUrl.trim();
    baseUrl = trimmed.length > 0 ? trimmed : null;
  } else {
    return { ok: false, error: 'traefik.baseUrl must be a string or null' };
  }

  // auth
  const authRaw = raw.auth;
  let auth: TraefikAuth = { kind: 'none' };
  if (authRaw !== undefined) {
    if (!isPlainObject(authRaw)) {
      return { ok: false, error: 'traefik.auth must be an object' };
    }
    if (authRaw.kind === 'none') {
      auth = { kind: 'none' };
    } else if (authRaw.kind === 'basic') {
      const username =
        typeof authRaw.username === 'string' ? authRaw.username : '';
      let password: string | null;
      if (authRaw.password === undefined || authRaw.password === null) {
        password = null;
      } else if (typeof authRaw.password === 'string') {
        password = authRaw.password.length > 0 ? authRaw.password : null;
      } else {
        return {
          ok: false,
          error: 'traefik.auth.password must be a string or null',
        };
      }
      auth = { kind: 'basic', username, password };
    } else {
      return {
        ok: false,
        error: "traefik.auth.kind must be 'none' or 'basic'",
      };
    }
  }

  // insecureTls
  const insecureTls =
    typeof raw.insecureTls === 'boolean' ? raw.insecureTls : defaults.insecureTls;

  // pingPath
  let pingPath: string | null;
  if (raw.pingPath === undefined) {
    pingPath = defaults.pingPath;
  } else if (raw.pingPath === null) {
    pingPath = null;
  } else if (typeof raw.pingPath === 'string') {
    const trimmed = raw.pingPath.trim();
    pingPath = trimmed.length > 0 ? trimmed : null;
  } else {
    return { ok: false, error: 'traefik.pingPath must be a string or null' };
  }

  // timeoutMs
  let timeoutMs = defaults.timeoutMs;
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs)) {
      return { ok: false, error: 'traefik.timeoutMs must be a number' };
    }
    timeoutMs = clampTimeout(raw.timeoutMs);
  }

  return {
    ok: true,
    value: { baseUrl, auth, insecureTls, pingPath, timeoutMs },
  };
}

function clampTimeout(value: number): number {
  if (value < TRAEFIK_TIMEOUT_MIN) return TRAEFIK_TIMEOUT_MIN;
  if (value > TRAEFIK_TIMEOUT_MAX) return TRAEFIK_TIMEOUT_MAX;
  return Math.round(value);
}

/**
 * Validate a `PUT /api/settings` body. Strict — unknown fields are not
 * an error (they're ignored), but type mismatches are.
 */
export function parsePatch(raw: unknown): ValidateResult<SettingsPatch> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'request body is not a JSON object' };
  }

  const patch: SettingsPatch = {};
  if (raw.ai !== undefined) {
    if (!isPlainObject(raw.ai)) {
      return { ok: false, error: 'ai must be an object' };
    }
    const aiPatch: NonNullable<SettingsPatch['ai']> = {};
    const r = raw.ai;

    if (r.enabled !== undefined) {
      if (typeof r.enabled !== 'boolean') {
        return { ok: false, error: 'ai.enabled must be a boolean' };
      }
      aiPatch.enabled = r.enabled;
    }
    if (r.apiKey !== undefined) {
      if (r.apiKey !== null && typeof r.apiKey !== 'string') {
        return { ok: false, error: 'ai.apiKey must be a string or null' };
      }
      aiPatch.apiKey = r.apiKey === null ? null : (r.apiKey as string);
    }
    if (r.model !== undefined) {
      if (!isAiModel(r.model)) {
        return {
          ok: false,
          error: `ai.model must be one of: ${AI_MODEL_CHOICES.join(', ')}`,
        };
      }
      aiPatch.model = r.model;
    }
    if (r.features !== undefined) {
      if (!isPlainObject(r.features)) {
        return { ok: false, error: 'ai.features must be an object' };
      }
      const f: Partial<AiFeatureFlags> = {};
      for (const k of ['completion', 'validation', 'format'] as const) {
        if (r.features[k] !== undefined) {
          if (typeof r.features[k] !== 'boolean') {
            return {
              ok: false,
              error: `ai.features.${k} must be a boolean`,
            };
          }
          f[k] = r.features[k] as boolean;
        }
      }
      aiPatch.features = f;
    }
    patch.ai = aiPatch;
  }

  if (raw.tree !== undefined) {
    if (!isPlainObject(raw.tree)) {
      return { ok: false, error: 'tree must be an object' };
    }
    const treePatch: NonNullable<SettingsPatch['tree']> = {};
    const t = raw.tree;
    if (t.ignorePatterns !== undefined) {
      if (!Array.isArray(t.ignorePatterns)) {
        return { ok: false, error: 'tree.ignorePatterns must be an array' };
      }
      const cleaned: string[] = [];
      for (const entry of t.ignorePatterns) {
        if (typeof entry !== 'string') {
          return {
            ok: false,
            error: 'tree.ignorePatterns must be an array of strings',
          };
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) cleaned.push(trimmed);
      }
      treePatch.ignorePatterns = cleaned;
    }
    patch.tree = treePatch;
  }

  if (raw.traefik !== undefined) {
    const traefikResult = parseTraefikPatch(raw.traefik);
    if (!traefikResult.ok) return traefikResult;
    patch.traefik = traefikResult.value;
  }

  return { ok: true, value: patch };
}

function parseTraefikPatch(
  raw: unknown,
): ValidateResult<NonNullable<SettingsPatch['traefik']>> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'traefik must be an object' };
  }
  const out: NonNullable<SettingsPatch['traefik']> = {};

  if (raw.baseUrl !== undefined) {
    if (raw.baseUrl === null) {
      out.baseUrl = null;
    } else if (typeof raw.baseUrl === 'string') {
      const trimmed = raw.baseUrl.trim();
      // Reject syntactically broken URLs early so the user sees the
      // problem in Settings rather than as a confusing 500 from /test.
      if (trimmed.length > 0) {
        try {
          new URL(trimmed);
        } catch {
          return {
            ok: false,
            error: 'traefik.baseUrl must be a valid URL (e.g. http://traefik:8080)',
          };
        }
      }
      out.baseUrl = trimmed.length > 0 ? trimmed : null;
    } else {
      return { ok: false, error: 'traefik.baseUrl must be a string or null' };
    }
  }

  if (raw.auth !== undefined) {
    if (!isPlainObject(raw.auth)) {
      return { ok: false, error: 'traefik.auth must be an object' };
    }
    if (raw.auth.kind === 'none') {
      out.auth = { kind: 'none' };
    } else if (raw.auth.kind === 'basic') {
      const a: { kind: 'basic'; username?: string; password?: string | null } = {
        kind: 'basic',
      };
      if (raw.auth.username !== undefined) {
        if (typeof raw.auth.username !== 'string') {
          return {
            ok: false,
            error: 'traefik.auth.username must be a string',
          };
        }
        a.username = raw.auth.username;
      }
      if (raw.auth.password !== undefined) {
        if (raw.auth.password !== null && typeof raw.auth.password !== 'string') {
          return {
            ok: false,
            error: 'traefik.auth.password must be a string or null',
          };
        }
        a.password = raw.auth.password;
      }
      out.auth = a;
    } else {
      return {
        ok: false,
        error: "traefik.auth.kind must be 'none' or 'basic'",
      };
    }
  }

  if (raw.insecureTls !== undefined) {
    if (typeof raw.insecureTls !== 'boolean') {
      return { ok: false, error: 'traefik.insecureTls must be a boolean' };
    }
    out.insecureTls = raw.insecureTls;
  }

  if (raw.pingPath !== undefined) {
    if (raw.pingPath === null) {
      out.pingPath = null;
    } else if (typeof raw.pingPath === 'string') {
      const trimmed = raw.pingPath.trim();
      out.pingPath = trimmed.length > 0 ? trimmed : null;
    } else {
      return {
        ok: false,
        error: 'traefik.pingPath must be a string or null',
      };
    }
  }

  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs)) {
      return { ok: false, error: 'traefik.timeoutMs must be a number' };
    }
    out.timeoutMs = clampTimeout(raw.timeoutMs);
  }

  return { ok: true, value: out };
}

/**
 * Apply a validated patch on top of an existing Settings record. Returns
 * a new object — does not mutate.
 */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  if (!patch.ai && !patch.tree && !patch.traefik) return current;
  const next: Settings = {
    schemaVersion: 1,
    ai: { ...current.ai, features: { ...current.ai.features } },
    tree: { ...current.tree, ignorePatterns: [...current.tree.ignorePatterns] },
    traefik: cloneTraefik(current.traefik),
  };
  if (patch.ai) {
    if (patch.ai.enabled !== undefined) next.ai.enabled = patch.ai.enabled;
    if (patch.ai.apiKey !== undefined) {
      // null clears, string sets, omitted leaves alone (handled above)
      next.ai.apiKey = patch.ai.apiKey;
    }
    if (patch.ai.model !== undefined) next.ai.model = patch.ai.model;
    if (patch.ai.features) {
      next.ai.features = { ...next.ai.features, ...patch.ai.features };
    }
  }
  if (patch.tree) {
    if (patch.tree.ignorePatterns !== undefined) {
      next.tree.ignorePatterns = [...patch.tree.ignorePatterns];
    }
  }
  if (patch.traefik) {
    const t = patch.traefik;
    if (t.baseUrl !== undefined) next.traefik.baseUrl = t.baseUrl;
    if (t.insecureTls !== undefined) next.traefik.insecureTls = t.insecureTls;
    if (t.pingPath !== undefined) next.traefik.pingPath = t.pingPath;
    if (t.timeoutMs !== undefined) next.traefik.timeoutMs = t.timeoutMs;
    if (t.auth !== undefined) {
      if (t.auth.kind === 'none') {
        next.traefik.auth = { kind: 'none' };
      } else {
        // basic — merge with existing basic auth so a partial patch
        // (e.g. just rotating the password) doesn't drop the username.
        const existing =
          current.traefik.auth.kind === 'basic'
            ? current.traefik.auth
            : { kind: 'basic' as const, username: '', password: null };
        next.traefik.auth = {
          kind: 'basic',
          username: t.auth.username !== undefined ? t.auth.username : existing.username,
          password: t.auth.password !== undefined ? t.auth.password : existing.password,
        };
      }
    }
  }
  return next;
}

function cloneTraefik(t: TraefikSettings): TraefikSettings {
  return {
    baseUrl: t.baseUrl,
    auth:
      t.auth.kind === 'basic'
        ? { kind: 'basic', username: t.auth.username, password: t.auth.password }
        : { kind: 'none' },
    insecureTls: t.insecureTls,
    pingPath: t.pingPath,
    timeoutMs: t.timeoutMs,
  };
}
