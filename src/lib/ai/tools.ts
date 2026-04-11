/**
 * JSON-Schema definitions for the forced tool calls used by every AI
 * route. The model has exactly one tool per route and no other escape
 * hatch — `tool_choice: { type: 'tool', name: ... }` plus
 * `additionalProperties: false` everywhere.
 *
 * These same schemas are also used to re-validate the model's output
 * server-side before the response leaves the route. Belt-and-braces:
 * the SDK already enforces the schema, but a stale SDK or a model
 * regression should never reach the editor.
 */

import type { Diagnostic, CompletionItem, DiagnosticSeverity } from './types';

// ---------- emit_completions ----------

export const EMIT_COMPLETIONS_TOOL = {
  name: 'emit_completions' as const,
  description: 'Emit YAML completion suggestions for the cursor position.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      items: {
        type: 'array' as const,
        maxItems: 8,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            label: { type: 'string' as const, minLength: 1, maxLength: 80 },
            insertText: { type: 'string' as const, minLength: 1, maxLength: 2000 },
            detail: { type: 'string' as const, maxLength: 200 },
            documentation: { type: 'string' as const, maxLength: 800 },
          },
          required: ['label', 'insertText'],
        },
      },
    },
    required: ['items'],
  },
};

// ---------- emit_diagnostics ----------

const SEVERITIES: DiagnosticSeverity[] = ['error', 'warning', 'info', 'hint'];

export const EMIT_DIAGNOSTICS_TOOL = {
  name: 'emit_diagnostics' as const,
  description:
    'Emit Traefik-specific diagnostics for the active YAML file.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      diagnostics: {
        type: 'array' as const,
        maxItems: 20,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            line: { type: 'integer' as const, minimum: 1 },
            column: { type: 'integer' as const, minimum: 1 },
            endLine: { type: 'integer' as const, minimum: 1 },
            endColumn: { type: 'integer' as const, minimum: 1 },
            severity: { type: 'string' as const, enum: SEVERITIES },
            message: { type: 'string' as const, minLength: 1, maxLength: 500 },
          },
          required: ['line', 'column', 'severity', 'message'],
        },
      },
    },
    required: ['diagnostics'],
  },
};

// ---------- emit_formatted ----------

export const EMIT_FORMATTED_TOOL = {
  name: 'emit_formatted' as const,
  description: 'Emit a reformatted version of the YAML file.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      formatted: { type: 'string' as const, minLength: 0, maxLength: 500_000 },
    },
    required: ['formatted'],
  },
};

// ---------- runtime validators (mirror the schemas) ----------
//
// We re-check the SDK output against these because the schema above is
// only an *input* contract for the model. A buggy or stale SDK could
// theoretically pass through malformed JSON, and we don't want that to
// reach the editor.

export function validateCompletionItems(input: unknown): CompletionItem[] {
  if (!isObj(input)) throw new Error('completion: not an object');
  if (!Array.isArray(input.items)) throw new Error('completion: items not an array');
  const out: CompletionItem[] = [];
  for (const raw of input.items) {
    if (!isObj(raw)) continue;
    if (typeof raw.label !== 'string' || raw.label.length === 0) continue;
    if (typeof raw.insertText !== 'string' || raw.insertText.length === 0) continue;
    const item: CompletionItem = {
      label: raw.label.slice(0, 80),
      insertText: raw.insertText.slice(0, 2000),
    };
    if (typeof raw.detail === 'string') item.detail = raw.detail.slice(0, 200);
    if (typeof raw.documentation === 'string') {
      item.documentation = raw.documentation.slice(0, 800);
    }
    out.push(item);
    if (out.length >= 8) break;
  }
  return out;
}

export function validateDiagnostics(input: unknown): Diagnostic[] {
  if (!isObj(input)) throw new Error('diagnostics: not an object');
  if (!Array.isArray(input.diagnostics)) {
    throw new Error('diagnostics: diagnostics not an array');
  }
  const out: Diagnostic[] = [];
  for (const raw of input.diagnostics) {
    if (!isObj(raw)) continue;
    if (typeof raw.line !== 'number' || raw.line < 1) continue;
    if (typeof raw.column !== 'number' || raw.column < 1) continue;
    if (typeof raw.severity !== 'string') continue;
    if (!SEVERITIES.includes(raw.severity as DiagnosticSeverity)) continue;
    if (typeof raw.message !== 'string' || raw.message.length === 0) continue;
    const d: Diagnostic = {
      line: Math.floor(raw.line),
      column: Math.floor(raw.column),
      severity: raw.severity as DiagnosticSeverity,
      message: raw.message.slice(0, 500),
      source: 'claude',
    };
    if (typeof raw.endLine === 'number' && raw.endLine >= 1) {
      d.endLine = Math.floor(raw.endLine);
    }
    if (typeof raw.endColumn === 'number' && raw.endColumn >= 1) {
      d.endColumn = Math.floor(raw.endColumn);
    }
    out.push(d);
    if (out.length >= 20) break;
  }
  return out;
}

export function validateFormatted(input: unknown): string {
  if (!isObj(input)) throw new Error('format: not an object');
  if (typeof input.formatted !== 'string') {
    throw new Error('format: formatted not a string');
  }
  return input.formatted;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
