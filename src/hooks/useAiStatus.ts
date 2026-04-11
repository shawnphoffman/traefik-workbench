'use client';

/**
 * Fetches and exposes the AI status (`/api/ai/status`). The status
 * tells us whether AI is enabled, which model is selected, and which
 * features are turned on. The editor uses this to gate provider
 * registration; the status pill uses it to render the right shape.
 *
 * Status changes (e.g. the user toggling AI in the Settings page) are
 * propagated through a window event — `traefik-workbench:ai-status-
 * changed` — that the Settings page dispatches after a successful
 * settings PATCH. This avoids polling and keeps the editor in sync
 * across tabs in the same window.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchAiStatus } from '@/lib/api-client';
import type { AiStatusResponse } from '@/lib/ai/types';

export const AI_STATUS_CHANGED_EVENT = 'traefik-workbench:ai-status-changed';

const DEFAULT_STATUS: AiStatusResponse = {
  enabled: false,
  model: '',
  features: { completion: false, validation: false, format: false },
  apiKeySource: 'none',
};

export interface UseAiStatusResult {
  status: AiStatusResponse;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAiStatus(): UseAiStatusResult {
  const [status, setStatus] = useState<AiStatusResponse>(DEFAULT_STATUS);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAiStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener(AI_STATUS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AI_STATUS_CHANGED_EVENT, handler);
  }, [refresh]);

  return { status, loading, error, refresh };
}

/**
 * Fire from anywhere on the client to nudge mounted `useAiStatus`
 * consumers to re-fetch. The Settings page calls this after a
 * successful settings save so the editor's pill / providers refresh
 * without a page reload.
 */
export function notifyAiStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_STATUS_CHANGED_EVENT));
}
