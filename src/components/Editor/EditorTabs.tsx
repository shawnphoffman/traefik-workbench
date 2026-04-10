'use client';

/**
 * Tab bar for the center pane. Shows one tab per open file with a
 * dirty indicator and close button. Clicking a tab activates it.
 *
 * Phase 3 intentionally omits the "+ New ▾" dropdown — that arrives
 * with the new-file dialog and template selector in Phase 4.
 */

import {
  isDirty,
  useWorkbench,
  type OpenFile,
} from '@/components/Workbench/WorkbenchContext';

export function EditorTabs() {
  const { openFiles, activePath, setActive, closeFile } = useWorkbench();

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
      {openFiles.map((file) => (
        <Tab
          key={file.path}
          file={file}
          active={file.path === activePath}
          onSelect={() => setActive(file.path)}
          onClose={() => closeFile(file.path)}
        />
      ))}
    </div>
  );
}

function Tab({
  file,
  active,
  onSelect,
  onClose,
}: {
  file: OpenFile;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const dirty = isDirty(file);
  const name = basename(file.path);

  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-sm ${
        active
          ? 'bg-neutral-900 text-neutral-50'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
      title={file.path}
    >
      <span className="max-w-[16rem] truncate">{name}</span>
      <span className="flex w-4 items-center justify-center text-xs">
        {dirty ? (
          <span aria-label="unsaved changes" title="Unsaved changes">
            ●
          </span>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded text-neutral-500 opacity-0 hover:bg-neutral-800 hover:text-neutral-100 group-hover:opacity-100"
            aria-label={`Close ${name}`}
          >
            ×
          </button>
        )}
      </span>
      {dirty && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label={`Close ${name} (has unsaved changes)`}
          title="Close (unsaved changes will be lost)"
        >
          ×
        </button>
      )}
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
