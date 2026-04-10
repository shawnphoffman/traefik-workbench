'use client';

/**
 * Left-pane file tree backed by `/api/tree` and rendered with
 * `react-arborist`.
 *
 * Interaction model:
 * - Single click: select (arborist default)
 * - Double click / Enter: open file in editor (via `onActivate`)
 * - Directories toggle open on activation
 *
 * `react-arborist`'s `Tree` requires numeric `width` and `height`
 * props, so we measure the container with `useResizeObserver` and only
 * mount the tree once we have real dimensions. A simple skeleton
 * placeholder is shown before that.
 */

import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { useCallback } from 'react';

import { useWorkbench } from '@/components/Workbench/WorkbenchContext';
import { useResizeObserver } from '@/hooks/useResizeObserver';
import type { TreeEntry } from '@/types';

export function FileTree() {
  const {
    treeEntries,
    treeLoading,
    treeError,
    reloadTree,
    openFile,
    activePath,
    toggleLeft,
  } = useWorkbench();

  const { ref, size } = useResizeObserver<HTMLDivElement>();

  const handleActivate = useCallback(
    (node: NodeApi<TreeEntry>) => {
      if (node.data.kind === 'file') {
        void openFile(node.data.path);
      } else {
        node.toggle();
      }
    },
    [openFile],
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-neutral-200">
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>Files</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void reloadTree()}
            className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Reload file tree"
            title="Reload"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={toggleLeft}
            className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Collapse files panel"
            title="Collapse"
          >
            «
          </button>
        </div>
      </header>

      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        {treeLoading && (
          <div className="px-3 py-2 text-neutral-500">Loading…</div>
        )}
        {treeError && !treeLoading && (
          <div className="px-3 py-2 text-red-400">
            <div>Failed to load tree:</div>
            <div className="mt-1 break-words text-xs text-red-300">
              {treeError}
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
            {FileTreeNode}
          </Tree>
        )}
      </div>
    </div>
  );
}

/**
 * Node renderer. Click handling is done by the default row wrapper,
 * which calls `node.handleClick` → `onActivate` on single click. Our
 * `onActivate` handler (in <FileTree>) takes care of toggling
 * directories vs. opening files, so this component is purely visual.
 */
function FileTreeNode({
  node,
  style,
  dragHandle,
}: NodeRendererProps<TreeEntry>) {
  const isDirectory = node.data.kind === 'directory';
  const icon = isDirectory ? (node.isOpen ? '📂' : '📁') : '📄';

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`flex cursor-pointer items-center gap-1 truncate pr-2 ${
        node.isSelected
          ? 'bg-neutral-800 text-neutral-50'
          : 'text-neutral-200 hover:bg-neutral-900'
      }`}
      title={node.data.path}
    >
      <span className="inline-block w-4 text-center text-xs">{icon}</span>
      <span className="truncate">{node.data.name}</span>
    </div>
  );
}
