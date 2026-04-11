/**
 * POST /api/ai/format — Claude-backed YAML formatter.
 *
 * Same lock-down as the other AI routes, plus the strongest invariant
 * of the bunch: the formatted output must parse to the same data
 * structure as the input. If it doesn't, the route returns 422 and the
 * client doesn't apply the change. This is the safety guarantee that
 * Claude can't silently rewrite your config in the name of "tidying".
 *
 * Format does NOT use cross-file context — it's a pure local
 * transformation.
 */

import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { getAi, AiDisabledError, AiNoKeyError } from '@/lib/ai/client';
import { recordActivity } from '@/lib/ai/activity';
import { classifyTraefikFile } from '@/lib/ai/classify';
import { formatSystemPrompt } from '@/lib/ai/prompts';
import { EMIT_FORMATTED_TOOL, validateFormatted } from '@/lib/ai/tools';
import { invokeTool, AiTimeoutError } from '@/lib/ai/invoke';
import { yamlAstEqual } from '@/lib/ai/astEqual';
import type {
  FormatRequest,
  FormatResponse,
  FormatDisabledResponse,
} from '@/lib/ai/types';

const MAX_PAYLOAD_BYTES = 200 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  const start = Date.now();

  let body: FormatRequest;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonError(413, 'Request payload too large');
    }
    body = JSON.parse(raw) as FormatRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  if (
    typeof body.activePath !== 'string' ||
    typeof body.content !== 'string'
  ) {
    return jsonError(400, 'Invalid request shape');
  }

  let resolved;
  try {
    resolved = await getAi();
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiNoKeyError) {
      const disabled: FormatDisabledResponse = { enabled: false };
      return Response.json(disabled);
    }
    throw err;
  }

  if (!resolved.features.format) {
    const disabled: FormatDisabledResponse = { enabled: false };
    return Response.json(disabled);
  }

  // Refuse to format files that don't already parse — Claude shouldn't
  // be guessing at the user's intent on broken YAML.
  const initialAst = yamlAstEqual(body.content, body.content);
  if (!initialAst.equal) {
    return jsonError(422, 'Cannot format invalid YAML');
  }

  try {
    const configType = classifyTraefikFile(body.content);
    const userContent =
      `<active_file path="${body.activePath}">\n` +
      body.content +
      `\n</active_file>\n\nReformat the file using the emit_formatted tool. Return the entire file. Preserve every value, key, and comment.`;

    const raw = await invokeTool({
      client: resolved.client,
      model: resolved.model,
      system: formatSystemPrompt(configType),
      userContent,
      tool: EMIT_FORMATTED_TOOL,
      maxTokens: 8192,
      timeoutMs: 30_000,
    });

    let formatted: string;
    try {
      formatted = validateFormatted(raw);
    } catch {
      recordActivity({
        route: 'format',
        latencyMs: Date.now() - start,
        status: 'error',
        error: 'invalid tool output',
        activePath: body.activePath,
      });
      return jsonError(502, 'AI returned invalid output');
    }

    // Hard semantic invariant: the formatted output must parse to the
    // same data structure as the input. Anything else is a rewrite,
    // not a format.
    const compare = yamlAstEqual(body.content, formatted);
    if (!compare.equal) {
      recordActivity({
        route: 'format',
        latencyMs: Date.now() - start,
        status: 'error',
        error: `semantic drift at ${compare.diff ?? 'unknown'}`,
        activePath: body.activePath,
      });
      return jsonError(
        422,
        `Format would change semantic content (at ${compare.diff ?? 'unknown'}); rejected.`,
      );
    }

    recordActivity({
      route: 'format',
      latencyMs: Date.now() - start,
      status: 'ok',
      activePath: body.activePath,
    });
    const responseBody: FormatResponse = { enabled: true, formatted };
    return Response.json(responseBody);
  } catch (err) {
    const message =
      err instanceof AiTimeoutError
        ? 'AI request timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('[ai/format] error', err);
    recordActivity({
      route: 'format',
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
