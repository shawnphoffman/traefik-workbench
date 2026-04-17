'use client';

/**
 * Tab bar for the center pane. Shows one tab per open file with a
 * dirty indicator and close button. Clicking a tab activates it.
 *
 * Tab ordering: pinned tabs render first (in insertion order), then
 * unpinned tabs (in insertion order). Pinning is an explicit user
 * action — see `togglePin` on `WorkbenchContext`.
 *
 * The "preview" tab — a file the user opened but hasn't edited — is
 * rendered with an italic name to match VS Code's convention. It gets
 * silently replaced when the user opens another file from the tree;
 * editing the buffer makes it sticky.
 */

import { useMemo, type ReactNode } from 'react';
import { Loader2, Pin, PinOff, X } from 'lucide-react';

import {
  isDirty,
  isTemplatePath,
  stripTemplatePrefix,
  useWorkbench,
  type OpenFile,
} from '@/components/Workbench/WorkbenchContext';
import { Tooltip } from '@/components/ui/Tooltip';

export function EditorTabs() {
  const {
    openFiles,
    activePath,
    previewPath,
    savingPaths,
    setActive,
    requestCloseFile,
    togglePin,
  } = useWorkbench();

  // Stable sort: pinned tabs first, otherwise preserve insertion order.
  const orderedFiles = useMemo(() => {
    if (openFiles.every((f) => !f.pinned) || openFiles.every((f) => f.pinned)) {
      return openFiles;
    }
    const pinned = openFiles.filter((f) => f.pinned);
    const rest = openFiles.filter((f) => !f.pinned);
    return [...pinned, ...rest];
  }, [openFiles]);

  if (openFiles.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-500">
        No files open
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 items-stretch overflow-x-auto border-b border-neutral-800 bg-neutral-950"
    >
      {orderedFiles.map((file) => (
        <Tab
          key={file.path}
          file={file}
          active={file.path === activePath}
          saving={savingPaths.has(file.path)}
          isPreview={file.path === previewPath}
          onSelect={() => setActive(file.path)}
          onClose={() => requestCloseFile(file.path)}
          onTogglePin={() => togglePin(file.path)}
        />
      ))}
    </div>
  );
}

function Tab({
  file,
  active,
  saving,
  isPreview,
  onSelect,
  onClose,
  onTogglePin,
}: {
  file: OpenFile;
  active: boolean;
  saving: boolean;
  isPreview: boolean;
  onSelect: () => void;
  onClose: () => void;
  onTogglePin: () => void;
}) {
  const dirty = isDirty(file);
  const isTemplate = isTemplatePath(file.path);
  const displayPath = isTemplate ? stripTemplatePrefix(file.path) : file.path;
  const name = basename(displayPath);
  const tooltipPath = isTemplate ? `template: ${displayPath}` : displayPath;

  // Indicator precedence: saving (spinner) > dirty (amber dot) > close.
  // We always render the close affordance for dirty tabs next to the
  // indicator so the user can still bail out of a file that's being
  // saved — `requestCloseFile` will pop a confirm if the buffer is
  // still dirty after the save lands.
  let indicator: ReactNode;
  if (saving) {
    indicator = (
      <Tooltip content="Saving…">
        <Loader2
          aria-label="saving"
          className="h-3 w-3 animate-spin text-sky-300"
        />
      </Tooltip>
    );
  } else if (dirty) {
    indicator = (
      <Tooltip content="Unsaved changes">
        <span
          aria-label="unsaved changes"
          className="block h-1.5 w-1.5 rounded-full bg-amber-400"
        />
      </Tooltip>
    );
  } else {
    indicator = (
      <Tooltip content="Close tab">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 opacity-0 hover:bg-neutral-800 hover:text-neutral-100 group-hover:opacity-100"
          aria-label={`Close ${name}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }

  // Pin affordance:
  // - Pinned tabs always show a filled pin icon (clicking unpins).
  // - Unpinned tabs reveal an outline pin on hover.
  // The pin button sits to the left of the indicator/close so the
  // close button stays anchored to the right edge of every tab.
  const pinButton = file.pinned ? (
    <Tooltip content="Unpin tab">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin();
        }}
        className="flex h-4 w-4 items-center justify-center rounded text-sky-300 hover:bg-neutral-800 hover:text-sky-100"
        aria-label={`Unpin ${name}`}
        aria-pressed="true"
      >
        <Pin className="h-3 w-3 fill-current" aria-hidden="true" />
      </button>
    </Tooltip>
  ) : (
    <Tooltip content="Pin tab">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin();
        }}
        className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 opacity-0 hover:bg-neutral-800 hover:text-neutral-100 group-hover:opacity-100"
        aria-label={`Pin ${name}`}
        aria-pressed="false"
      >
        <PinOff className="h-3 w-3" aria-hidden="true" />
      </button>
    </Tooltip>
  );

  return (
    <div
      role="tab"
      aria-selected={active}
      aria-busy={saving || undefined}
      onClick={onSelect}
      onDoubleClick={(event) => {
        // Double-clicking a preview tab promotes it to a sticky (pinned-style)
        // tab without actually pinning — VS Code's convention. We implement it
        // here as a no-op pin toggle when already pinned, otherwise as an
        // explicit pin so users have a way to keep a previewed file from
        // disappearing when they open another file.
        event.stopPropagation();
        if (!file.pinned) onTogglePin();
      }}
      title={tooltipPath}
      className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-sm ${
        active
          ? 'bg-neutral-900 text-neutral-50'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      {isTemplate && (
        <span
          className="rounded border border-sky-800/60 bg-sky-500/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-sky-300"
          aria-label="template"
        >
          tpl
        </span>
      )}
      <span
        className={`max-w-[16rem] truncate ${isPreview ? 'italic' : ''}`}
      >
        {name}
      </span>
      <span className="flex w-4 items-center justify-center">{pinButton}</span>
      <span className="flex w-4 items-center justify-center">{indicator}</span>
      {(dirty || saving) && (
        <Tooltip
          content={
            saving
              ? 'Close (will wait for save to finish)'
              : 'Close (unsaved changes will be lost)'
          }
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label={`Close ${name}${dirty ? ' (has unsaved changes)' : ''}`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
