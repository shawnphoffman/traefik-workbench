/**
 * Shared settings types. Safe to import from server or client; the client
 * only ever sees the masked variant returned by `/api/settings`.
 */

/** Curated list of models the user can pick from in the Settings UI. */
export const AI_MODEL_CHOICES = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
] as const;

export type AiModel = (typeof AI_MODEL_CHOICES)[number];

export const DEFAULT_AI_MODEL: AiModel = 'claude-haiku-4-5-20251001';

export interface AiFeatureFlags {
  completion: boolean;
  validation: boolean;
  format: boolean;
}

export interface AiSettings {
  enabled: boolean;
  /**
   * Plaintext API key, persisted to disk under CONFIG_DIR with mode 0600.
   * Never returned from `/api/settings` — see `MaskedAiSettings`.
   * `null` means no key is stored on disk (env var may still provide one).
   */
  apiKey: string | null;
  model: AiModel;
  features: AiFeatureFlags;
}

export interface Settings {
  schemaVersion: 1;
  ai: AiSettings;
}

/** What `/api/settings` returns to the client — never includes the raw key. */
export interface MaskedSettings {
  schemaVersion: 1;
  ai: {
    enabled: boolean;
    /** Masked key (e.g. `sk-ant-•••••XXXX`) or `null` if not set. */
    apiKeyMasked: string | null;
    /** Where the resolved key is coming from. */
    apiKeySource: 'file' | 'env' | 'none';
    model: AiModel;
    features: AiFeatureFlags;
  };
}

/** Patch shape accepted by `PUT /api/settings`. */
export interface SettingsPatch {
  ai?: {
    enabled?: boolean;
    /**
     * - `string` → set the key to this value
     * - `null` → clear the on-disk key
     * - omitted → leave existing key unchanged
     */
    apiKey?: string | null;
    model?: AiModel;
    features?: Partial<AiFeatureFlags>;
  };
}
