'use client';

/**
 * Tree section of the Settings page. Lets the user manage the file
 * tree's ignore-pattern list — applied server-side in `/api/tree` so
 * the workbench doesn't even ship the filtered entries to the client.
 *
 * UX:
 *  - One pattern per line in a textarea (matches the mental model
 *    most editors / .gitignore users already have).
 *  - Local draft state so typing doesn't fire a PATCH on every
 *    keystroke; the user explicitly clicks Save when they're happy.
 *  - "Reset" reverts the draft to whatever's currently on disk.
 *  - The current saved list is shown above the textarea as a quick
 *    reference (and as confirmation after a save).
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderTree } from 'lucide-react';

import type { MaskedSettings, SettingsPatch } from '@/lib/settings/types';

export interface TreeSettingsSectionProps {
  settings: MaskedSettings;
  onPatch: (patch: SettingsPatch) => Promise<void>;
}

export function TreeSettingsSection({
  settings,
  onPatch,
}: TreeSettingsSectionProps) {
  const saved = settings.tree.ignorePatterns;
  const [draft, setDraft] = useState<string>(() => saved.join('\n'));
  const [saving, setSaving] = useState<boolean>(false);

  // Re-sync the draft whenever the saved list changes from outside
  // (e.g. another patch elsewhere on the page). We only do this when
  // the draft actually matches the previous saved value — otherwise
  // we'd nuke unsaved typing on every render.
  useEffect(() => {
    setDraft((current) => {
      const currentLines = parsePatterns(current);
      const isUnedited =
        currentLines.length === saved.length &&
        currentLines.every((p, i) => p === saved[i]);
      return isUnedited ? saved.join('\n') : current;
    });
  }, [saved]);

  const draftPatterns = parsePatterns(draft);
  const dirty =
    draftPatterns.length !== saved.length ||
    draftPatterns.some((p, i) => p !== saved[i]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onPatch({ tree: { ignorePatterns: draftPatterns } });
    } finally {
      setSaving(false);
    }
  }, [draftPatterns, onPatch]);

  const handleReset = useCallback(() => {
    setDraft(saved.join('\n'));
  }, [saved]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <FolderTree className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">
          File tree
        </h2>
      </header>

      <div className="flex flex-col gap-5 p-4">
        <Field
          label="Ignore patterns"
          description={
            <>
              One pattern per line. Hides matching files and directories
              from the left-pane file tree. Trailing <code className="rounded bg-neutral-800 px-1 font-mono text-xs">/</code>{' '}
              means &ldquo;directories only&rdquo;. Patterns containing{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">/</code>{' '}
              match against the full relative path; otherwise they match
              the basename anywhere in the tree.{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">*</code>{' '}
              and{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">?</code>{' '}
              wildcards are supported.
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder=".git/&#10;node_modules/&#10;*.log"
              className="min-h-[7.5rem] w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-sky-700 bg-sky-950 px-3 text-base font-medium text-sky-100 transition-colors hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
              >
                {saving ? 'Saving…' : 'Save patterns'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={!dirty || saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
              <span className="text-sm text-neutral-500">
                {draftPatterns.length} pattern
                {draftPatterns.length === 1 ? '' : 's'}
                {dirty && ' · unsaved'}
              </span>
            </div>
          </div>
        </Field>
      </div>
    </section>
  );
}

function parsePatterns(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
      <div>
        <div className="text-base font-semibold text-neutral-200">{label}</div>
        {description && (
          <div className="mt-1 text-sm text-neutral-500">{description}</div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
