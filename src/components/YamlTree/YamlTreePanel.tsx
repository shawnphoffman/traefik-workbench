'use client';

/**
 * Right-pane YAML structure view for the active file.
 *
 * Parses the active file's content (debounced in the hook) into a
 * `YamlTreeNode` tree and renders it as nested collapsible lists.
 * Clicking a node asks the Workbench context to scroll the editor to
 * that line.
 *
 * Error handling: on parse failure, we show a small banner at the top
 * but keep rendering the last-successful tree (tracked in a ref) so
 * the user isn't left staring at an empty panel while fixing a typo.
 */

import { useState } from 'react';

import { useYamlParse } from '@/hooks/useYamlParse';
import {
  useActiveFile,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import type { YamlTreeNode } from '@/types';

export function YamlTreePanel() {
  const active = useActiveFile();
  const { scrollToLine } = useWorkbench();

  const result = useYamlParse(active?.content ?? '');

  // Preserve the last-good tree so a transient parse error doesn't
  // blank out the panel while the user is typing. This is React's
  // supported "derived state from a prop" pattern: setState during
  // render is a no-op if the value is reference-equal, otherwise it
  // schedules a re-render immediately.
  const [lastGoodTree, setLastGoodTree] = useState<YamlTreeNode | null>(
    result.ok ? result.tree : null,
  );
  if (result.ok && result.tree !== lastGoodTree) {
    setLastGoodTree(result.tree);
  }

  if (!active) {
    return (
      <PanelFrame>
        <div className="px-3 py-2 text-neutral-500">No file open.</div>
      </PanelFrame>
    );
  }

  const tree = result.ok ? result.tree : lastGoodTree;
  const errorBanner = !result.ok ? (
    <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
      <div className="font-medium">Parse error</div>
      <div className="mt-0.5 text-red-300">
        {result.error.message}
        {result.error.line != null && ` (line ${result.error.line})`}
      </div>
    </div>
  ) : null;

  return (
    <PanelFrame>
      {errorBanner}
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1 text-sm">
        {tree == null ? (
          <div className="px-2 py-2 text-neutral-500">Empty document.</div>
        ) : (
          <ul className="font-mono">
            <YamlNode node={tree} depth={0} onClick={scrollToLine} />
          </ul>
        )}
      </div>
    </PanelFrame>
  );
}

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col text-neutral-200">
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>Structure</span>
      </header>
      {children}
    </div>
  );
}

function YamlNode({
  node,
  depth,
  onClick,
}: {
  node: YamlTreeNode;
  depth: number;
  onClick: (line: number) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const toggleable = hasChildren;

  return (
    <li>
      <div
        className="flex cursor-pointer items-center gap-1 rounded px-1 hover:bg-neutral-900"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onClick(node.line)}
      >
        {toggleable ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((v) => !v);
            }}
            className="inline-flex h-4 w-4 items-center justify-center text-neutral-500 hover:text-neutral-200"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="inline-block h-4 w-4" />
        )}
        <span
          className={
            node.kind === 'scalar'
              ? 'text-neutral-300'
              : 'text-sky-300'
          }
        >
          {node.key || '$'}
        </span>
        {node.kind === 'scalar' && node.valuePreview != null && (
          <span className="ml-1 truncate text-neutral-500">
            : {node.valuePreview}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <ul>
          {node.children!.map((child) => (
            <YamlNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onClick={onClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
