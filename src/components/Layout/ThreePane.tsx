import type { ReactNode } from 'react';

/**
 * Presentational three-pane layout: fixed-width left and right panes
 * flanking a flexible center pane. Designed to fill its parent
 * container — the parent should be sized (the `<Workbench>` shell uses
 * `h-screen`).
 *
 * Server-component safe: no hooks, no client code.
 */
export interface ThreePaneProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  className?: string;
}

export function ThreePane({
  left,
  center,
  right,
  className = '',
}: ThreePaneProps) {
  return (
    <div
      className={`grid h-full w-full overflow-hidden ${className}`}
      style={{
        gridTemplateColumns: '256px 1fr 320px',
      }}
    >
      <aside className="flex min-h-0 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
        {left}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-900">
        {center}
      </main>
      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950">
        {right}
      </aside>
    </div>
  );
}
