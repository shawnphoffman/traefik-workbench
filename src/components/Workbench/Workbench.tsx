'use client';

/**
 * Top-level workbench shell. Wraps the three-pane layout in the
 * Workbench context provider so every child can read/write client
 * state through `useWorkbench()`.
 *
 * This component must be a client component because of the provider,
 * but its children can be a mix of client and server components.
 */

import { useEffect } from 'react';

import { AppHeader } from '@/components/Layout/AppHeader';
import { ThreePane } from '@/components/Layout/ThreePane';
import { FileTree } from '@/components/FileTree/FileTree';
import { EditorTabs } from '@/components/Editor/EditorTabs';
import { EditorPane } from '@/components/Editor/EditorPane';
import { YamlTreePanel } from '@/components/YamlTree/YamlTreePanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ToastProvider } from '@/components/ui/Toast';
import {
  consumePendingOpen,
  type PendingOpen,
} from '@/lib/pending-open';

import { WorkbenchProvider, useWorkbench } from './WorkbenchContext';

export function Workbench() {
  return (
    <ToastProvider>
      <WorkbenchProvider>
        <WorkbenchLayout />
      </WorkbenchProvider>
    </ToastProvider>
  );
}

function WorkbenchLayout() {
  const {
    leftCollapsed,
    rightCollapsed,
    toggleLeft,
    toggleRight,
    leftWidth,
    rightWidth,
    setLeftWidth,
    setRightWidth,
    resetLeftWidth,
    resetRightWidth,
    pendingClosePath,
    confirmPendingClose,
    cancelPendingClose,
    openFile,
    scrollToLine,
  } = useWorkbench();

  // Consume any "open this file at this line" handoff written by the
  // /traefik diagnostics panel before we got here. We do the read once
  // on mount; the consume helper clears the key so a hard reload won't
  // re-trigger the navigation. The line scroll is delayed so Monaco's
  // model has been swapped in by the time we ask it to scroll.
  useEffect(() => {
    const pending: PendingOpen | null = consumePendingOpen();
    if (!pending) return;
    void (async () => {
      try {
        await openFile(pending.path);
        if (typeof pending.line === 'number' && pending.line >= 1) {
          // Two RAFs: first lets React commit the new active tab, the
          // second lets the EditorPane mount the model so scrollToLine
          // actually has something to act on.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollToLine(pending.line!));
          });
        }
      } catch {
        // Best effort — if the file no longer exists the user will see
        // the error in the tab itself, no need to surface a toast.
      }
    })();
  }, [openFile, scrollToLine]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AppHeader />
      <div className="min-h-0 flex-1">
        <ThreePane
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onExpandLeft={toggleLeft}
          onExpandRight={toggleRight}
          leftRailLabel="Files"
          rightRailLabel="Structure"
          leftWidth={leftWidth}
          rightWidth={rightWidth}
          onResizeLeft={setLeftWidth}
          onResizeRight={setRightWidth}
          onResetLeft={resetLeftWidth}
          onResetRight={resetRightWidth}
          left={<FileTree />}
          center={
            <>
              <EditorTabs />
              <div className="min-h-0 flex-1">
                <EditorPane />
              </div>
            </>
          }
          right={<YamlTreePanel />}
        />
      </div>
      <ConfirmDialog
        open={pendingClosePath != null}
        title="Discard unsaved changes?"
        description={
          pendingClosePath != null ? (
            <>
              <div>
                <span className="font-mono text-neutral-100">
                  {pendingClosePath}
                </span>{' '}
                has unsaved changes.
              </div>
              <div className="mt-1 text-neutral-400">
                Closing the tab will discard them. This cannot be undone.
              </div>
            </>
          ) : null
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={confirmPendingClose}
        onCancel={cancelPendingClose}
      />
    </div>
  );
}
