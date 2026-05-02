'use client';

/**
 * Cheatsheet of every global workbench keyboard shortcut.
 *
 * The catalog below is the canonical display list. The actual key
 * bindings live in `src/hooks/useWorkbenchHotkeys.ts` (and Monaco's
 * editor commands in `EditorPane.tsx`). When you add or change a
 * binding in either place, update this catalog so the cheatsheet stays
 * accurate. The chord strings here are mac-symbol rendered; on
 * non-macOS we substitute "Ctrl" for ⌘ and "Alt" for ⌥ at render time.
 */

import { useState } from 'react';
import { Keyboard } from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogCancelButton,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/Dialog';

interface Shortcut {
  /** Mac-style chord, rendered with substitution on other platforms. */
  chord: string;
  label: string;
}

interface ShortcutGroup {
  heading: string;
  items: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    heading: 'File',
    items: [
      { chord: '⌘S', label: 'Save active file' },
      { chord: '⌘⇧S', label: 'Save all dirty files' },
      { chord: '⌘P', label: 'Quick open file…' },
    ],
  },
  {
    heading: 'Tabs',
    items: [
      { chord: '⌘⇧W', label: 'Close active tab' },
      { chord: '⌘⇧K', label: 'Close all unmodified tabs' },
      { chord: '⌘1 … ⌘8', label: 'Jump to tab N' },
      { chord: '⌘9', label: 'Jump to last tab' },
      { chord: '⌥⌘←  /  ⌥⌘→', label: 'Cycle prev / next tab' },
    ],
  },
  {
    heading: 'View',
    items: [
      { chord: '⌘B', label: 'Toggle file tree' },
      { chord: '⌘⌥B', label: 'Toggle structure pane' },
    ],
  },
  {
    heading: 'Command palette',
    items: [
      { chord: '⌘K', label: 'Open command palette' },
      { chord: '⌘⇧P', label: 'Open command palette' },
      { chord: '?', label: 'Show this cheatsheet' },
    ],
  },
  {
    heading: 'Editor (Monaco focus only)',
    items: [
      { chord: '⌘⇧F', label: 'AI format active file' },
    ],
  },
];

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  // Detect platform once (after mount so SSR hydration matches). On
  // non-mac we swap the symbol set.
  const isMac = useIsMac();

  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-2xl">
      <DialogHeader
        title="Keyboard shortcuts"
        subtitle="Global shortcuts work anywhere in the workbench. Editor shortcuts only fire while the code editor has focus."
        icon={
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 text-sky-300">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
          </span>
        }
      />
      <DialogBody>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.heading}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                {group.heading}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((s) => (
                  <li
                    key={s.chord}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-neutral-200">{s.label}</span>
                    <Chord chord={s.chord} isMac={isMac} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogCancelButton onClick={onClose}>Close</DialogCancelButton>
      </DialogFooter>
    </Dialog>
  );
}

function Chord({ chord, isMac }: { chord: string; isMac: boolean }) {
  const display = isMac
    ? chord
    : chord
        .replaceAll('⌘', 'Ctrl+')
        .replaceAll('⌥', 'Alt+')
        .replaceAll('⇧', 'Shift+')
        // Collapse "Ctrl+Shift+S" style after substitution.
        .replaceAll('Ctrl+Shift+', 'Ctrl+Shift+')
        .replaceAll(/Ctrl\+(?=Ctrl)/g, '');
  return (
    <kbd className="shrink-0 whitespace-nowrap rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-300">
      {display}
    </kbd>
  );
}

function useIsMac(): boolean {
  // The whole workbench tree is a client component, so the lazy
  // initializer always runs in the browser. No effect / hydration
  // dance required.
  const [isMac] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  });
  return isMac;
}
