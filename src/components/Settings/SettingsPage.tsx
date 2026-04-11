'use client';

/**
 * Settings page shell. Hosts the AI section and the recent-activity
 * panel. Reachable via the gear icon in `AppHeader` or by navigating
 * directly to `/settings`.
 *
 * The page deliberately does not pull in WorkbenchContext — it should
 * be reachable even when the editor isn't mounted (e.g. when the user
 * just wants to set up the API key on first install).
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

import { useToast } from '@/components/ui/Toast';
import { fetchAiActivity, fetchSettings, updateSettings } from '@/lib/api-client';
import type { AiActivityEntry } from '@/lib/ai/activity';
import type { MaskedSettings, SettingsPatch } from '@/lib/settings/types';
import { notifySettingsChanged } from '@/hooks/useAiStatus';

import { AiSettingsSection } from './AiSettingsSection';
import { RecentActivityPanel } from './RecentActivityPanel';
import { TraefikSettingsSection } from './TraefikSettingsSection';
import { TreeSettingsSection } from './TreeSettingsSection';

export function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<MaskedSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activity, setActivity] = useState<AiActivityEntry[]>([]);

  const reloadActivity = useCallback(async () => {
    try {
      const entries = await fetchAiActivity();
      setActivity(entries);
    } catch (err) {
      console.error('[settings] activity fetch failed', err);
    }
  }, []);

  // useState already seeds `loading=true` and `loadError=null` so we
  // don't need to set them again here — only the async results update
  // state from inside the promise chain (not synchronously in the
  // effect body).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSettings(), fetchAiActivity()])
      .then(([s, a]) => {
        if (cancelled) return;
        setSettings(s);
        setActivity(a);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePatch = useCallback(
    async (patch: SettingsPatch) => {
      try {
        const next = await updateSettings(patch);
        setSettings(next);
        notifySettingsChanged();
        toast({ kind: 'success', message: 'Settings saved' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast({ kind: 'error', title: 'Save failed', message });
      }
    },
    [toast],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
            aria-label="Back to editor"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt=""
              width={28}
              height={28}
              priority
              className="h-6 w-6"
            />
            <span className="text-lg font-semibold tracking-tight text-neutral-100">
              Settings
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reloadActivity()}
          aria-label="Refresh activity"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh activity
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading settings…
            </div>
          )}

          {loadError && (
            <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
              <div className="font-medium">Failed to load settings</div>
              <div className="mt-1 text-red-300">{loadError}</div>
            </div>
          )}

          {settings && (
            <>
              <AiSettingsSection
                settings={settings}
                onPatch={handlePatch}
                onAfterTest={() => void reloadActivity()}
              />
              <TraefikSettingsSection
                settings={settings}
                onPatch={handlePatch}
              />
              <TreeSettingsSection
                settings={settings}
                onPatch={handlePatch}
              />
              <RecentActivityPanel entries={activity} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
