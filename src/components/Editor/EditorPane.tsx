'use client';

/**
 * Monaco editor for the active file, plus a small status footer.
 *
 * Loaded via `next/dynamic` with `ssr: false` because Monaco depends on
 * `window`. The loader displays a lightweight fallback until the
 * editor is mounted.
 *
 * Editor bridge:
 * - On mount, we register the editor instance with the Workbench
 *   context so the YAML tree panel can scroll to clicked nodes.
 * - We bind Cmd/Ctrl+S → saveActive(), Cmd/Ctrl+Shift+S → saveAll(),
 *   and Cmd/Ctrl+W → closeActive(). Monaco intercepts these only when
 *   the editor is focused; outside the editor the browser gets them
 *   first (which is unavoidable for Cmd+W without an Electron shell).
 * - We use the `path` prop so Monaco maintains a separate model per
 *   open file — switching tabs preserves undo history per file.
 *
 * Footer status:
 * - "Modified" / "Saved" / "Saving…" / "Save failed: …"
 * - Active file path on the right
 */

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { FileText } from 'lucide-react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

import {
  isDirty,
  useActiveFile,
  useWorkbench,
} from '@/components/Workbench/WorkbenchContext';
import { useToast } from '@/components/ui/Toast';

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
  const { updateContent, saveActive, saveAll, closeActive, registerEditor } =
    useWorkbench();
  const active = useActiveFile();
  const { toast } = useToast();

  const [saving, setSaving] = useState<boolean>(false);

  const handleSaveActive = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveActive();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }, [saveActive, saving, toast]);

  const handleSaveAll = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { saved, failed } = await saveAll();
      if (failed > 0) {
        toast({
          kind: 'error',
          title: 'Save all: some files failed',
          message: `${saved} saved, ${failed} failed`,
        });
      } else if (saved > 0) {
        toast({
          kind: 'success',
          message: `Saved ${saved} file${saved === 1 ? '' : 's'}`,
        });
      }
    } finally {
      setSaving(false);
    }
  }, [saveAll, saving, toast]);

  const handleMount = useCallback<OnMount>(
    (editorInstance, monacoInstance) => {
      registerEditor(editorInstance);
      const { KeyMod, KeyCode } = monacoInstance;

      // Cmd/Ctrl+S → save active
      editorInstance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
        void handleSaveActive();
      });
      // Cmd/Ctrl+Shift+S → save all
      editorInstance.addCommand(
        KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS,
        () => {
          void handleSaveAll();
        },
      );
      // Cmd/Ctrl+W → close active tab
      editorInstance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyW, () => {
        closeActive();
      });
    },
    [registerEditor, handleSaveActive, handleSaveAll, closeActive],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!active) return;
      updateContent(active.path, value ?? '');
    },
    [active, updateContent],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <EditorBody
          active={active}
          onMount={handleMount}
          onChange={handleChange}
        />
      </div>
      <StatusBar active={active} saving={saving} />
    </div>
  );
}

function EditorBody({
  active,
  onMount,
  onChange,
}: {
  active: ReturnType<typeof useActiveFile>;
  onMount: OnMount;
  onChange: (value: string | undefined) => void;
}) {
  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <div className="flex flex-col items-center gap-3 text-center text-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-500">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>Open a file from the left to start editing.</div>
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
      onMount={onMount}
      onChange={onChange}
      options={MONACO_OPTIONS}
    />
  );
}

function StatusBar({
  active,
  saving,
}: {
  active: ReturnType<typeof useActiveFile>;
  saving: boolean;
}) {
  let status: {
    label: string;
    tone: 'idle' | 'dirty' | 'saving' | 'error';
  };
  if (!active) {
    status = { label: 'No file', tone: 'idle' };
  } else if (active.loading) {
    status = { label: 'Loading…', tone: 'idle' };
  } else if (active.error) {
    status = { label: `Error: ${active.error}`, tone: 'error' };
  } else if (saving) {
    status = { label: 'Saving…', tone: 'saving' };
  } else if (isDirty(active)) {
    status = { label: 'Modified', tone: 'dirty' };
  } else {
    status = { label: 'Saved', tone: 'idle' };
  }

  const toneClass = {
    idle: 'text-neutral-400',
    dirty: 'text-amber-300',
    saving: 'text-sky-300',
    error: 'text-red-300',
  }[status.tone];

  return (
    <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-950 px-3 py-1 text-xs">
      <span className={toneClass}>{status.label}</span>
      <span className="truncate text-neutral-500">{active?.path ?? ''}</span>
    </div>
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
