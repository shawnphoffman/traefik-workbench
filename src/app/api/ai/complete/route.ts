/**
 * POST /api/ai/complete — Claude-backed YAML completion suggestions.
 *
 * Request shape: see `CompleteRequest` in `lib/ai/types.ts`.
 *
 * The route is locked down four ways:
 *  1. Forced single-tool `tool_choice` (see `invokeTool`)
 *  2. Locked system prompt parameterized only by config type
 *  3. Server-side schema re-validation of the tool output
 *  4. Per-item indentation invariant: items whose insertText would
 *     break the surrounding YAML block scope are dropped.
 *
 * Returns `{ enabled: false }` (200) if AI is off — the client treats
 * this as "skip silently".
 */

import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { getAi, AiDisabledError, AiNoKeyError } from '@/lib/ai/client';
import { recordActivity } from '@/lib/ai/activity';
import { buildWorkspaceContext } from '@/lib/ai/context';
import { completionSystemPrompt } from '@/lib/ai/prompts';
import { EMIT_COMPLETIONS_TOOL, validateCompletionItems } from '@/lib/ai/tools';
import { invokeTool, AiTimeoutError } from '@/lib/ai/invoke';
import type {
  CompleteRequest,
  CompleteResponse,
  CompleteDisabledResponse,
  CompletionItem,
} from '@/lib/ai/types';

const MAX_PAYLOAD_BYTES = 200 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  const start = Date.now();

  // Parse and validate the request body.
  let body: CompleteRequest;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonError(413, 'Request payload too large');
    }
    body = JSON.parse(raw) as CompleteRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  if (
    typeof body.activePath !== 'string' ||
    typeof body.beforeCursor !== 'string' ||
    typeof body.afterCursor !== 'string' ||
    !Array.isArray(body.workspacePaths)
  ) {
    return jsonError(400, 'Invalid request shape');
  }

  let resolved;
  try {
    resolved = await getAi();
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiNoKeyError) {
      const disabled: CompleteDisabledResponse = { enabled: false };
      return Response.json(disabled);
    }
    throw err;
  }

  if (!resolved.features.completion) {
    const disabled: CompleteDisabledResponse = { enabled: false };
    return Response.json(disabled);
  }

  // Whole-doc content for context-builder is the cursor halves joined.
  const fullContent = body.beforeCursor + body.afterCursor;

  try {
    const ctx = await buildWorkspaceContext({
      activePath: body.activePath,
      activeContent: fullContent,
      workspacePaths: body.workspacePaths.filter(
        (p) => typeof p === 'string',
      ),
    });

    const userContent = buildCompletionUserMessage(
      body.activePath,
      body.beforeCursor,
      body.afterCursor,
      ctx.workspacePaths,
      ctx.relatedFiles,
    );

    const raw = await invokeTool({
      client: resolved.client,
      model: resolved.model,
      system: completionSystemPrompt(ctx.activeType),
      userContent,
      tool: EMIT_COMPLETIONS_TOOL,
      maxTokens: 1024,
    });

    let items: CompletionItem[];
    try {
      items = validateCompletionItems(raw);
    } catch {
      recordActivity({
        route: 'complete',
        latencyMs: Date.now() - start,
        status: 'error',
        error: 'invalid tool output',
        activePath: body.activePath,
      });
      return jsonError(502, 'AI returned invalid output');
    }

    // Indentation invariant: drop items whose insertText would break
    // the surrounding YAML block scope. Cheap check: every newline
    // in the suggestion must indent at or beyond the cursor's column.
    const cursorIndent = currentLineIndent(body.beforeCursor);
    items = items.filter((item) =>
      indentationSafe(item.insertText, cursorIndent),
    );

    recordActivity({
      route: 'complete',
      latencyMs: Date.now() - start,
      status: 'ok',
      activePath: body.activePath,
    });
    const responseBody: CompleteResponse = { enabled: true, items };
    return Response.json(responseBody);
  } catch (err) {
    const message =
      err instanceof AiTimeoutError
        ? 'AI request timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('[ai/complete] error', err);
    recordActivity({
      route: 'complete',
      latencyMs: Date.now() - start,
      status: 'error',
      error: message.slice(0, 200),
      activePath: body.activePath,
    });
    return jsonError(
      err instanceof AiTimeoutError ? 504 : 502,
      message.slice(0, 200),
    );
  }
}

function buildCompletionUserMessage(
  activePath: string,
  before: string,
  after: string,
  workspacePaths: string[],
  related: { path: string; content: string }[],
): string {
  const parts: string[] = [];
  parts.push(`<active_file path="${activePath}">`);
  parts.push('<before_cursor>');
  parts.push(before);
  parts.push('</before_cursor>');
  parts.push('<after_cursor>');
  parts.push(after);
  parts.push('</after_cursor>');
  parts.push('</active_file>');
  parts.push('');
  parts.push('<workspace_paths>');
  for (const p of workspacePaths) parts.push(p);
  parts.push('</workspace_paths>');
  if (related.length > 0) {
    parts.push('');
    parts.push('<related_files>');
    for (const r of related) {
      parts.push(`<file path="${r.path}">`);
      parts.push(r.content);
      parts.push('</file>');
    }
    parts.push('</related_files>');
  }
  parts.push('');
  parts.push(
    'Suggest YAML completions to insert at the cursor. Each insertText must be valid YAML that fits the current indentation. Use the emit_completions tool.',
  );
  return parts.join('\n');
}

/** How many leading spaces are on the line containing the cursor. */
function currentLineIndent(beforeCursor: string): number {
  const lastNl = beforeCursor.lastIndexOf('\n');
  const line = lastNl === -1 ? beforeCursor : beforeCursor.slice(lastNl + 1);
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

/**
 * Reject suggestions whose newlines de-indent past the cursor's
 * indentation level — those would silently escape the current YAML
 * block and write into a sibling/parent.
 */
function indentationSafe(insertText: string, cursorIndent: number): boolean {
  if (!insertText.includes('\n')) return true;
  const lines = insertText.split('\n');
  // Skip the first line — it lands at the cursor column, not column 0.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    if (spaces < cursorIndent) return false;
  }
  return true;
}
