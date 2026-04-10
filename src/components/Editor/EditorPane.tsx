'use client';

/**
 * Monaco editor for the active file.
 *
 * Loaded via `next/dynamic` with `ssr: false` because Monaco depends on
 * `window`. The loader displays a lightweight fallback until the
 * editor is mounted.
 *
 * Editor bridge:
 * - On mount, we register the editor instance with the Workbench
 *   context so the YAML tree panel can scroll to clicked nodes.
 * - We bind Cmd/Ctrl+S to `saveActive()`.
 * - We use the `path` prop so Monaco maintains a separate model per
 *   open file — switching tabs preserves undo history per file.
 */

import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

import {
  useActiveFile,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading editor…
      </div>
    ),
  },
);

export function EditorPane() {
  const { updateContent, saveActive, registerEditor } = useWorkbench();
  const active = useActiveFile();

  const handleMount = useCallback<OnMount>(
    (editorInstance, monacoInstance) => {
      registerEditor(editorInstance);

      // Cmd/Ctrl+S → save active file. Using addCommand with the
      // KeyMod/KeyCode constants is the officially supported way per
      // Monaco docs.
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => {
          void saveActive();
        },
      );
    },
    [registerEditor, saveActive],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!active) return;
      updateContent(active.path, value ?? '');
    },
    [active, updateContent],
  );

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <div className="text-center">
          <div className="text-sm">Open a file from the left to start editing.</div>
        </div>
      </div>
    );
  }

  if (active.loading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading {basename(active.path)}…
      </div>
    );
  }

  if (active.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded border border-red-900 bg-red-950/40 p-4 text-red-200">
          <div className="font-medium">Failed to open file</div>
          <div className="mt-1 text-sm text-red-300">{active.error}</div>
        </div>
      </div>
    );
  }

  return (
    <MonacoEditor
      // `path` keys the model, so tab switches preserve undo stacks.
      path={active.path}
      value={active.content}
      defaultLanguage="yaml"
      language="yaml"
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      options={MONACO_OPTIONS}
    />
  );
}

const MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
};

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
