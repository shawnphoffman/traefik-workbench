'use client';

/**
 * Centralized global keyboard shortcuts for the Workbench.
 *
 * Scope: anything that should work outside Monaco focus too (file tree,
 * sidebar, command palette, status bar). Editor-scoped shortcuts that
 * only matter while typing (e.g. AI format) stay registered on the
 * Monaco instance directly in EditorPane.
 *
 * Browser-collision strategy:
 * - `mod+s` / `mod+shift+s` / `mod+shift+w` / `mod+shift+k`: explicit
 *   `preventDefault` to override "Save Page As" / browser tab close.
 * - `mod+k` / `mod+p` / `mod+shift+p`: command palette. `mod+p`
 *   overrides browser print, matching every code editor.
 * - `mod+b` / `mod+alt+b`: toggle sidebars (overrides bookmarks bar).
 * - `mod+1..9`: tab jump. Browsers reserve these for tab switching but
 *   `preventDefault` reliably overrides them in the page.
 * - `mod+w` / `mod+t` / `mod+n` / `mod+r`: NOT bound. Browsers ignore
 *   `preventDefault` for these and we don't want to fight a losing
 *   battle. Closing the active tab uses `mod+shift+w` instead.
 *
 * Double-fire safety: when Monaco has focus its own `cmd+s` /
 * `cmd+shift+w` bindings fire AND the event bubbles to this hook. The
 * underlying actions (`savePath`, `requestCloseFile`) are idempotent
 * (`savingPathsRef` blocks a second concurrent save and `closeFile` is
 * a no-op on an already-closed path), so the double-fire is harmless
 * and not worth suppressing.
 */

import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import {
  isDirty,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import { useToast } from '@/components/ui/Toast';

export type PaletteMode = 'actions' | 'files';

export interface UseWorkbenchHotkeysOptions {
  paletteOpen: boolean;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  openShortcuts: () => void;
}

export function useWorkbenchHotkeys({
  paletteOpen,
  openPalette,
  closePalette,
  openShortcuts,
}: UseWorkbenchHotkeysOptions): void {
  const {
    openFiles,
    activePath,
    setActive,
    saveActive,
    savePath,
    closeActive,
    closeAllClean,
    toggleLeft,
    toggleRight,
  } = useWorkbench();
  const { toast } = useToast();

  // Tab navigation hotkeys are disabled while the palette is open so
  // arrow / cmd+N keystrokes inside the palette input don't double as
  // tab switches.
  const navEnabled = !paletteOpen;

  // ---------- Save ----------

  // mod+s: save active file. Works while typing in the palette input
  // too (enableOnFormTags) so the muscle-memory "edit then cmd+s"
  // sequence still saves even if the editor isn't focused.
  useHotkeys(
    'mod+s',
    async (event) => {
      event.preventDefault();
      try {
        await saveActive();
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Save failed',
          message: errorMessage(err),
        });
      }
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [saveActive, toast],
  );

  // mod+shift+s: save every dirty buffer. Reports a single toast at the
  // end with the per-file outcome rather than one toast per save.
  useHotkeys(
    'mod+shift+s',
    async (event) => {
      event.preventDefault();
      const dirty = openFiles.filter(isDirty);
      if (dirty.length === 0) return;
      const results = await Promise.allSettled(
        dirty.map((file) => savePath(file.path)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast({
          kind: 'error',
          title: 'Save failed',
          message: `${failed} of ${dirty.length} ${dirty.length === 1 ? 'file' : 'files'} failed to save.`,
        });
      } else {
        toast({
          kind: 'success',
          message: `Saved ${dirty.length} ${dirty.length === 1 ? 'file' : 'files'}.`,
        });
      }
    },
    { enableOnFormTags: true },
    [openFiles, savePath, toast],
  );

  // ---------- Close ----------

  useHotkeys(
    'mod+shift+w',
    (event) => {
      event.preventDefault();
      closeActive();
    },
    { enabled: navEnabled },
    [closeActive, navEnabled],
  );

  useHotkeys(
    'mod+shift+k',
    (event) => {
      event.preventDefault();
      closeAllClean();
    },
    { enabled: navEnabled },
    [closeAllClean, navEnabled],
  );

  // ---------- Palette ----------

  // mod+k toggles the palette so the same keystroke that opens it also
  // dismisses it. We allow it on form tags so it works while typing in
  // the palette's own input.
  useHotkeys(
    'mod+k',
    (event) => {
      event.preventDefault();
      if (paletteOpen) {
        closePalette();
      } else {
        openPalette('actions');
      }
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [paletteOpen, openPalette, closePalette],
  );

  useHotkeys(
    'mod+shift+p',
    (event) => {
      event.preventDefault();
      openPalette('actions');
    },
    { enableOnFormTags: true },
    [openPalette],
  );

  // mod+p: quick file open. Overrides browser "Print" (universal in
  // code editors).
  useHotkeys(
    'mod+p',
    (event) => {
      event.preventDefault();
      openPalette('files');
    },
    { enableOnFormTags: true },
    [openPalette],
  );

  // ---------- Help ----------

  // `?` opens the shortcuts cheatsheet. react-hotkeys-hook matches on
  // `event.code` (normalized to lowercase with `key|digit|numpad`
  // stripped), so the binding is `shift+slash` even though the
  // resulting character is `?`. Skipped while the palette is open or
  // the user is in a form/contenteditable so it doesn't fire while
  // typing a real `?` into an input.
  useHotkeys(
    'shift+slash',
    (event) => {
      event.preventDefault();
      openShortcuts();
    },
    { enabled: navEnabled },
    [openShortcuts, navEnabled],
  );

  // ---------- Sidebar ----------

  useHotkeys(
    'mod+b',
    (event) => {
      event.preventDefault();
      toggleLeft();
    },
    { enabled: navEnabled },
    [toggleLeft, navEnabled],
  );

  useHotkeys(
    'mod+alt+b',
    (event) => {
      event.preventDefault();
      toggleRight();
    },
    { enabled: navEnabled },
    [toggleRight, navEnabled],
  );

  // ---------- Tab navigation ----------

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (openFiles.length === 0) return;
      const currentIndex = activePath
        ? openFiles.findIndex((f) => f.path === activePath)
        : -1;
      const fromIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        (fromIndex + direction + openFiles.length) % openFiles.length;
      setActive(openFiles[nextIndex].path);
    },
    [openFiles, activePath, setActive],
  );

  useHotkeys(
    'alt+cmd+left, alt+ctrl+left',
    (event) => {
      event.preventDefault();
      cycleTab(-1);
    },
    { enabled: navEnabled },
    [cycleTab, navEnabled],
  );

  useHotkeys(
    'alt+cmd+right, alt+ctrl+right',
    (event) => {
      event.preventDefault();
      cycleTab(1);
    },
    { enabled: navEnabled },
    [cycleTab, navEnabled],
  );

  // mod+1..mod+8 jump to tab N; mod+9 jumps to the last tab (VS Code
  // convention, handy when you have many tabs open and want the
  // newest).
  useHotkeys(
    'mod+1, mod+2, mod+3, mod+4, mod+5, mod+6, mod+7, mod+8, mod+9',
    (event) => {
      event.preventDefault();
      const digit = Number.parseInt(event.key, 10);
      if (!Number.isFinite(digit) || digit < 1 || digit > 9) return;
      if (openFiles.length === 0) return;
      if (digit === 9) {
        setActive(openFiles[openFiles.length - 1].path);
        return;
      }
      const target = openFiles[digit - 1];
      if (target) setActive(target.path);
    },
    { enabled: navEnabled },
    [openFiles, setActive, navEnabled],
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
