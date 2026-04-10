'use client';

/**
 * Track an element's content box size with `ResizeObserver`, returning
 * the latest `{ width, height }` in CSS pixels.
 *
 * Used by the file-tree pane because `react-arborist` requires numeric
 * width/height props — it does not auto-fill its parent container.
 *
 * Returns a ref (attach to the element you want to measure) and the
 * current size. The size is `null` on the first render, before the
 * observer has fired.
 */

import { useEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useResizeObserver<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  size: Size | null;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Seed with the current size synchronously so the first paint has
    // reasonable numbers instead of waiting for the observer to fire.
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
