'use client';

/**
 * Left-pane file tree backed by `/api/tree` and rendered with
 * `react-arborist`.
 *
 * Interaction model:
 * - Single click on a file: open in editor
 * - Single click on a directory: toggle expand/collapse
 * - Hover over a row: reveal rename/delete icons
 *
 * Header toolbar (all Lucide icons):
 * - FilePlus       — new file (target directory is the selected folder or root)
 * - FolderPlus     — new folder
 * - LayoutTemplate — open the Templates dialog
 * - RefreshCw      — reload the tree
 * - PanelLeftClose — collapse the files panel
 *
 * `react-arborist`'s `Tree` requires numeric `width`/`height` props, so
 * we measure the container with `useResizeObserver` and only mount the
 * tree once we have real dimensions. A simple skeleton placeholder is
 * shown before that.
 */

import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  Loader2,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { useWorkbench } from '@/components/Workbench/WorkbenchContext';
import { useResizeObserver } from '@/hooks/useResizeObserver';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InputDialog } from '@/components/ui/InputDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { TemplatesDialog } from '@/components/Templates/TemplatesDialog';
import type { TreeEntry } from '@/types';

type CreateKind = 'file' | 'directory';

interface CreateDialogState {
  open: boolean;
  kind: CreateKind;
  /** Parent directory path (relative, empty string = root). */
  parent: string;
}

interface DeleteDialogState {
  open: boolean;
  entry: TreeEntry | null;
}

interface RenameDialogState {
  open: boolean;
  entry: TreeEntry | null;
}

export function FileTree() {
  const {
    treeEntries,
    treeLoading,
    treeError,
    reloadTree,
    openFile,
    activePath,
    toggleLeft,
    createFile,
    createDirectory,
    deletePath,
    renamePath,
  } = useWorkbench();

  const { toast } = useToast();
  const { ref, size } = useResizeObserver<HTMLDivElement>();

  // Selection state tracked locally so we know where to create new
  // entries relative to (the nearest directory above the selection).
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null);

  const [createDialog, setCreateDialog] = useState<CreateDialogState>({
    open: false,
    kind: 'file',
    parent: '',
  });
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    open: false,
    entry: null,
  });
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
    open: false,
    entry: null,
  });
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false);

  const handleActivate = useCallback(
    (node: NodeApi<TreeEntry>) => {
      setSelectedEntry(node.data);
      if (node.data.kind === 'file') {
        // Only YAML files are editable. Non-YAML rows are rendered as
        // disabled (see FileTreeNode), but react-arborist will still
        // fire `onActivate` on keyboard Enter, so we belt-and-brace
        // here as well.
        if (!isYamlPath(node.data.path)) return;
        void openFile(node.data.path);
      } else {
        node.toggle();
      }
    },
    [openFile],
  );

  // Resolve the directory path used as the parent for new entries.
  // If a file is selected, its containing directory is used; if a
  // directory is selected, that directory itself; otherwise the root.
  const activeParent = useMemo(() => {
    if (!selectedEntry) return '';
    if (selectedEntry.kind === 'directory') return selectedEntry.path;
    const slash = selectedEntry.path.lastIndexOf('/');
    return slash === -1 ? '' : selectedEntry.path.slice(0, slash);
  }, [selectedEntry]);

  const openCreateDialog = (kind: CreateKind) =>
    setCreateDialog({ open: true, kind, parent: activeParent });

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      const joined =
        createDialog.parent.length > 0
          ? `${createDialog.parent}/${trimmed}`
          : trimmed;
      try {
        if (createDialog.kind === 'file') {
          await createFile(joined);
          toast({
            kind: 'success',
            message: `Created ${joined}`,
          });
        } else {
          await createDirectory(joined);
          toast({
            kind: 'success',
            message: `Created folder ${joined}`,
          });
        }
        setCreateDialog((prev) => ({ ...prev, open: false }));
      } catch (err) {
        toast({
          kind: 'error',
          title:
            createDialog.kind === 'file'
              ? 'Could not create file'
              : 'Could not create folder',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [createDialog, createFile, createDirectory, toast],
  );

  const handleRenameSubmit = useCallback(
    async (name: string) => {
      const entry = renameDialog.entry;
      if (!entry) return;
      const trimmed = name.trim();
      const slash = entry.path.lastIndexOf('/');
      const parentDir = slash === -1 ? '' : entry.path.slice(0, slash);
      const destination =
        parentDir.length > 0 ? `${parentDir}/${trimmed}` : trimmed;
      if (destination === entry.path) {
        setRenameDialog({ open: false, entry: null });
        return;
      }
      try {
        await renamePath(entry.path, destination);
        toast({
          kind: 'success',
          message: `Renamed to ${destination}`,
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
    [renameDialog.entry, renamePath, toast],
  );

  const handleDeleteSubmit = useCallback(async () => {
    const entry = deleteDialog.entry;
    if (!entry) return;
    try {
      await deletePath(entry.path);
      toast({ kind: 'success', message: `Deleted ${entry.path}` });
      setDeleteDialog({ open: false, entry: null });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [deleteDialog.entry, deletePath, toast]);

  const createValidator = useCallback(
    (value: string) => validateEntryName(value, createDialog.kind),
    [createDialog.kind],
  );

  const renameValidator = useCallback(
    (value: string) => {
      const entry = renameDialog.entry;
      if (!entry) return null;
      const kind: CreateKind = entry.kind === 'directory' ? 'directory' : 'file';
      return validateEntryName(value, kind);
    },
    [renameDialog.entry],
  );

  // The arborist tree needs a key that changes when the underlying data
  // changes; otherwise state (e.g. open dirs) can get stuck on stale
  // node identities. React will still reconcile children correctly
  // because idAccessor=path identifies nodes by stable path.

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-neutral-200">
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>Files</span>
        <div className="flex items-center gap-0.5">
          <HeaderButton
            onClick={() => openCreateDialog('file')}
            label="New file"
            tooltip="New file"
          >
            <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
          <HeaderButton
            onClick={() => openCreateDialog('directory')}
            label="New folder"
            tooltip="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
          <HeaderButton
            onClick={() => setTemplatesOpen(true)}
            label="Open templates"
            tooltip="Copy from templates…"
          >
            <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
          <HeaderButton
            onClick={() => void reloadTree()}
            label="Reload file tree"
            tooltip="Reload"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
          <HeaderButton
            onClick={toggleLeft}
            label="Collapse files panel"
            tooltip="Collapse files panel"
          >
            <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
          </HeaderButton>
        </div>
      </header>

      <div ref={ref} className="min-h-0 flex-1 overflow-hidden pt-1">
        {treeLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
        {treeError && !treeLoading && (
          <div className="flex items-start gap-2 px-3 py-2 text-red-400">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <div>Failed to load tree:</div>
              <div className="mt-1 break-words text-xs text-red-300">
                {treeError}
              </div>
            </div>
          </div>
        )}
        {!treeLoading && !treeError && treeEntries.length === 0 && (
          <div className="px-3 py-2 text-neutral-500">No files.</div>
        )}
        {!treeLoading && !treeError && treeEntries.length > 0 && size && (
          <Tree<TreeEntry>
            data={treeEntries}
            idAccessor={(entry) => entry.path}
            childrenAccessor={(entry) =>
              entry.kind === 'directory' ? entry.children ?? null : null
            }
            openByDefault={false}
            width={size.width}
            height={size.height}
            indent={16}
            rowHeight={24}
            onActivate={handleActivate}
            selection={activePath ?? undefined}
            disableDrag
            disableDrop
            disableEdit
          >
            {(props) => (
              <FileTreeNode
                {...props}
                onRequestRename={(entry) =>
                  setRenameDialog({ open: true, entry })
                }
                onRequestDelete={(entry) =>
                  setDeleteDialog({ open: true, entry })
                }
              />
            )}
          </Tree>
        )}
      </div>

      <InputDialog
        open={createDialog.open}
        title={
          createDialog.kind === 'file' ? 'New file' : 'New folder'
        }
        description={
          <>
            In{' '}
            <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
              {createDialog.parent || '/'}
            </code>
          </>
        }
        label="Name"
        placeholder={
          createDialog.kind === 'file' ? 'example.yml' : 'new-folder'
        }
        confirmLabel="Create"
        validate={createValidator}
        onConfirm={handleCreateSubmit}
        onCancel={() => setCreateDialog((p) => ({ ...p, open: false }))}
      />

      <InputDialog
        open={renameDialog.open}
        title={
          renameDialog.entry?.kind === 'directory'
            ? 'Rename folder'
            : 'Rename file'
        }
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
        label="New name"
        placeholder={
          renameDialog.entry?.kind === 'file' ? 'example.yml' : 'new-name'
        }
        initialValue={renameDialog.entry?.name ?? ''}
        confirmLabel="Rename"
        validate={renameValidator}
        onConfirm={handleRenameSubmit}
        onCancel={() => setRenameDialog({ open: false, entry: null })}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title={
          deleteDialog.entry?.kind === 'directory'
            ? 'Delete folder?'
            : 'Delete file?'
        }
        description={
          deleteDialog.entry ? (
            <>
              This will permanently delete{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
                {deleteDialog.entry.path}
              </code>
              {deleteDialog.entry.kind === 'directory' && ' and everything inside it'}.
              This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteSubmit}
        onCancel={() => setDeleteDialog({ open: false, entry: null })}
      />

      <TemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        defaultDestinationDir={activeParent}
      />
    </div>
  );
}

/**
 * Compact square icon button used in the tree header toolbar, with a
 * hover-delay tooltip.
 */
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
 * True if the given path looks like a YAML file. Mirrors `isYamlFile`
 * in `lib/paths.ts`, but kept local so this client component doesn't
 * pull in the server paths module.
 */
function isYamlPath(p: string): boolean {
  return /\.ya?ml$/i.test(p);
}

/**
 * Validate a path segment used as a new file/folder name. Returns an
 * error message or null if the value is acceptable.
 */
function validateEntryName(value: string, kind: CreateKind): string | null {
  const name = value.trim();
  if (name.length === 0) return null; // treated as "empty" — submit disabled
  if (name.includes('/') || name.includes('\\')) {
    return 'Name cannot contain slashes.';
  }
  if (name === '.' || name === '..') {
    return 'Name cannot be "." or "..".';
  }
  if (name.includes('\0')) {
    return 'Name contains invalid characters.';
  }
  if (kind === 'file') {
    if (!/\.(ya?ml)$/i.test(name)) {
      return 'File name must end in .yml or .yaml.';
    }
  }
  return null;
}

/**
 * Node renderer. Click handling is done by the default row wrapper,
 * which calls `node.handleClick` → `onActivate` on single click. We
 * overlay a hover-only trash button on the right side for deletion.
 */
function FileTreeNode({
  node,
  style,
  dragHandle,
  onRequestRename,
  onRequestDelete,
}: NodeRendererProps<TreeEntry> & {
  onRequestRename: (entry: TreeEntry) => void;
  onRequestDelete: (entry: TreeEntry) => void;
}) {
  const isDirectory = node.data.kind === 'directory';
  // Non-YAML files can't be opened in the editor (the editor only
  // understands YAML, and "view as text" would just be a footgun for
  // editing binaries). Render them dimmed and non-interactive so the
  // user sees what's in the directory without being able to click in.
  const isUneditableFile = !isDirectory && !isYamlPath(node.data.path);
  const IconComponent = isDirectory
    ? node.isOpen
      ? FolderOpen
      : Folder
    : FileText;

  // react-arborist drives the leading indent via `style.paddingLeft`
  // (= node.level * indent). We merge a small extra gutter on top of
  // it so even root-level rows breathe away from the panel edges, and
  // add matching right padding so the rename/delete icons don't kiss
  // the scrollbar.
  const arboristPaddingLeft =
    typeof style.paddingLeft === 'number' ? style.paddingLeft : 0;
  const mergedStyle = {
    ...style,
    paddingLeft: arboristPaddingLeft + 10,
    paddingRight: 10,
  };

  // react-arborist invokes the row's own click handler, which calls
  // onActivate for any node. We swallow clicks on disabled rows in
  // the capture phase so the tree doesn't even change selection —
  // matches the visual "this row is inert" affordance.
  const swallowIfDisabled = isUneditableFile
    ? (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;

  return (
    <div
      ref={dragHandle}
      style={mergedStyle}
      onClickCapture={swallowIfDisabled}
      onDoubleClickCapture={swallowIfDisabled}
      className={`group flex items-center gap-1.5 truncate ${
        isUneditableFile
          ? 'cursor-not-allowed text-neutral-500 opacity-60'
          : node.isSelected
            ? 'cursor-pointer bg-neutral-800 text-neutral-50'
            : 'cursor-pointer text-neutral-200 hover:bg-neutral-900'
      }`}
      title={
        isUneditableFile
          ? `${node.data.path} — only .yml / .yaml files can be opened`
          : node.data.path
      }
      aria-disabled={isUneditableFile || undefined}
    >
      <IconComponent
        className={`h-3.5 w-3.5 shrink-0 ${
          isDirectory
            ? 'text-sky-400'
            : isUneditableFile
              ? 'text-neutral-600'
              : 'text-neutral-400'
        }`}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{node.data.name}</span>
      <Tooltip content="Rename">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestRename(node.data);
          }}
          className="invisible ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-sky-300 group-hover:visible"
          aria-label={`Rename ${node.data.path}`}
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Delete">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(node.data);
          }}
          className="invisible ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-red-300 group-hover:visible"
          aria-label={`Delete ${node.data.path}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
