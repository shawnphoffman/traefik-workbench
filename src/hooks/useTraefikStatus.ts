'use client';

/**
 * Lightweight hook that exposes whether the workbench has a Traefik
 * connection configured. The `AppHeader` uses this to gate the
 * `/traefik` nav icon — no point showing a link to a page that will
 * just bounce to an empty state.
 *
 * Implementation: hits `/api/settings` once on mount, then re-fetches
 * whenever `notifySettingsChanged` fires (the same broadcast that
 * drives `useAiStatus`). Failure modes are conservative: any error
 * collapses to `configured: false` so the icon stays hidden rather
 * than dangling.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchSettings } from '@/lib/api-client';
import { SETTINGS_CHANGED_EVENT } from './useAiStatus';

export interface UseTraefikStatusResult {
  configured: boolean;
  loading: boolean;
}

export function useTraefikStatus(): UseTraefikStatusResult {
  const [configured, setConfigured] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchSettings();
      setConfigured(next.traefik.configured);
    } catch {
      setConfigured(false);
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
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
  }, [refresh]);

  return { configured, loading };
}
