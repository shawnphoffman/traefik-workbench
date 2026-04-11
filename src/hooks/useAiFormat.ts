'use client';

/**
 * Exposes a `formatActive()` action that hits `/api/ai/format` and
 * applies the result to the live Monaco model via
 * `executeEdits` so undo/redo and the dirty flag still work.
 *
 * The hook never triggers automatically. The plan explicitly mirrors
 * the "no save-all" decision (commit d959e8c): formatting is always
 * an explicit user action, bound to Cmd/Ctrl+Shift+F by the editor.
 *
 * If the route refuses the format (semantic drift, invalid output,
 * disabled, etc.) the hook returns the error so the caller can toast
 * it. The buffer is left untouched on any failure.
 */

import { useCallback, useState } from 'react';

import { aiFormat, ApiClientError } from '@/lib/api-client';

export type FormatState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string }
  | { kind: 'disabled' };

export interface UseAiFormatOptions {
  enabled: boolean;
  editor: import('monaco-editor').editor.IStandaloneCodeEditor | null;
}

export interface UseAiFormatResult {
  state: FormatState;
  formatActive: (
    activePath: string,
    content: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function useAiFormat({
  enabled,
  editor,
}: UseAiFormatOptions): UseAiFormatResult {
  const [state, setState] = useState<FormatState>({ kind: 'idle' });

  const formatActive = useCallback(
    async (activePath: string, content: string) => {
      if (!enabled) {
        const message = 'AI format is disabled';
        setState({ kind: 'disabled' });
        return { ok: false as const, message };
      }
      if (!editor) {
        const message = 'Editor not ready';
        setState({ kind: 'error', message });
        return { ok: false as const, message };
      }
      setState({ kind: 'pending' });
      try {
        const response = await aiFormat({ activePath, content });
        if (!response.enabled) {
          setState({ kind: 'disabled' });
          return { ok: false as const, message: 'AI format is disabled' };
        }
        const model = editor.getModel();
        if (!model) {
          setState({ kind: 'error', message: 'No active model' });
          return { ok: false as const, message: 'No active model' };
        }
        // Replace the entire buffer in a single edit so undo restores
        // the pre-format state in one step. We deliberately use
        // executeEdits (not setValue) to keep the dirty flag and undo
        // stack consistent with normal user edits.
        const fullRange = model.getFullModelRange();
        editor.executeEdits('claude-format', [
          {
            range: fullRange,
            text: response.formatted,
            forceMoveMarkers: true,
          },
        ]);
        setState({ kind: 'ok' });
        return { ok: true as const };
      } catch (err) {
        const message =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setState({ kind: 'error', message });
        return { ok: false as const, message };
      }
    },
    [enabled, editor],
  );

  return { state, formatActive };
}
