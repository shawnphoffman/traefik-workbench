'use client';

/**
 * Drives Claude-backed validation diagnostics into Monaco markers.
 *
 * Trigger model: piggy-back on the existing edit cycle. Whenever the
 * `content` changes, schedule a longer (1500 ms) idle timer; if no
 * further edits arrive, fire `/api/ai/validate` and push the result
 * into the Monaco model via `setModelMarkers(model, 'claude', ...)`.
 * Any newer edit cancels the in-flight request through an
 * AbortController so we never apply stale diagnostics.
 *
 * The hook fails closed: any error path clears the `claude` markers
 * (so an error can't leave stale red squigglies behind) and surfaces
 * the error string to the caller, which the AI status pill renders
 * as a red tooltip.
 */

import { useEffect, useRef, useState } from 'react';

import { aiValidate, ApiClientError } from '@/lib/api-client';
import type { Diagnostic } from '@/lib/ai/types';

const IDLE_DEBOUNCE_MS = 1500;
const MARKER_OWNER = 'claude';

export type ValidationState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; count: number }
  | { kind: 'error'; message: string }
  | { kind: 'disabled' };

export interface UseAiValidationOptions {
  /** Master enable; the hook is a no-op when false. */
  enabled: boolean;
  activePath: string | null;
  content: string;
  workspacePaths: string[];
  /**
   * Resolved Monaco editor instance + monaco namespace. Both are
   * needed because we use `monaco.editor.setModelMarkers` and
   * `MarkerSeverity` from the namespace, plus the editor instance
   * to find the live model for the active path.
   */
  editor: import('monaco-editor').editor.IStandaloneCodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
}

// Internal state — does NOT include the derived `disabled` case.
// Whether the hook is disabled is computed during render so we never
// need to call setState synchronously inside the effect for the
// disabled branch. The active branch only setState's from inside the
// timer / async callbacks, which the lint is fine with.
type InternalState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; count: number }
  | { kind: 'error'; message: string };

export function useAiValidation({
  enabled,
  activePath,
  content,
  workspacePaths,
  editor,
  monaco,
}: UseAiValidationOptions): ValidationState {
  const [state, setState] = useState<InternalState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const inactive =
    !enabled || !editor || !monaco || activePath == null;

  // Side effect: clear any stale `claude` markers whenever the hook
  // becomes inactive (master switch off, file closed, editor unmounted).
  // Treated as a separate effect from the validation timer below so the
  // disabled-cleanup doesn't get tangled up with the request lifecycle.
  useEffect(() => {
    if (!inactive) return;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    }
  }, [inactive, editor, monaco]);

  useEffect(() => {
    if (inactive) return;
    // Narrow the optional refs for the closures below — `inactive`
    // already guarantees these are non-null.
    const ed = editor!;
    const mc = monaco!;
    const path = activePath!;

    const handle = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setState({ kind: 'pending' });

      void aiValidate(
        { activePath: path, content, workspacePaths },
        controller.signal,
      )
        .then((response) => {
          if (controller.signal.aborted) return;
          if (!response.enabled) {
            // The route says AI is off; surface as idle. The outer
            // `inactive` flag will catch the next render anyway.
            setState({ kind: 'idle' });
            return;
          }
          const model = ed.getModel();
          if (!model) return;
          mc.editor.setModelMarkers(
            model,
            MARKER_OWNER,
            response.diagnostics.map((d) => toMarker(mc, d)),
          );
          setState({ kind: 'ok', count: response.diagnostics.length });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          // AbortError is expected when a newer edit lands; ignore.
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Clear stale markers so the gutter doesn't lie.
          const model = ed.getModel();
          if (model) {
            mc.editor.setModelMarkers(model, MARKER_OWNER, []);
          }
          const message =
            err instanceof ApiClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          setState({ kind: 'error', message });
        });
    }, IDLE_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [inactive, activePath, content, workspacePaths, editor, monaco]);

  // Abort any in-flight request on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (inactive) {
    return enabled ? { kind: 'idle' } : { kind: 'disabled' };
  }
  return state;
}

function toMarker(
  monaco: typeof import('monaco-editor'),
  d: Diagnostic,
): import('monaco-editor').editor.IMarkerData {
  return {
    severity: severityToMonaco(monaco, d.severity),
    message: d.message,
    source: d.source,
    startLineNumber: d.line,
    startColumn: d.column,
    endLineNumber: d.endLine ?? d.line,
    endColumn: d.endColumn ?? d.column + 1,
  };
}

function severityToMonaco(
  monaco: typeof import('monaco-editor'),
  severity: Diagnostic['severity'],
): import('monaco-editor').MarkerSeverity {
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
      return monaco.MarkerSeverity.Info;
    case 'hint':
      return monaco.MarkerSeverity.Hint;
  }
}
