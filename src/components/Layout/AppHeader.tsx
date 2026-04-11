'use client';

/**
 * Top-of-window application header. Shows the app identity on the
 * left and a cluster of global actions on the right:
 *
 * - "Save" — saves the active file only (Cmd/Ctrl+S from inside the
 *   editor does the same thing). Disabled when the active file is
 *   clean, absent, or already saving.
 * - "Save all" — saves every dirty tab in one go (Cmd/Ctrl+Shift+S).
 *   The button surfaces the dirty count so the user knows exactly how
 *   many files are about to be written.
 *
 * Both buttons read their in-flight state from `WorkbenchContext`'s
 * `savingPaths` set so a save triggered by a keybind is reflected in
 * the header immediately (and can't be double-triggered by clicking).
 *
 * The header is intentionally thin — it only holds workspace-level
 * actions, never per-file state — so the main editing surface below
 * stays as large as possible.
 */

import { useCallback } from 'react';
import { Loader2, Save, Workflow } from 'lucide-react';

import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  isDirty,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';

export function AppHeader() {
  const { openFiles, activePath, savingPaths, savePath, saveAll } =
    useWorkbench();
  const { toast } = useToast();

  const dirtyCount = openFiles.filter(isDirty).length;
  const activeFile =
    activePath == null
      ? null
      : (openFiles.find((f) => f.path === activePath) ?? null);
  const activeDirty = activeFile != null && isDirty(activeFile);
  const activeSaving =
    activePath != null && savingPaths.has(activePath);

  // "Save all" is busy if any file is saving — `saveAll` itself no-ops
  // on files already in flight, but disabling the button avoids a
  // confusing click-with-nothing-happens.
  const anySaving = savingPaths.size > 0;

  const canSaveActive = activeDirty && !activeSaving;
  const canSaveAll = dirtyCount > 0 && !anySaving;

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

  const handleSaveAll = useCallback(async () => {
    const { saved, failed } = await saveAll();
    if (failed > 0) {
      toast({
        kind: 'error',
        title: 'Save all: some files failed',
        message: `${saved} saved, ${failed} failed`,
      });
    } else if (saved > 0) {
      toast({
        kind: 'success',
        message: `Saved ${saved} file${saved === 1 ? '' : 's'}`,
      });
    }
  }, [saveAll, toast]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-900/60 bg-sky-500/10 text-sky-300">
          <Workflow className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-neutral-100">
            Traefik Workbench
          </span>
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">
            YAML configuration editor
          </span>
        </div>
      </div>

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
            anySaving
              ? 'Saving…'
              : canSaveAll
                ? `Save all unsaved files (${dirtyCount})`
                : 'No unsaved changes'
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={!canSaveAll}
            aria-label="Save all files"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-xs font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-950 disabled:hover:text-neutral-600"
          >
            {anySaving ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {anySaving ? 'Saving…' : 'Save all'}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
