'use client';

/**
 * Bottom half of the left pane: a flat list of YAML templates available
 * under TEMPLATES_DIR. Templates are siblings of the data files in the
 * file tree above — they live in their own filesystem root and are
 * edited via /api/templates rather than /api/files.
 *
 * Interaction model mirrors `FileTree`:
 * - Single click on a template: open it in the editor (the tab handle
 *   gets the synthetic `template:` prefix so it doesn't collide with a
 *   data file of the same name).
 * - Hover a row: reveal rename / delete icons.
 * - Header toolbar: new template, reload.
 *
 * Templates use a *flat* list (the underlying API returns a flat
 * recursive listing of YAML files) — there's no folder hierarchy to
 * render and the resource is rarely big enough to warrant nesting.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  FileCode,
  FileOutput,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import {
  templateTabPath,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InputDialog } from '@/components/ui/InputDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { CopyTemplateDialog } from '@/components/Templates/CopyTemplateDialog';
import type { TemplateEntry } from '@/types';

interface RenameState {
  open: boolean;
  entry: TemplateEntry | null;
}

interface DeleteState {
  open: boolean;
  entry: TemplateEntry | null;
}

interface CopyState {
  open: boolean;
  entry: TemplateEntry | null;
}

export function TemplatesTree() {
  const {
    templateEntries,
    templatesLoading,
    templatesError,
    reloadTemplates,
    openFile,
    activePath,
    saveAsTemplate,
    deleteTemplatePath,
    renameTemplatePath,
  } = useWorkbench();

  const { toast } = useToast();

  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState<RenameState>({
    open: false,
    entry: null,
  });
  const [deleteDialog, setDeleteDialog] = useState<DeleteState>({
    open: false,
    entry: null,
  });
  const [copyDialog, setCopyDialog] = useState<CopyState>({
    open: false,
    entry: null,
  });

  const handleOpen = useCallback(
    (entry: TemplateEntry) => {
      void openFile(templateTabPath(entry.path));
    },
    [openFile],
  );

  const handleNewTemplate = useCallback(
    async (templatePath: string) => {
      const trimmed = templatePath.trim().replace(/^\/+/, '');
      try {
        await saveAsTemplate(trimmed, '');
        toast({
          kind: 'success',
          message: `Created template ${trimmed}`,
        });
        setNewTemplateOpen(false);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Could not create template',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [saveAsTemplate, toast],
  );

  const handleRename = useCallback(
    async (newPath: string) => {
      const entry = renameDialog.entry;
      if (!entry) return;
      const trimmed = newPath.trim().replace(/^\/+/, '');
      if (trimmed === entry.path) {
        setRenameDialog({ open: false, entry: null });
        return;
      }
      try {
        await renameTemplatePath(entry.path, trimmed);
        toast({
          kind: 'success',
          message: `Renamed template to ${trimmed}`,
        });
        setRenameDialog({ open: false, entry: null });
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Rename failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [renameDialog.entry, renameTemplatePath, toast],
  );

  const handleDelete = useCallback(async () => {
    const entry = deleteDialog.entry;
    if (!entry) return;
    try {
      await deleteTemplatePath(entry.path);
      toast({ kind: 'success', message: `Deleted template ${entry.path}` });
      setDeleteDialog({ open: false, entry: null });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [deleteDialog.entry, deleteTemplatePath, toast]);

  const templatePathValidator = useCallback((value: string) => {
    return validateTemplatePath(value);
  }, []);

  const sortedEntries = useMemo(
    () => [...templateEntries].sort((a, b) => a.path.localeCompare(b.path)),
    [templateEntries],
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-neutral-200">
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>Templates</span>
        <div className="flex items-center gap-0.5">
          <HeaderButton
            onClick={() => setNewTemplateOpen(true)}
            label="New template"
            tooltip="New template…"
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
          <HeaderButton
            onClick={() => void reloadTemplates()}
            label="Reload templates"
            tooltip="Reload"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto pt-1">
        {templatesLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
        {templatesError && !templatesLoading && (
          <div className="flex items-start gap-2 px-3 py-2 text-red-400">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <div>Failed to load templates:</div>
              <div className="mt-1 break-words text-xs text-red-300">
                {templatesError}
              </div>
            </div>
          </div>
        )}
        {!templatesLoading &&
          !templatesError &&
          sortedEntries.length === 0 && (
            <div className="px-3 py-2 text-neutral-500">No templates.</div>
          )}
        {!templatesLoading && !templatesError && sortedEntries.length > 0 && (
          <ul role="tree" aria-label="Templates">
            {sortedEntries.map((entry) => {
              const handle = templateTabPath(entry.path);
              const selected = activePath === handle;
              return (
                <li key={entry.path} role="none">
                  <TemplateRow
                    entry={entry}
                    selected={selected}
                    onOpen={handleOpen}
                    onCopy={(e) =>
                      setCopyDialog({ open: true, entry: e })
                    }
                    onRename={(e) =>
                      setRenameDialog({ open: true, entry: e })
                    }
                    onDelete={(e) =>
                      setDeleteDialog({ open: true, entry: e })
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <InputDialog
        open={newTemplateOpen}
        title="New template"
        description="Create a new empty template under the templates directory."
        label="Template path"
        placeholder="router.yml"
        confirmLabel="Create template"
        validate={templatePathValidator}
        onConfirm={handleNewTemplate}
        onCancel={() => setNewTemplateOpen(false)}
      />

      <InputDialog
        open={renameDialog.open}
        title="Rename template"
        description={
          renameDialog.entry ? (
            <>
              Renaming{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
                {renameDialog.entry.path}
              </code>
            </>
          ) : null
        }
        label="New template path"
        placeholder="router.yml"
        initialValue={renameDialog.entry?.path ?? ''}
        confirmLabel="Rename"
        validate={templatePathValidator}
        onConfirm={handleRename}
        onCancel={() => setRenameDialog({ open: false, entry: null })}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete template?"
        description={
          deleteDialog.entry ? (
            <>
              This will permanently delete{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
                {deleteDialog.entry.path}
              </code>
              . This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteDialog({ open: false, entry: null })}
      />

      <CopyTemplateDialog
        open={copyDialog.open}
        template={copyDialog.entry}
        onClose={() => setCopyDialog({ open: false, entry: null })}
      />
    </div>
  );
}

function TemplateRow({
  entry,
  selected,
  onOpen,
  onCopy,
  onRename,
  onDelete,
}: {
  entry: TemplateEntry;
  selected: boolean;
  onOpen: (entry: TemplateEntry) => void;
  onCopy: (entry: TemplateEntry) => void;
  onRename: (entry: TemplateEntry) => void;
  onDelete: (entry: TemplateEntry) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onOpen(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(entry);
        }
      }}
      title={entry.path}
      className={`group flex items-center gap-1.5 truncate px-3 py-1 ${
        selected
          ? 'cursor-pointer bg-neutral-800 text-neutral-50'
          : 'cursor-pointer text-neutral-200 hover:bg-neutral-900'
      }`}
    >
      <FileText
        className="h-3.5 w-3.5 shrink-0 text-neutral-400"
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{entry.path}</span>
      <Tooltip content="Copy to data…">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(entry);
          }}
          className="invisible ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-emerald-300 group-hover:visible"
          aria-label={`Copy template ${entry.path} to data`}
        >
          <FileOutput className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Rename">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename(entry);
          }}
          className="invisible ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-sky-300 group-hover:visible"
          aria-label={`Rename template ${entry.path}`}
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Delete">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry);
          }}
          className="invisible ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-red-300 group-hover:visible"
          aria-label={`Delete template ${entry.path}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

function HeaderButton({
  children,
  label,
  tooltip,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        onClick={onClick}
        className="flex h-6 min-w-6 items-center justify-center rounded px-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Validate a template path entered by the user. Templates always
 * resolve relative to TEMPLATES_DIR — leading slashes are stripped on
 * the server but we reject them here for clarity. Must end in .yml or
 * .yaml; intermediate directories are allowed.
 */
function validateTemplatePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('/') || trimmed.includes('\\')) {
    return 'Path must be relative and use forward slashes.';
  }
  if (trimmed.includes('\0')) {
    return 'Path contains invalid characters.';
  }
  const segments = trimmed.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return 'Enter a template path.';
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return 'Path cannot contain "." or ".." segments.';
    }
  }
  if (!/\.(ya?ml)$/i.test(trimmed)) {
    return 'Template name must end in .yml or .yaml.';
  }
  return null;
}
