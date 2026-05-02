'use client';

/**
 * Top-level workbench shell. Wraps the three-pane layout in the
 * Workbench context provider so every child can read/write client
 * state through `useWorkbench()`.
 *
 * This component must be a client component because of the provider,
 * but its children can be a mix of client and server components.
 */

import { useCallback, useEffect, useState } from 'react';

import { AppHeader } from '@/components/Layout/AppHeader';
import { LeftPaneSplit } from '@/components/Layout/LeftPaneSplit';
import { ThreePane } from '@/components/Layout/ThreePane';
import { FileTree } from '@/components/FileTree/FileTree';
import { TemplatesTree } from '@/components/FileTree/TemplatesTree';
import { EditorTabs } from '@/components/Editor/EditorTabs';
import { EditorPane } from '@/components/Editor/EditorPane';
import { YamlTreePanel } from '@/components/YamlTree/YamlTreePanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ToastProvider } from '@/components/ui/Toast';
import {
  consumePendingOpen,
  type PendingOpen,
} from '@/lib/pending-open';
import { useWorkbenchHotkeys } from '@/hooks/useWorkbenchHotkeys';

import { CommandPalette, type PaletteMode } from './CommandPalette';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import {
  LAYOUT_DEFAULTS,
  WorkbenchProvider,
  useWorkbench,
} from './WorkbenchContext';

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
    leftSplitFraction,
    setLeftSplitFraction,
    resetLeftSplitFraction,
    templateEntries,
    templatesLoading,
    templatesError,
    pendingClosePath,
    confirmPendingClose,
    cancelPendingClose,
    openFile,
    scrollToLine,
  } = useWorkbench();

  // Palette state lives at the shell level so the global hotkey hook
  // and the palette component share a single source of truth. Mode is
  // separate from `open` so re-opening defaults back to the action list
  // instead of remembering whatever mode it was last closed in.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('actions');
  const openPalette = useCallback((mode: PaletteMode) => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useWorkbenchHotkeys({
    paletteOpen,
    openPalette,
    closePalette,
    openShortcuts,
  });

  // Show the templates pane only when the templates root yielded
  // something useful. An empty list (or a 5xx from the templates API)
  // means there's nothing to edit, so collapse the split and let the
  // file tree fill the entire left pane — that matches the user's
  // mental model: "if templates exist, split the pane".
  const showTemplates =
    !templatesLoading && !templatesError && templateEntries.length > 0;

  const leftPane = showTemplates ? (
    <LeftPaneSplit
      top={<FileTree />}
      bottom={<TemplatesTree />}
      fraction={leftSplitFraction}
      minFraction={LAYOUT_DEFAULTS.minLeftSplitFraction}
      maxFraction={LAYOUT_DEFAULTS.maxLeftSplitFraction}
      onResize={setLeftSplitFraction}
      onReset={resetLeftSplitFraction}
    />
  ) : (
    <FileTree />
  );

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
      <AppHeader onShowShortcuts={openShortcuts} />
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
          left={leftPane}
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
      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        onClose={closePalette}
        onModeChange={setPaletteMode}
      />
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={closeShortcuts}
      />
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
