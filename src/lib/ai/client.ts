/**
 * Server-side Anthropic client factory.
 *
 * No module-level singleton: the API key can change at runtime via the
 * Settings page, so we resolve it from `loadSettings()` on every call.
 * The cost is negligible (file read + tiny JSON parse) compared to a
 * Claude round-trip.
 *
 * Routes catch `AiDisabledError` and `AiNoKeyError` and translate them
 * into a 200 `{ enabled: false }` response — that way the client fails
 * closed without surfacing console errors when the user simply hasn't
 * enabled AI yet.
 */

import Anthropic from '@anthropic-ai/sdk';

import { loadSettings, resolveApiKey } from '@/lib/settings/store';
import type { AiFeatureFlags } from '@/lib/settings/types';

export class AiDisabledError extends Error {
  constructor() {
    super('AI is disabled in settings');
    this.name = 'AiDisabledError';
  }
}

export class AiNoKeyError extends Error {
  constructor() {
    super('No Anthropic API key configured');
    this.name = 'AiNoKeyError';
  }
}

export interface AiResolved {
  client: Anthropic;
  model: string;
  features: AiFeatureFlags;
  apiKeySource: 'file' | 'env';
}

/**
 * Resolve everything needed to make a Claude call. Throws
 * `AiDisabledError` / `AiNoKeyError` if the user hasn't opted in.
 */
export async function getAi(): Promise<AiResolved> {
  const settings = await loadSettings();
  if (!settings.ai.enabled) throw new AiDisabledError();
  const { key, source } = resolveApiKey(settings);
  if (!key || source === 'none') throw new AiNoKeyError();
  return {
    client: new Anthropic({ apiKey: key }),
    model: settings.ai.model,
    features: settings.ai.features,
    apiKeySource: source,
  };
}
