'use client';

/**
 * Top-level workbench shell. Wraps the three-pane layout in the
 * Workbench context provider so every child can read/write client
 * state through `useWorkbench()`.
 *
 * This component must be a client component because of the provider,
 * but its children can be a mix of client and server components.
 */

import { ThreePane } from '@/components/Layout/ThreePane';
import { FileTree } from '@/components/FileTree/FileTree';
import { EditorTabs } from '@/components/Editor/EditorTabs';
import { EditorPane } from '@/components/Editor/EditorPane';
import { YamlTreePanel } from '@/components/YamlTree/YamlTreePanel';

import { WorkbenchProvider, useWorkbench } from './WorkbenchContext';

export function Workbench() {
  return (
    <WorkbenchProvider>
      <WorkbenchLayout />
    </WorkbenchProvider>
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
  } = useWorkbench();

  return (
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
  );
}
