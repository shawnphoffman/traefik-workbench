'use client';

/**
 * Top-of-window application header. Shows the app identity on the
 * left and a cluster of global actions on the right:
 *
 * - "Save all" — saves every dirty tab in one go (Cmd/Ctrl+Shift+S).
 *   The button surfaces the dirty count so the user knows exactly how
 *   many files are about to be written.
 *
 * The header is intentionally thin — it only holds workspace-level
 * actions, never per-file state — so the main editing surface below
 * stays as large as possible.
 */

import { useCallback, useState } from 'react';
import { Save, Workflow } from 'lucide-react';

import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  isDirty,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';

export function AppHeader() {
  const { openFiles, saveAll } = useWorkbench();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const dirtyCount = openFiles.filter(isDirty).length;
  const canSave = dirtyCount > 0 && !saving;

  const handleSaveAll = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  }, [saveAll, saving, toast]);

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
            canSave
              ? `Save all unsaved files (${dirtyCount})`
              : 'No unsaved changes'
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={!canSave}
            aria-label="Save all files"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-xs font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-950 disabled:hover:text-neutral-600"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save all'}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
