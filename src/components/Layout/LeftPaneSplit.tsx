'use client';

/**
 * Vertical split inside the left pane: stacks two children with a
 * draggable horizontal gutter between them. Mirrors the look and
 * keyboard semantics of `ThreePane`'s `ResizeGutter` so the workbench
 * feels uniform — drag to resize, double-click to reset.
 *
 * The split is expressed as a *fraction* (0..1) of the available height
 * assigned to the top child. Using a fraction (rather than an absolute
 * pixel offset) keeps both panes visible when the workbench window
 * resizes — collapsing the bottom child to zero on a short viewport
 * would be a nasty surprise.
 *
 * The container is measured with `ResizeObserver` so the pointer-drag
 * math knows the live container height; this is also what lets the
 * component apply min/max clamps in the same units the user sees.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Tooltip } from '@/components/ui/Tooltip';

const GUTTER_HEIGHT_PX = 5;
/**
 * Pixel cushion guaranteed to stay visible at the top and bottom of
 * the split, even on absurdly short viewports. Without this the user
 * could drag the gutter all the way to one edge and lose the headers.
 */
const MIN_PANE_PX = 64;

export interface LeftPaneSplitProps {
  top: ReactNode;
  bottom: ReactNode;
  /** Fraction (0..1) of the height assigned to the top pane. */
  fraction: number;
  /** Smallest fraction the top pane is allowed to shrink to. */
  minFraction: number;
  /** Largest fraction the top pane is allowed to grow to. */
  maxFraction: number;
  onResize: (fraction: number) => void;
  onReset?: () => void;
  ariaLabel?: string;
}

export function LeftPaneSplit({
  top,
  bottom,
  fraction,
  minFraction,
  maxFraction,
  onResize,
  onReset,
  ariaLabel = 'Resize templates panel',
}: LeftPaneSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState<number>(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // Seed synchronously so the first render has a real number.
    const rect = element.getBoundingClientRect();
    if (rect.height > 0) setContainerHeight(rect.height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Effective fraction: clamped against the static bounds AND a
  // pixel-aware floor/ceiling so the headers always stay on screen.
  const effectiveFraction = clampFraction(
    fraction,
    minFraction,
    maxFraction,
    containerHeight,
  );

  const topPx =
    containerHeight > 0
      ? Math.round(
          (containerHeight - GUTTER_HEIGHT_PX) * effectiveFraction,
        )
      : 0;

  const dragStartRef = useRef<{
    startY: number;
    startTopPx: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStartRef.current = {
        startY: e.clientY,
        startTopPx: topPx,
      };
      setDragging(true);
    },
    [topPx],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      if (containerHeight <= 0) return;
      const delta = e.clientY - start.startY;
      const nextTopPx = start.startTopPx + delta;
      const usable = containerHeight - GUTTER_HEIGHT_PX;
      if (usable <= 0) return;
      const nextFraction = nextTopPx / usable;
      onResize(
        clampFraction(nextFraction, minFraction, maxFraction, containerHeight),
      );
    },
    [containerHeight, minFraction, maxFraction, onResize],
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
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div
        className="min-h-0 overflow-hidden"
        style={
          containerHeight > 0
            ? { height: `${topPx}px`, flex: 'none' }
            : { flex: '2 1 0%' }
        }
      >
        {top}
      </div>
      <Tooltip
        content="Drag to resize · double-click to reset"
        delay={600}
        wrapperClassName="block w-full"
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={ariaLabel}
          aria-valuenow={Math.round(effectiveFraction * 100)}
          aria-valuemin={Math.round(minFraction * 100)}
          aria-valuemax={Math.round(maxFraction * 100)}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onReset}
          style={{ height: `${GUTTER_HEIGHT_PX}px` }}
          className={`group relative w-full shrink-0 cursor-row-resize select-none transition-colors ${
            dragging ? 'bg-sky-500/80' : 'bg-neutral-800 hover:bg-sky-600/60'
          }`}
        />
      </Tooltip>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={containerHeight > 0 ? undefined : { flex: '1 1 0%' }}
      >
        {bottom}
      </div>
    </div>
  );
}

function clampFraction(
  value: number,
  min: number,
  max: number,
  containerHeight: number,
): number {
  let next = value;
  if (Number.isNaN(next)) next = (min + max) / 2;
  if (next < min) next = min;
  if (next > max) next = max;
  // Pixel-aware clamp: keep at least MIN_PANE_PX visible at each end
  // when the container is tall enough. On very short containers we
  // fall back to the fractional clamp above.
  if (containerHeight > MIN_PANE_PX * 2 + GUTTER_HEIGHT_PX) {
    const usable = containerHeight - GUTTER_HEIGHT_PX;
    const minPx = MIN_PANE_PX;
    const maxPx = usable - MIN_PANE_PX;
    const nextPx = next * usable;
    if (nextPx < minPx) next = minPx / usable;
    if (nextPx > maxPx) next = maxPx / usable;
  }
  return next;
}
