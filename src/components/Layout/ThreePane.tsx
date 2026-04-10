'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { Tooltip } from '@/components/ui/Tooltip';

/**
 * Three-pane layout: left and right side panes flanking a flexible
 * center pane. Either side pane can be:
 *
 * - Collapsed to a thin vertical rail with a label and expand button
 * - Resized by dragging the vertical gutter between the side and the
 *   center. Double-click the gutter to reset to the default width.
 *
 * Designed to fill its parent container — the parent should be sized
 * (the `<Workbench>` shell uses `h-screen`).
 *
 * This component is `'use client'` because the resize gutters need
 * pointer event handlers. Collapse and width state are owned by the
 * caller so they can be persisted.
 */
export interface ThreePaneProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;

  leftWidth: number;
  rightWidth: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;

  onResizeLeft: (px: number) => void;
  onResizeRight: (px: number) => void;
  onResetLeft?: () => void;
  onResetRight?: () => void;

  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  leftRailLabel?: string;
  rightRailLabel?: string;
  onExpandLeft?: () => void;
  onExpandRight?: () => void;

  className?: string;
}

const RAIL_WIDTH_PX = 36;
const GUTTER_WIDTH_PX = 5;

export function ThreePane({
  left,
  center,
  right,
  leftWidth,
  rightWidth,
  minLeftWidth = 160,
  maxLeftWidth = 560,
  minRightWidth = 200,
  maxRightWidth = 640,
  onResizeLeft,
  onResizeRight,
  onResetLeft,
  onResetRight,
  leftCollapsed = false,
  rightCollapsed = false,
  leftRailLabel = 'Files',
  rightRailLabel = 'Structure',
  onExpandLeft,
  onExpandRight,
  className = '',
}: ThreePaneProps) {
  // Build the grid template columns and the children in lockstep so
  // the implicit grid placement lines up, skipping gutter columns when
  // the adjacent side pane is collapsed.
  const leftCol = leftCollapsed ? `${RAIL_WIDTH_PX}px` : `${leftWidth}px`;
  const rightCol = rightCollapsed ? `${RAIL_WIDTH_PX}px` : `${rightWidth}px`;

  const cols: string[] = [leftCol];
  if (!leftCollapsed) cols.push(`${GUTTER_WIDTH_PX}px`);
  cols.push('1fr');
  if (!rightCollapsed) cols.push(`${GUTTER_WIDTH_PX}px`);
  cols.push(rightCol);

  return (
    <div
      className={`grid h-full w-full overflow-hidden ${className}`}
      style={{ gridTemplateColumns: cols.join(' ') }}
    >
      <aside className="flex min-h-0 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
        {leftCollapsed ? (
          <CollapsedRail
            side="left"
            label={leftRailLabel}
            onExpand={onExpandLeft}
          />
        ) : (
          left
        )}
      </aside>

      {!leftCollapsed && (
        <ResizeGutter
          side="left"
          currentWidth={leftWidth}
          min={minLeftWidth}
          max={maxLeftWidth}
          onResize={onResizeLeft}
          onReset={onResetLeft}
          ariaLabel="Resize files panel"
        />
      )}

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-900">
        {center}
      </main>

      {!rightCollapsed && (
        <ResizeGutter
          side="right"
          currentWidth={rightWidth}
          min={minRightWidth}
          max={maxRightWidth}
          onResize={onResizeRight}
          onReset={onResetRight}
          ariaLabel="Resize structure panel"
        />
      )}

      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950">
        {rightCollapsed ? (
          <CollapsedRail
            side="right"
            label={rightRailLabel}
            onExpand={onExpandRight}
          />
        ) : (
          right
        )}
      </aside>
    </div>
  );
}

/**
 * Draggable vertical gutter between two panes. Uses pointer capture so
 * the drag keeps tracking even when the cursor leaves the gutter
 * element. The delta is computed against the snapshot taken on
 * pointerdown, which is robust against missed move events.
 */
function ResizeGutter({
  side,
  currentWidth,
  min,
  max,
  onResize,
  onReset,
  ariaLabel,
}: {
  side: 'left' | 'right';
  currentWidth: number;
  min: number;
  max: number;
  onResize: (px: number) => void;
  onReset?: () => void;
  ariaLabel: string;
}) {
  const dragStartRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only react to primary button / single-finger touch.
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStartRef.current = {
        startX: e.clientX,
        startWidth: currentWidth,
      };
      setDragging(true);
    },
    [currentWidth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const delta = e.clientX - start.startX;
      const next =
        side === 'left' ? start.startWidth + delta : start.startWidth - delta;
      onResize(Math.round(Math.max(min, Math.min(max, next))));
    },
    [side, onResize, min, max],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released — ignore.
    }
  }, []);

  return (
    <Tooltip
      content="Drag to resize · double-click to reset"
      delay={600}
      wrapperClassName="block h-full w-full"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        aria-valuenow={currentWidth}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
        className={`group relative h-full w-full cursor-col-resize select-none transition-colors ${
          dragging ? 'bg-sky-500/80' : 'bg-neutral-800 hover:bg-sky-600/60'
        }`}
      />
    </Tooltip>
  );
}

/**
 * Thin vertical rail shown when a side pane is collapsed. The expand
 * button chevron points toward the center of the layout (right-arrow
 * on the left rail, left-arrow on the right rail).
 */
function CollapsedRail({
  side,
  label,
  onExpand,
}: {
  side: 'left' | 'right';
  label: string;
  onExpand?: () => void;
}) {
  const chevron = side === 'left' ? '»' : '«';
  return (
    <div className="flex h-full w-full flex-col items-center">
      <Tooltip content={`Expand ${label.toLowerCase()} panel`} placement="bottom">
        <button
          type="button"
          onClick={onExpand}
          className="mt-1 flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label={`Expand ${label.toLowerCase()} panel`}
        >
          {chevron}
        </button>
      </Tooltip>
      <div
        className="mt-3 select-none text-xs uppercase tracking-wider text-neutral-500"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
        }}
      >
        {label}
      </div>
    </div>
  );
}
