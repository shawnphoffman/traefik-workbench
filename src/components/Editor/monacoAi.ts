'use client';

/**
 * Registers Claude-backed Monaco providers.
 *
 * Currently the only registered provider is `CompletionItemProvider`
 * for YAML — diagnostics are pushed via `setModelMarkers` from
 * `useAiValidation` (which doesn't go through Monaco's
 * `DiagnosticsAdapter` interface) and format is invoked imperatively
 * from a Monaco command keybinding, not via `DocumentFormattingEdit
 * Provider` (we want to control the network call site explicitly).
 *
 * The completion provider is wired with a small set of trigger
 * characters and a manual-invocation entry point (Ctrl+Space). It
 * should NOT fire on every keystroke — that's both expensive and
 * jarring. Monaco's default behavior already debounces eager triggers,
 * but we additionally cap to one in-flight request per provider via
 * an AbortController stored in the closure.
 */

import type * as monacoNs from 'monaco-editor';

import { aiComplete, ApiClientError } from '@/lib/api-client';
import type { CompleteRequest } from '@/lib/ai/types';

/**
 * Snapshot of context the providers need to call /api/ai/*. The
 * caller updates this via the returned `update()` function whenever
 * the active path or workspace path list changes — re-registering
 * providers on every change would be wasteful and would lose any
 * in-progress request.
 */
export interface AiProviderContext {
  activePath: string | null;
  workspacePaths: string[];
}

export interface RegisteredAiProviders {
  update: (next: AiProviderContext) => void;
  dispose: () => void;
}

export function registerAiProviders(
  monaco: typeof monacoNs,
): RegisteredAiProviders {
  const ctx: AiProviderContext = {
    activePath: null,
    workspacePaths: [],
  };

  let inFlight: AbortController | null = null;

  const completion = monaco.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: [':', '-', ' '],
    async provideCompletionItems(model, position) {
      if (ctx.activePath == null) {
        return { suggestions: [] };
      }

      // Cancel any prior in-flight request — only the most recent
      // cursor position matters.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;

      const beforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const lastLine = model.getLineCount();
      const afterCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: lastLine,
        endColumn: model.getLineMaxColumn(lastLine),
      });

      const body: CompleteRequest = {
        activePath: ctx.activePath,
        beforeCursor,
        afterCursor,
        workspacePaths: ctx.workspacePaths,
      };

      try {
        const response = await aiComplete(body, controller.signal);
        if (controller.signal.aborted) return { suggestions: [] };
        if (!response.enabled) return { suggestions: [] };

        const word = model.getWordUntilPosition(position);
        const range: monacoNs.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };

        return {
          suggestions: response.items.map((item) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: item.insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: item.detail,
            documentation: item.documentation,
            range,
          })),
        };
      } catch (err) {
        if (controller.signal.aborted) return { suggestions: [] };
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { suggestions: [] };
        }
        if (err instanceof ApiClientError) {
          // Swallow network/AI errors here — the status pill surfaces
          // the failure. Returning an empty suggestion list keeps the
          // editor's built-in YAML completion working.
          console.warn('[ai/complete] failed', err.message);
          return { suggestions: [] };
        }
        console.warn('[ai/complete] failed', err);
        return { suggestions: [] };
      }
    },
  });

  return {
    update(next) {
      ctx.activePath = next.activePath;
      ctx.workspacePaths = next.workspacePaths;
    },
    dispose() {
      inFlight?.abort();
      inFlight = null;
      completion.dispose();
    },
  };
}
