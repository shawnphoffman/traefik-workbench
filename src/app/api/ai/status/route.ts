/**
 * GET /api/ai/status — public, never returns the API key.
 *
 * The client calls this once on mount (and again after every Settings
 * page save) to decide whether to render the AI UI and which features
 * to enable. Faliure modes are conservative: if reading settings throws,
 * the response is `{ enabled: false }` so the editor stays usable.
 */

import { loadSettings, resolveApiKey } from '@/lib/settings/store';
import type { AiStatusResponse } from '@/lib/ai/types';

export async function GET(): Promise<Response> {
  try {
    const settings = await loadSettings();
    const { source } = resolveApiKey(settings);
    const enabled = settings.ai.enabled && source !== 'none';
    const body: AiStatusResponse = {
      enabled,
      model: settings.ai.model,
      features: settings.ai.features,
      apiKeySource: source,
    };
    return Response.json(body);
  } catch (err) {
    console.error('[ai/status] failed', err);
    const body: AiStatusResponse = {
      enabled: false,
      model: 'claude-haiku-4-5-20251001',
      features: { completion: false, validation: false, format: false },
      apiKeySource: 'none',
    };
    return Response.json(body);
  }
}
