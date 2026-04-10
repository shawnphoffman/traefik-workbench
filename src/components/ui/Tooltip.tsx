'use client';

/**
 * Lightweight tooltip primitive.
 *
 * Wraps a single child (typically a button or icon) in a span that
 * tracks mouse / focus events and renders a floating label below — or
 * above — the anchor via a portal. No dependencies.
 *
 * Design choices:
 * - Portal-rendered so clipped containers (overflow: hidden) don't eat
 *   the tooltip.
 * - Positioned imperatively in a useLayoutEffect: the effect measures
 *   both the anchor and the tooltip, computes the final coordinates,
 *   and writes them directly to the tooltip's inline style via a ref.
 *   This avoids calling setState from inside the effect (the React 19
 *   `set-state-in-effect` rule flags that pattern) and is how
 *   floating-ui / popper do it.
 * - 400 ms hover delay to avoid noisy flashes on casual mouseovers;
 *   focus shows immediately for keyboard users.
 * - Auto-flips from "bottom" to "top" placement if there isn't enough
 *   room below the anchor.
 * - `pointer-events: none` on the tooltip so it can't become a hover
 *   target itself and cause flicker.
 * - `aria-describedby` wiring so screen readers announce the tooltip.
 * - Hides on Escape so a "stuck" tooltip can always be dismissed.
 */

import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface TooltipProps {
  content: ReactNode;
  /** Hover delay in ms. Default 400. */
  delay?: number;
  /** Preferred placement. Default "bottom". Auto-flips if not enough room. */
  placement?: 'top' | 'bottom';
  /**
   * ClassName applied to the wrapper span that carries the event
   * handlers. Defaults to `inline-flex` so the wrapper collapses
   * around its child. Pass a block/full-size class if you need the
   * wrapper to fill a grid cell.
   */
  wrapperClassName?: string;
  /** The element to anchor to. */
  children: ReactNode;
}

const SAFE_MARGIN = 6;
const VIEWPORT_PADDING = 8;

export function Tooltip({
  content,
  delay = 400,
  placement = 'bottom',
  wrapperClassName = 'inline-flex',
  children,
}: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);

  // No SSR guard needed: `open` is `false` on the initial (server)
  // render, so the `open && createPortal(..., document.body)` short-
  // circuit below never dereferences `document` on the server.

  const clearDelay = useCallback(() => {
    if (delayTimer.current) {
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      clearDelay();
      if (immediate) {
        setOpen(true);
        return;
      }
      delayTimer.current = setTimeout(() => setOpen(true), delay);
    },
    [clearDelay, delay],
  );

  const hide = useCallback(() => {
    clearDelay();
    setOpen(false);
  }, [clearDelay]);

  // Clean up any pending timer on unmount.
  useEffect(() => clearDelay, [clearDelay]);

  // Position imperatively via the ref. We run in useLayoutEffect so
  // the measurement happens synchronously after layout, before the
  // browser paints — this guarantees the tooltip is positioned
  // correctly on the very first visible frame.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Auto-flip if the preferred placement doesn't fit.
    let finalPlacement: 'top' | 'bottom' = placement;
    if (placement === 'bottom') {
      const wouldOverflow =
        anchorRect.bottom + SAFE_MARGIN + tipRect.height >
        viewportH - VIEWPORT_PADDING;
      if (wouldOverflow && anchorRect.top - SAFE_MARGIN - tipRect.height > 0) {
        finalPlacement = 'top';
      }
    } else {
      const wouldOverflow =
        anchorRect.top - SAFE_MARGIN - tipRect.height < VIEWPORT_PADDING;
      if (
        wouldOverflow &&
        anchorRect.bottom + SAFE_MARGIN + tipRect.height <
          viewportH - VIEWPORT_PADDING
      ) {
        finalPlacement = 'bottom';
      }
    }

    const centerX = anchorRect.left + anchorRect.width / 2;
    let left = centerX - tipRect.width / 2;
    // Clamp horizontally within the viewport.
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (left + tipRect.width > viewportW - VIEWPORT_PADDING) {
      left = viewportW - VIEWPORT_PADDING - tipRect.width;
    }

    const top =
      finalPlacement === 'bottom'
        ? anchorRect.bottom + SAFE_MARGIN
        : anchorRect.top - SAFE_MARGIN - tipRect.height;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.opacity = '1';
  }, [open, placement, content]);

  // Hide on Escape — prevents a "stuck" tooltip if focus gets trapped.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, hide]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
        className={wrapperClassName}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            // Initial state: off-screen + invisible. The layout effect
            // overwrites left/top/opacity synchronously before paint.
            style={{
              position: 'fixed',
              left: '-9999px',
              top: '-9999px',
              opacity: 0,
            }}
            className="pointer-events-none z-50 max-w-xs rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 shadow-lg"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
