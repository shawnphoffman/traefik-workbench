'use client';

/**
 * Left-pane file tree backed by `/api/tree` and rendered with
 * `react-arborist`.
 *
 * Interaction model:
 * - Single click on a file: open in editor
 * - Single click on a directory: toggle expand/collapse
 * - Hover over a row: reveal rename/delete icons + an overflow menu
 *   with secondary actions (move, save as template)
 *
 * Header toolbar (all Lucide icons):
 * - FilePlus       — new file (target directory is the selected folder or root)
 * - FolderPlus     — new folder
 * - LayoutTemplate — open the Templates dialog
 * - FileCode       — new template
 * - RefreshCw      — reload the tree
 * - PanelLeftClose — collapse the files panel
 *
 * `react-arborist`'s `Tree` requires numeric `width`/`height` props, so
 * we measure the container with `useResizeObserver` and only mount the
 * tree once we have real dimensions. A simple skeleton placeholder is
 * shown before that.
 */

import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Ellipsis,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  Loader2,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

import { useWorkbench } from '@/components/Workbench/WorkbenchContext';
import { useResizeObserver } from '@/hooks/useResizeObserver';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InputDialog } from '@/components/ui/InputDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { TemplatesDialog } from '@/components/Templates/TemplatesDialog';
import { fetchFile } from '@/lib/api-client';
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

interface MoveDialogState {
  open: boolean;
  entry: TreeEntry | null;
}

/**
 * State machine for the "Save as template" flow. The flow is:
 *
 *   1. User clicks the menu item → status: 'loading' while we fetch
 *      the source file's content (or read the in-memory buffer)
 *   2. status: 'ready' → InputDialog is shown with the suggested
 *      template path
 *   3. User confirms → status: 'saving' → API call → success/error
 *
 * We keep the captured `content` here rather than re-fetching on
 * confirm so the template snapshot matches the moment the user chose
 * the action.
 */
type SaveAsTemplateDialogState =
  | { status: 'closed' }
  | { status: 'loading'; entry: TreeEntry }
  | { status: 'ready'; entry: TreeEntry; content: string };

export function FileTree() {
  const {
    treeEntries,
    treeLoading,
    treeError,
    reloadTree,
    openFile,
    openFiles,
    activePath,
    toggleLeft,
    createFile,
    createDirectory,
    deletePath,
    renamePath,
    saveAsTemplate,
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
  const [moveDialog, setMoveDialog] = useState<MoveDialogState>({
    open: false,
    entry: null,
  });
  const [saveAsTemplateDialog, setSaveAsTemplateDialog] =
    useState<SaveAsTemplateDialogState>({ status: 'closed' });
  const [newTemplateOpen, setNewTemplateOpen] = useState<boolean>(false);
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

  const handleMoveSubmit = useCallback(
    async (destinationDir: string) => {
      const entry = moveDialog.entry;
      if (!entry) return;
      // Normalize the destination directory: strip trailing slashes
      // and treat the empty string as "data root".
      const normalizedDir = destinationDir.trim().replace(/^\/+|\/+$/g, '');
      const destination =
        normalizedDir.length > 0
          ? `${normalizedDir}/${entry.name}`
          : entry.name;
      if (destination === entry.path) {
        // No-op move (user picked the entry's current parent).
        setMoveDialog({ open: false, entry: null });
        return;
      }
      try {
        await renamePath(entry.path, destination);
        toast({
          kind: 'success',
          message: `Moved to ${destination}`,
        });
        setMoveDialog({ open: false, entry: null });
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Move failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [moveDialog.entry, renamePath, toast],
  );

  /**
   * Open the "Save as template" dialog for a tree row. We capture the
   * file's content up front so the dialog doesn't race a concurrent
   * edit. If the file is already open as a tab we read the in-memory
   * buffer (which may be unsaved); otherwise we fetch from the server.
   */
  const handleRequestSaveAsTemplate = useCallback(
    async (entry: TreeEntry) => {
      if (entry.kind !== 'file') return;
      setSaveAsTemplateDialog({ status: 'loading', entry });
      try {
        const open = openFiles.find((f) => f.path === entry.path);
        let content: string;
        if (open) {
          content = open.content;
        } else {
          const body = await fetchFile(entry.path);
          content = body.content;
        }
        setSaveAsTemplateDialog({ status: 'ready', entry, content });
      } catch (err) {
        setSaveAsTemplateDialog({ status: 'closed' });
        toast({
          kind: 'error',
          title: 'Could not read file',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [openFiles, toast],
  );

  const handleSaveAsTemplateSubmit = useCallback(
    async (templatePath: string) => {
      if (saveAsTemplateDialog.status !== 'ready') return;
      const trimmed = templatePath.trim().replace(/^\/+/, '');
      try {
        await saveAsTemplate(trimmed, saveAsTemplateDialog.content);
        toast({
          kind: 'success',
          message: `Saved template ${trimmed}`,
        });
        setSaveAsTemplateDialog({ status: 'closed' });
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Save as template failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [saveAsTemplateDialog, saveAsTemplate, toast],
  );

  const handleNewTemplateSubmit = useCallback(
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

  const moveValidator = useCallback((value: string) => {
    return validateRelativeDirPath(value);
  }, []);

  const templatePathValidator = useCallback((value: string) => {
    return validateTemplatePath(value);
  }, []);

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
            onClick={() => setNewTemplateOpen(true)}
            label="New template"
            tooltip="New template…"
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
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
                onRequestMove={(entry) =>
                  setMoveDialog({ open: true, entry })
                }
                onRequestSaveAsTemplate={handleRequestSaveAsTemplate}
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

      <InputDialog
        open={moveDialog.open}
        title={
          moveDialog.entry?.kind === 'directory' ? 'Move folder' : 'Move file'
        }
        description={
          moveDialog.entry ? (
            <>
              Moving{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
                {moveDialog.entry.path}
              </code>
            </>
          ) : null
        }
        label="Destination directory"
        placeholder="routers"
        initialValue={parentOf(moveDialog.entry?.path ?? '')}
        confirmLabel="Move"
        validate={moveValidator}
        onConfirm={handleMoveSubmit}
        onCancel={() => setMoveDialog({ open: false, entry: null })}
      />

      <InputDialog
        open={saveAsTemplateDialog.status === 'ready'}
        title="Save as template"
        description={
          saveAsTemplateDialog.status === 'ready' ? (
            <>
              Saving a copy of{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs">
                {saveAsTemplateDialog.entry.path}
              </code>{' '}
              into the templates directory.
            </>
          ) : null
        }
        label="Template path"
        placeholder="router.yml"
        initialValue={
          saveAsTemplateDialog.status === 'ready'
            ? saveAsTemplateDialog.entry.name
            : ''
        }
        confirmLabel="Save template"
        validate={templatePathValidator}
        onConfirm={handleSaveAsTemplateSubmit}
        onCancel={() => setSaveAsTemplateDialog({ status: 'closed' })}
      />

      <InputDialog
        open={newTemplateOpen}
        title="New template"
        description="Create a new empty template under the templates directory."
        label="Template path"
        placeholder="router.yml"
        confirmLabel="Create template"
        validate={templatePathValidator}
        onConfirm={handleNewTemplateSubmit}
        onCancel={() => setNewTemplateOpen(false)}
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
 * Validate a directory path used as a "move to" destination. The
 * empty string is allowed and means "the data root". Each segment is
 * validated against the same rules as `validateEntryName` (minus the
 * .yml/.yaml extension constraint, since these are directory names).
 */
function validateRelativeDirPath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null; // empty = root, allowed
  if (trimmed.startsWith('/') || trimmed.includes('\\')) {
    return 'Path must be relative and use forward slashes.';
  }
  if (trimmed.includes('\0')) {
    return 'Path contains invalid characters.';
  }
  const segments = trimmed.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return 'Path cannot contain "." or ".." segments.';
    }
  }
  return null;
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

/**
 * Return the parent directory of a POSIX-style relative path. Returns
 * the empty string for top-level entries (e.g., `web.yml` → ``).
 */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
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
  onRequestMove,
  onRequestSaveAsTemplate,
  onRequestDelete,
}: NodeRendererProps<TreeEntry> & {
  onRequestRename: (entry: TreeEntry) => void;
  onRequestMove: (entry: TreeEntry) => void;
  onRequestSaveAsTemplate: (entry: TreeEntry) => void;
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
      <OverflowMenu
        ariaLabel={`More actions for ${node.data.path}`}
        items={[
          {
            label: 'Move…',
            icon: <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />,
            onSelect: () => onRequestMove(node.data),
          },
          // "Save as template" is only meaningful for files. If the
          // templates volume is mounted read-only, the create call will
          // fail at the API and surface as a toast.
          ...(node.data.kind === 'file'
            ? [
                {
                  label: 'Save as template…',
                  icon: <Save className="h-3.5 w-3.5" aria-hidden="true" />,
                  onSelect: () => onRequestSaveAsTemplate(node.data),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

// ---------- overflow menu ----------

interface OverflowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

/**
 * Tiny portal-rendered dropdown menu used by the file tree row.
 *
 * Why a portal: the tree container has `overflow: hidden` (and is
 * itself virtualized by react-arborist), so a normally-positioned
 * absolute menu would be clipped by the row. Rendering into
 * `document.body` and positioning via `getBoundingClientRect` lets the
 * menu escape both clips.
 *
 * Behavior:
 * - Closes on outside click, Escape, scroll, or window resize. The
 *   scroll handler is intentionally aggressive — repositioning the
 *   menu while the user scrolls feels glitchy, and dismissing is the
 *   normal expectation for transient menus.
 * - The trigger button uses the same hover-only visibility pattern as
 *   the rename/delete icons so it doesn't add visual noise to every
 *   row by default.
 * - If `items` is empty, the trigger is hidden — there's nothing to
 *   show.
 */
function OverflowMenu({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: OverflowMenuItem[];
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  const close = useCallback(() => setOpen(false), []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    // Right-align the menu under the trigger so it doesn't run off the
    // right edge of a narrow files panel. The menu width is roughly
    // 192px (`w-48`); we offset by that minus the trigger width.
    const MENU_WIDTH = 192;
    const left = Math.max(8, rect.right - MENU_WIDTH);
    const top = rect.bottom + 4;
    return { top, left };
  }, []);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (open) {
        setOpen(false);
        return;
      }
      const next = computePosition();
      if (next) setPosition(next);
      setOpen(true);
    },
    [open, computePosition],
  );

  // Outside click / escape / scroll / resize → close.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      const target = e.target as Node | null;
      if (menu && target && menu.contains(target)) return;
      if (trigger && target && trigger.contains(target)) return;
      close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const handleScroll = () => close();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, close]);

  if (items.length === 0) return null;

  return (
    <>
      <Tooltip content="More actions">
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggle}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={`ml-1 flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:text-neutral-100 ${
            open ? 'visible text-neutral-100' : 'invisible group-hover:visible'
          }`}
        >
          <Ellipsis className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
            }}
            className="z-50 w-48 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm text-neutral-100 shadow-xl"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-800"
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
