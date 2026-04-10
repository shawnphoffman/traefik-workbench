'use client';

/**
 * Tab bar for the center pane. Shows one tab per open file with a
 * dirty indicator and close button. Clicking a tab activates it.
 */

import { X } from 'lucide-react';

import {
  isDirty,
  useWorkbench,
  type OpenFile,
} from '@/components/Workbench/WorkbenchContext';
import { Tooltip } from '@/components/ui/Tooltip';

export function EditorTabs() {
  const { openFiles, activePath, setActive, requestCloseFile } = useWorkbench();

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
          onClose={() => requestCloseFile(file.path)}
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
      title={file.path}
      className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-sm ${
        active
          ? 'bg-neutral-900 text-neutral-50'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      <span className="max-w-[16rem] truncate">{name}</span>
      <span className="flex w-4 items-center justify-center">
        {dirty ? (
          <Tooltip content="Unsaved changes">
            <span
              aria-label="unsaved changes"
              className="block h-1.5 w-1.5 rounded-full bg-amber-400"
            />
          </Tooltip>
        ) : (
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
        )}
      </span>
      {dirty && (
        <Tooltip content="Close (unsaved changes will be lost)">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label={`Close ${name} (has unsaved changes)`}
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
