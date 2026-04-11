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

/**
 * File-tree settings. Currently just a list of glob-ish ignore patterns
 * applied server-side in `/api/tree` so users can hide noise like
 * `.git/`, `node_modules/`, etc.
 */
export interface TreeSettings {
  ignorePatterns: string[];
}

/**
 * How the workbench authenticates to the Traefik REST API. Traefik
 * itself has no built-in auth on `/api`; in real deployments the
 * dashboard router is wrapped in a middleware. We support the two
 * realistic shapes:
 *   - `none`: dashboard is exposed unauthenticated (internal network or
 *     `api.insecure=true` on a private entrypoint).
 *   - `basic`: dashboard is wrapped in a `BasicAuth` middleware.
 *
 * Bearer / forward-auth setups are uncommon enough to skip in v1.
 */
export type TraefikAuth =
  | { kind: 'none' }
  | {
      kind: 'basic';
      username: string;
      /**
       * Plaintext password, persisted to disk under CONFIG_DIR with
       * mode 0600 alongside the Anthropic key. Never returned from
       * `/api/settings` — see `MaskedTraefikSettings`.
       */
      password: string | null;
    };

/**
 * Connection details for the user's running Traefik instance. The
 * workbench only ever *reads* from this URL — it never writes back
 * (Traefik's REST API is read-only by design).
 */
export interface TraefikSettings {
  /** Base URL of the Traefik API, e.g. `http://traefik:8080`. `null` = not configured. */
  baseUrl: string | null;
  auth: TraefikAuth;
  /** Skip TLS certificate verification (server-side fetch only). */
  insecureTls: boolean;
  /**
   * Path to ping for the liveness check. Default `/ping`. `null` skips
   * the ping and falls back to `/api/version` for liveness.
   */
  pingPath: string | null;
  /** Per-request timeout in milliseconds. Default 5000. */
  timeoutMs: number;
}

export interface Settings {
  schemaVersion: 1;
  ai: AiSettings;
  tree: TreeSettings;
  traefik: TraefikSettings;
}

/** Where a resolved value came from when env vars can override file values. */
export type SettingSource = 'file' | 'env' | 'none';

/**
 * Masked Traefik settings as returned by `/api/settings`. Mirrors
 * `TraefikSettings` but never includes the raw password — only a
 * boolean and the source it would resolve from.
 */
export interface MaskedTraefikSettings {
  baseUrl: string | null;
  baseUrlSource: SettingSource;
  auth:
    | { kind: 'none' }
    | {
        kind: 'basic';
        username: string;
        passwordSet: boolean;
        passwordSource: SettingSource;
      };
  insecureTls: boolean;
  pingPath: string | null;
  timeoutMs: number;
  /** True when `baseUrl` resolves (file or env). The nav icon and `/traefik` page gate on this. */
  configured: boolean;
}

/** What `/api/settings` returns to the client — never includes the raw key. */
export interface MaskedSettings {
  schemaVersion: 1;
  ai: {
    enabled: boolean;
    /** Masked key (e.g. `sk-ant-•••••XXXX`) or `null` if not set. */
    apiKeyMasked: string | null;
    /** Where the resolved key is coming from. */
    apiKeySource: SettingSource;
    model: AiModel;
    features: AiFeatureFlags;
  };
  tree: TreeSettings;
  traefik: MaskedTraefikSettings;
}

/**
 * Patch shape for the Traefik auth field. Switching kinds requires the
 * full new object; updating an existing basic auth can omit fields it
 * doesn't want to change. `password: null` clears the on-disk password,
 * matching the `apiKey` semantics.
 */
export type TraefikAuthPatch =
  | { kind: 'none' }
  | {
      kind: 'basic';
      username?: string;
      password?: string | null;
    };

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
  tree?: {
    ignorePatterns?: string[];
  };
  traefik?: {
    /** `null` clears the configured URL entirely; omitted = unchanged. */
    baseUrl?: string | null;
    auth?: TraefikAuthPatch;
    insecureTls?: boolean;
    pingPath?: string | null;
    timeoutMs?: number;
  };
}
