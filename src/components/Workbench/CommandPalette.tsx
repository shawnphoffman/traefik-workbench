'use client';

/**
 * Command palette (cmd+k / cmd+shift+p / cmd+p).
 *
 * Two modes:
 * - `actions`: list of named workbench commands. Selecting "Open
 *   file..." flips the palette into `files` mode without closing.
 * - `files`: typeahead over every YAML path in the workspace tree.
 *   Selecting an entry calls `openFile()` and closes.
 *
 * Built on cmdk's headless primitives (Command, Command.Input, etc.)
 * inside our existing native-<dialog> shell so the modal/escape/
 * backdrop behavior matches the rest of the app's dialogs. cmdk owns
 * arrow-key navigation and fuzzy filtering; we own only the action
 * list, the file list, and dispatch.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import {
  ChevronRight,
  File as FileIcon,
  FolderOpen,
  PanelLeft,
  PanelRight,
  Save,
  Search,
  X,
  XCircle,
} from 'lucide-react';

import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import {
  isDirty,
  isTemplatePath,
  stripTemplatePrefix,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import type { TreeEntry } from '@/types';

export type PaletteMode = 'actions' | 'files';

export interface CommandPaletteProps {
  open: boolean;
  mode: PaletteMode;
  onClose: () => void;
  onModeChange: (mode: PaletteMode) => void;
}

export function CommandPalette({
  open,
  mode,
  onClose,
  onModeChange,
}: CommandPaletteProps) {
  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-2xl">
      {/*
        Re-key on open + mode so the inner palette remounts whenever
        either changes. That resets `search` (via its useState
        initializer) and cmdk's selection without needing an effect to
        push state.
      */}
      <PaletteContent
        key={`${open ? 'open' : 'closed'}:${mode}`}
        mode={mode}
        onClose={onClose}
        onModeChange={onModeChange}
      />
    </Dialog>
  );
}

interface PaletteContentProps {
  mode: PaletteMode;
  onClose: () => void;
  onModeChange: (mode: PaletteMode) => void;
}

function PaletteContent({ mode, onClose, onModeChange }: PaletteContentProps) {
  const wb = useWorkbench();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const yamlFiles = useMemo(
    () => flattenYamlPaths(wb.treeEntries),
    [wb.treeEntries],
  );

  const dirtyCount = useMemo(
    () => wb.openFiles.filter(isDirty).length,
    [wb.openFiles],
  );
  const closeableCount = useMemo(
    () =>
      wb.openFiles.filter(
        (f) => !f.pinned && !isDirty(f) && !wb.savingPaths.has(f.path),
      ).length,
    [wb.openFiles, wb.savingPaths],
  );

  const dispatch = useCallback(
    (label: string, fn: () => void | Promise<void>) => {
      onClose();
      void Promise.resolve()
        .then(fn)
        .catch((err: unknown) => {
          toast({
            kind: 'error',
            title: `${label} failed`,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [onClose, toast],
  );

  // Backspace on an empty search in `files` mode pops back to `actions`
  // so users can recover the command list without closing.
  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        mode === 'files' &&
        event.key === 'Backspace' &&
        search.length === 0
      ) {
        event.preventDefault();
        onModeChange('actions');
      }
    },
    [mode, search, onModeChange],
  );

  return (
    <>
      <Command
        label={
          mode === 'files' ? 'Open file by name' : 'Workbench command palette'
        }
        loop
        className="flex max-h-[60vh] flex-col"
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          {mode === 'files' ? (
            <FolderOpen
              className="h-4 w-4 shrink-0 text-neutral-400"
              aria-hidden="true"
            />
          ) : (
            <Search
              className="h-4 w-4 shrink-0 text-neutral-400"
              aria-hidden="true"
            />
          )}
          {mode === 'files' && (
            <span className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300">
              Open file
            </span>
          )}
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleInputKeyDown}
            placeholder={
              mode === 'files'
                ? 'Type a file name…'
                : 'Type a command or search…'
            }
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 sm:inline">
            Esc
          </kbd>
        </div>

        <Command.List className="flex-1 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-neutral-500">
            {mode === 'files'
              ? 'No files match.'
              : 'No matching commands.'}
          </Command.Empty>

          {mode === 'actions' && (
            <>
              <Command.Group
                heading="File"
                className="px-2 pt-2 text-neutral-200 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-500"
              >
                <PaletteItem
                  icon={Save}
                  label="Save"
                  shortcut="⌘S"
                  disabled={
                    !wb.activePath ||
                    !wb.openFiles.find(
                      (f) => f.path === wb.activePath && isDirty(f),
                    )
                  }
                  onSelect={() => dispatch('Save', () => wb.saveActive())}
                />
                <PaletteItem
                  icon={Save}
                  label={`Save all dirty${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
                  shortcut="⌘⇧S"
                  disabled={dirtyCount === 0}
                  onSelect={() =>
                    dispatch('Save all', async () => {
                      const dirty = wb.openFiles.filter(isDirty);
                      const results = await Promise.allSettled(
                        dirty.map((f) => wb.savePath(f.path)),
                      );
                      const failed = results.filter(
                        (r) => r.status === 'rejected',
                      ).length;
                      if (failed > 0) {
                        throw new Error(
                          `${failed} of ${dirty.length} ${dirty.length === 1 ? 'file' : 'files'} failed to save.`,
                        );
                      }
                      toast({
                        kind: 'success',
                        message: `Saved ${dirty.length} ${dirty.length === 1 ? 'file' : 'files'}.`,
                      });
                    })
                  }
                />
                <PaletteItem
                  icon={FolderOpen}
                  label="Open file…"
                  shortcut="⌘P"
                  onSelect={() => onModeChange('files')}
                />
              </Command.Group>

              <Command.Group
                heading="Tabs"
                className="px-2 pt-2 text-neutral-200 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-500"
              >
                <PaletteItem
                  icon={X}
                  label="Close active tab"
                  shortcut="⌘⇧W"
                  disabled={!wb.activePath}
                  onSelect={() => dispatch('Close tab', () => wb.closeActive())}
                />
                <PaletteItem
                  icon={XCircle}
                  label={`Close all unmodified${closeableCount > 0 ? ` (${closeableCount})` : ''}`}
                  shortcut="⌘⇧K"
                  disabled={closeableCount === 0}
                  onSelect={() =>
                    dispatch('Close unmodified', () => wb.closeAllClean())
                  }
                />
              </Command.Group>

              <Command.Group
                heading="View"
                className="px-2 pt-2 text-neutral-200 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-500"
              >
                <PaletteItem
                  icon={PanelLeft}
                  label={
                    wb.leftCollapsed
                      ? 'Show file tree'
                      : 'Hide file tree'
                  }
                  shortcut="⌘B"
                  onSelect={() =>
                    dispatch('Toggle file tree', () => wb.toggleLeft())
                  }
                />
                <PaletteItem
                  icon={PanelRight}
                  label={
                    wb.rightCollapsed
                      ? 'Show structure pane'
                      : 'Hide structure pane'
                  }
                  shortcut="⌘⌥B"
                  onSelect={() =>
                    dispatch('Toggle structure pane', () => wb.toggleRight())
                  }
                />
              </Command.Group>

              {wb.openFiles.length > 0 && (
                <Command.Group
                  heading="Switch to open tab"
                  className="px-2 pt-2 text-neutral-200 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-500"
                >
                  {wb.openFiles.map((file) => {
                    const display = isTemplatePath(file.path)
                      ? stripTemplatePrefix(file.path)
                      : file.path;
                    return (
                      <PaletteItem
                        key={`tab:${file.path}`}
                        icon={FileIcon}
                        label={display}
                        suffix={isDirty(file) ? '●' : undefined}
                        // Include the path in `value` so cmdk's filter
                        // matches both basename and full path.
                        value={`switch ${display}`}
                        onSelect={() =>
                          dispatch('Switch tab', () => wb.setActive(file.path))
                        }
                      />
                    );
                  })}
                </Command.Group>
              )}
            </>
          )}

          {mode === 'files' && (
            <Command.Group
              heading="Workspace files"
              className="px-2 pt-2 text-neutral-200 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-500"
            >
              {yamlFiles.map((path) => (
                <PaletteItem
                  key={`file:${path}`}
                  icon={FileIcon}
                  label={basename(path)}
                  hint={dirname(path)}
                  // Match against full path so directory typeahead works.
                  value={path}
                  onSelect={() =>
                    dispatch('Open file', () => wb.openFile(path))
                  }
                />
              ))}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            {mode === 'files'
              ? 'Backspace to return to commands'
              : 'Type to filter, Enter to run'}
          </span>
          <span className="hidden gap-2 sm:flex">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </span>
        </div>
      </Command>
    </>
  );
}

interface PaletteItemProps {
  icon: typeof FileIcon;
  label: string;
  hint?: string;
  suffix?: string;
  shortcut?: string;
  value?: string;
  disabled?: boolean;
  onSelect: () => void;
}

function PaletteItem({
  icon: Icon,
  label,
  hint,
  suffix,
  shortcut,
  value,
  disabled,
  onSelect,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={value ?? label}
      onSelect={onSelect}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-200 aria-selected:bg-sky-500/15 aria-selected:text-sky-100 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40"
    >
      <Icon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 truncate text-[11px] text-neutral-500">
          {hint}
        </span>
      )}
      {suffix && (
        <span
          className="shrink-0 text-amber-300"
          aria-label="unsaved changes"
        >
          {suffix}
        </span>
      )}
      {shortcut && (
        <kbd className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

function flattenYamlPaths(entries: TreeEntry[]): string[] {
  const out: string[] = [];
  const walk = (es: TreeEntry[]) => {
    for (const entry of es) {
      if (entry.kind === 'file' && /\.ya?ml$/i.test(entry.path)) {
        out.push(entry.path);
      }
      if (entry.children) walk(entry.children);
    }
  };
  walk(entries);
  out.sort();
  return out;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}
