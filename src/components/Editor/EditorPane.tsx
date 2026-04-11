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
 * - We bind Cmd/Ctrl+S → saveActive() and Cmd/Ctrl+W → closeActive().
 *   Monaco intercepts these only when the editor is focused; outside
 *   the editor the browser gets them first (which is unavoidable for
 *   Cmd+W without an Electron shell). There's intentionally no save-
 *   all shortcut — saving unrelated buffers in a single keystroke is
 *   an anti-pattern that hides per-file failures.
 * - We use the `path` prop so Monaco maintains a separate model per
 *   open file — switching tabs preserves undo history per file.
 *
 * Footer status:
 * - "Modified" / "Saved" / "Saving…" / "Save failed: …"
 * - Active file path on the right
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  FileText,
  Loader2,
  type LucideProps,
} from 'lucide-react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

import {
  isDirty,
  useActiveFile,
  useWorkbench,
  useWorkspaceFilePaths,
} from '@/components/Workbench/WorkbenchContext';
import { useToast } from '@/components/ui/Toast';
import { useAiStatus } from '@/hooks/useAiStatus';
import { useAiValidation } from '@/hooks/useAiValidation';
import { useAiFormat } from '@/hooks/useAiFormat';
import {
  registerAiProviders,
  type RegisteredAiProviders,
} from '@/components/Editor/monacoAi';
import { AiStatusPill } from '@/components/Editor/AiStatusPill';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading editor…
      </div>
    ),
  },
);

export function EditorPane() {
  const { updateContent, saveActive, closeActive, registerEditor, savingPaths } =
    useWorkbench();
  const active = useActiveFile();
  const { toast } = useToast();

  // ---------- AI integration ----------
  const { status: aiStatus } = useAiStatus();
  const workspacePaths = useWorkspaceFilePaths();

  // Live editor + monaco namespace, captured in handleMount. State
  // (not refs) so the effects below re-run once they become available.
  const [editorInstance, setEditorInstance] =
    useState<editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] =
    useState<typeof import('monaco-editor') | null>(null);

  // Provider registration is keyed off the AI master enable + completion
  // feature toggle. Re-registering on every workspace-paths change would
  // tear down the in-flight provider; instead we keep one provider and
  // push the latest context into it via update().
  const providersRef = useRef<RegisteredAiProviders | null>(null);
  const completionEnabled =
    aiStatus.enabled && aiStatus.features.completion;

  useEffect(() => {
    if (!monacoInstance) return;
    if (!completionEnabled) {
      providersRef.current?.dispose();
      providersRef.current = null;
      return;
    }
    if (!providersRef.current) {
      providersRef.current = registerAiProviders(monacoInstance);
    }
    providersRef.current.update({
      activePath: active?.path ?? null,
      workspacePaths,
    });
  }, [completionEnabled, monacoInstance, active?.path, workspacePaths]);

  useEffect(() => {
    return () => {
      providersRef.current?.dispose();
      providersRef.current = null;
    };
  }, []);

  const validation = useAiValidation({
    enabled: aiStatus.enabled && aiStatus.features.validation,
    activePath: active?.path ?? null,
    content: active?.content ?? '',
    workspacePaths,
    editor: editorInstance,
    monaco: monacoInstance,
  });

  const { state: formatState, formatActive } = useAiFormat({
    enabled: aiStatus.enabled && aiStatus.features.format,
    editor: editorInstance,
  });

  // Drive the status bar from the shared set — a save triggered from
  // the AppHeader button should light up the footer too. The context
  // action is a no-op if the file is already in flight, so we don't
  // need to gate the handler itself.
  const activeSaving =
    active != null && savingPaths.has(active.path);

  const handleSaveActive = useCallback(async () => {
    try {
      await saveActive();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [saveActive, toast]);

  const handleFormatActive = useCallback(async () => {
    if (!active) return;
    if (!aiStatus.enabled || !aiStatus.features.format) {
      toast({
        kind: 'error',
        title: 'AI format unavailable',
        message: 'Enable AI format in Settings first.',
      });
      return;
    }
    const result = await formatActive(active.path, active.content);
    if (!result.ok) {
      toast({
        kind: 'error',
        title: 'Format failed',
        message: result.message,
      });
    } else {
      toast({ kind: 'success', message: 'Formatted with Claude' });
    }
  }, [active, aiStatus.enabled, aiStatus.features.format, formatActive, toast]);

  const handleMount = useCallback<OnMount>(
    (ed, monaco) => {
      registerEditor(ed);
      setEditorInstance(ed);
      setMonacoInstance(monaco);

      const { KeyMod, KeyCode } = monaco;

      // Cmd/Ctrl+S → save active
      ed.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
        void handleSaveActive();
      });
      // Cmd/Ctrl+W → close active tab
      ed.addCommand(KeyMod.CtrlCmd | KeyCode.KeyW, () => {
        closeActive();
      });
      // Cmd/Ctrl+Shift+F → AI format active
      ed.addCommand(
        KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
        () => {
          void handleFormatActive();
        },
      );
    },
    [registerEditor, handleSaveActive, closeActive, handleFormatActive],
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
      <StatusBar
        active={active}
        saving={activeSaving}
        aiPill={
          <AiStatusPill
            enabled={aiStatus.enabled}
            model={aiStatus.model}
            validation={validation}
            format={formatState}
          />
        }
      />
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
      <div className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading {basename(active.path)}…
      </div>
    );
  }

  if (active.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md items-start gap-3 rounded-md border border-red-900 bg-red-950/40 p-4 text-red-200">
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <div>
            <div className="font-medium">Failed to open file</div>
            <div className="mt-1 text-sm text-red-300">{active.error}</div>
          </div>
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

type StatusTone = 'idle' | 'dirty' | 'saving' | 'error' | 'saved';

function StatusBar({
  active,
  saving,
  aiPill,
}: {
  active: ReturnType<typeof useActiveFile>;
  saving: boolean;
  aiPill?: React.ReactNode;
}) {
  let status: { label: string; tone: StatusTone };
  if (!active) {
    status = { label: 'No file', tone: 'idle' };
  } else if (active.loading) {
    status = { label: 'Loading', tone: 'saving' };
  } else if (active.error) {
    status = { label: `Error: ${active.error}`, tone: 'error' };
  } else if (saving) {
    status = { label: 'Saving…', tone: 'saving' };
  } else if (isDirty(active)) {
    status = { label: 'Modified', tone: 'dirty' };
  } else {
    status = { label: 'Saved', tone: 'saved' };
  }

  const tone = STATUS_TONES[status.tone];
  const Icon = tone.Icon;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-1 text-xs">
      <span className={`flex items-center gap-1.5 ${tone.className}`}>
        {Icon && (
          <Icon
            className={`h-3 w-3 ${tone.animate ?? ''}`}
            aria-hidden="true"
          />
        )}
        <span>{status.label}</span>
      </span>
      <div className="flex min-w-0 items-center gap-2">
        {aiPill}
        <span className="truncate text-neutral-500">{active?.path ?? ''}</span>
      </div>
    </div>
  );
}

const STATUS_TONES: Record<
  StatusTone,
  {
    className: string;
    Icon?: ComponentType<LucideProps>;
    animate?: string;
  }
> = {
  idle: { className: 'text-neutral-400' },
  saved: { className: 'text-emerald-400', Icon: CheckCircle2 },
  dirty: { className: 'text-amber-300', Icon: CircleDot },
  saving: {
    className: 'text-sky-300',
    Icon: Loader2,
    animate: 'animate-spin',
  },
  error: { className: 'text-red-300', Icon: AlertCircle },
};

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
