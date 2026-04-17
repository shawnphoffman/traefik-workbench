'use client';

/**
 * Top-of-window application header. Shows the app identity on the
 * left and a cluster of global actions on the right:
 *
 * - "Save" — saves the active file only (Cmd/Ctrl+S from inside the
 *   editor does the same thing). Disabled when the active file is
 *   clean, absent, or already saving.
 *
 * There is intentionally no "Save all" affordance: saving every open
 * buffer at once hides per-file failures, invites partial-write
 * surprises, and encourages treating unrelated edits as one atomic
 * change when they aren't. Users save what they're looking at.
 *
 * Save state is read from `WorkbenchContext`'s `savingPaths` set so a
 * save triggered by a keybind is reflected in the header immediately
 * (and can't be double-triggered by clicking).
 *
 * The header is intentionally thin — it only holds workspace-level
 * actions, never per-file state — so the main editing surface below
 * stays as large as possible.
 */

import { useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Save, Settings as SettingsIcon, XSquare } from 'lucide-react';

import { TraefikIcon } from '@/components/icons/TraefikIcon';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  isDirty,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import { useTraefikStatus } from '@/hooks/useTraefikStatus';

// Baked in at build time via next.config.ts. Empty string when unset
// (e.g. a bespoke build that didn't go through our config) so the
// header silently omits the badge rather than showing "v".
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

export function AppHeader() {
  const {
    openFiles,
    activePath,
    savingPaths,
    savePath,
    closeAllClean,
  } = useWorkbench();
  const { toast } = useToast();
  const { configured: traefikConfigured } = useTraefikStatus();

  const dirtyCount = openFiles.filter(isDirty).length;
  const activeFile =
    activePath == null
      ? null
      : (openFiles.find((f) => f.path === activePath) ?? null);
  const activeDirty = activeFile != null && isDirty(activeFile);
  const activeSaving =
    activePath != null && savingPaths.has(activePath);

  const canSaveActive = activeDirty && !activeSaving;

  // "Close all" sweeps every clean, unpinned tab. The button is disabled
  // when nothing is open at all (per spec). When everything open is
  // either dirty or pinned the click is a harmless no-op — we still
  // leave the button enabled so the user can see at a glance that
  // there's no clean tab to close (matches the dirty-count badge).
  const anyOpen = openFiles.length > 0;
  const closeableCount = openFiles.filter(
    (f) => !f.pinned && !isDirty(f) && !savingPaths.has(f.path),
  ).length;

  const handleSaveActive = useCallback(async () => {
    if (activePath == null) return;
    try {
      await savePath(activePath);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activePath, savePath, toast]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4">
      <Link
        href="/"
        aria-label="Traefik Workbench home"
        className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
      >
        <Image
          src="/logo.svg"
          alt=""
          width={32}
          height={32}
          priority
          className="h-7 w-7"
        />
        <div className="flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-neutral-100">
            Tr&aelig;fik Workbench
            {APP_VERSION && (
              <span
                className="rounded-full border border-neutral-800 bg-neutral-900 px-1.5 py-px text-[10px] font-medium tracking-normal text-neutral-400"
                aria-label={`Version ${APP_VERSION}`}
              >
                v{APP_VERSION}
              </span>
            )}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">
            YAML configuration editor
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-2">
        {dirtyCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-800/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
            aria-label={`${dirtyCount} unsaved file${dirtyCount === 1 ? '' : 's'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {dirtyCount} unsaved
          </span>
        )}
        <Tooltip
          content={
            activeFile == null
              ? 'No file open'
              : activeSaving
                ? 'Saving…'
                : activeDirty
                  ? `Save ${basename(activeFile.path)} (⌘/Ctrl+S)`
                  : 'No unsaved changes in active file'
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => void handleSaveActive()}
            disabled={!canSaveActive}
            aria-label="Save active file"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-xs font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-950 disabled:hover:text-neutral-600"
          >
            {activeSaving ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {activeSaving ? 'Saving…' : 'Save'}
          </button>
        </Tooltip>
        <Tooltip
          content={
            !anyOpen
              ? 'No files open'
              : closeableCount === 0
                ? 'Nothing to close (every open tab is pinned or has unsaved changes)'
                : `Close ${closeableCount} clean tab${closeableCount === 1 ? '' : 's'}`
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => closeAllClean()}
            disabled={closeableCount === 0}
            aria-label="Close all clean files"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-xs font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-950 disabled:hover:text-neutral-600"
          >
            <XSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Close all
          </button>
        </Tooltip>
        {traefikConfigured && (
          <Tooltip content="Traefik status" placement="bottom">
            <Link
              href="/traefik"
              aria-label="Open Traefik status"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
            >
              <TraefikIcon className="h-4 w-4" />
            </Link>
          </Tooltip>
        )}
        <Tooltip content="Settings" placement="bottom">
          <Link
            href="/settings"
            aria-label="Open settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
          >
            <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
