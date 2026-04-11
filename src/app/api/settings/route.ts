/**
 * Settings API.
 *
 * GET  /api/settings           → masked settings (never returns the raw key)
 * PUT  /api/settings           → patch settings; body: SettingsPatch
 *
 * Test connection lives at /api/settings/test.
 */

import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { loadSettings, resolveApiKey, saveSettings } from '@/lib/settings/store';
import { applyPatch, parsePatch } from '@/lib/settings/schema';
import { maskApiKey } from '@/lib/settings/mask';
import type { MaskedSettings } from '@/lib/settings/types';

function toMasked(settings: Awaited<ReturnType<typeof loadSettings>>): MaskedSettings {
  const { source } = resolveApiKey(settings);
  return {
    schemaVersion: 1,
    ai: {
      enabled: settings.ai.enabled,
      apiKeyMasked: maskApiKey(settings.ai.apiKey),
      apiKeySource: source,
      model: settings.ai.model,
      features: settings.ai.features,
    },
    tree: {
      ignorePatterns: [...settings.tree.ignorePatterns],
    },
  };
}

export async function GET(): Promise<Response> {
  try {
    const settings = await loadSettings();
    return Response.json(toMasked(settings));
  } catch (err) {
    console.error('[settings] load failed', err);
    return jsonError(500, 'Failed to load settings');
  }
}

export async function PUT(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = parsePatch(body);
  if (!parsed.ok) {
    return jsonError(400, parsed.error);
  }

  try {
    const current = await loadSettings();
    const next = applyPatch(current, parsed.value);
    await saveSettings(next);
    return Response.json(toMasked(next));
  } catch (err) {
    console.error('[settings] save failed', err);
    return jsonError(500, 'Failed to save settings');
  }
}
