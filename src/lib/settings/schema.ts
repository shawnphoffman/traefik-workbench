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
} from './types';

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

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

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      ai: { enabled, apiKey, model, features },
    },
  };
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

  return { ok: true, value: patch };
}

/**
 * Apply a validated patch on top of an existing Settings record. Returns
 * a new object — does not mutate.
 */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  if (!patch.ai) return current;
  const next: Settings = {
    schemaVersion: 1,
    ai: { ...current.ai, features: { ...current.ai.features } },
  };
  if (patch.ai.enabled !== undefined) next.ai.enabled = patch.ai.enabled;
  if (patch.ai.apiKey !== undefined) {
    // null clears, string sets, omitted leaves alone (handled above)
    next.ai.apiKey = patch.ai.apiKey;
  }
  if (patch.ai.model !== undefined) next.ai.model = patch.ai.model;
  if (patch.ai.features) {
    next.ai.features = { ...next.ai.features, ...patch.ai.features };
  }
  return next;
}
