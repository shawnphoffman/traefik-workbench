/**
 * POST /api/ai/validate — Claude-backed Traefik diagnostics.
 *
 * Same lock-down as /complete: forced tool use, locked prompt, schema
 * re-validation, plus a per-diagnostic in-range check.
 *
 * Validation results are cached server-side by sha256(activeContent +
 * sorted related contents) so tab switches don't re-bill on identical
 * inputs. The cache lives in-memory and is capped at 100 entries.
 */

import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api-errors';
import { getAi, AiDisabledError, AiNoKeyError } from '@/lib/ai/client';
import { recordActivity } from '@/lib/ai/activity';
import { buildWorkspaceContext } from '@/lib/ai/context';
import { validationSystemPrompt } from '@/lib/ai/prompts';
import { EMIT_DIAGNOSTICS_TOOL, validateDiagnostics } from '@/lib/ai/tools';
import { invokeTool, AiTimeoutError } from '@/lib/ai/invoke';
import type {
  Diagnostic,
  ValidateRequest,
  ValidateResponse,
  ValidateDisabledResponse,
} from '@/lib/ai/types';

const MAX_PAYLOAD_BYTES = 200 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_CAP = 100;

interface CacheEntry {
  expires: number;
  diagnostics: Diagnostic[];
}
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): Diagnostic[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.diagnostics;
}

function cacheSet(key: string, diagnostics: Diagnostic[]): void {
  if (cache.size >= CACHE_CAP) {
    // Drop the oldest entry (first key in insertion order).
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, diagnostics });
}

export async function POST(request: NextRequest): Promise<Response> {
  const start = Date.now();

  let body: ValidateRequest;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonError(413, 'Request payload too large');
    }
    body = JSON.parse(raw) as ValidateRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  if (
    typeof body.activePath !== 'string' ||
    typeof body.content !== 'string' ||
    !Array.isArray(body.workspacePaths)
  ) {
    return jsonError(400, 'Invalid request shape');
  }

  let resolved;
  try {
    resolved = await getAi();
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiNoKeyError) {
      const disabled: ValidateDisabledResponse = { enabled: false };
      return Response.json(disabled);
    }
    throw err;
  }

  if (!resolved.features.validation) {
    const disabled: ValidateDisabledResponse = { enabled: false };
    return Response.json(disabled);
  }

  try {
    const ctx = await buildWorkspaceContext({
      activePath: body.activePath,
      activeContent: body.content,
      workspacePaths: body.workspacePaths.filter(
        (p) => typeof p === 'string',
      ),
    });

    // Cache key includes the active content + every related body.
    const cacheKey = computeCacheKey(body.content, ctx.relatedFiles);
    const cached = cacheGet(cacheKey);
    if (cached) {
      recordActivity({
        route: 'validate',
        latencyMs: Date.now() - start,
        status: 'ok',
        activePath: body.activePath,
      });
      const responseBody: ValidateResponse = {
        enabled: true,
        diagnostics: cached,
      };
      return Response.json(responseBody);
    }

    const userContent = buildValidateUserMessage(
      body.activePath,
      body.content,
      ctx.workspacePaths,
      ctx.relatedFiles,
    );

    const raw = await invokeTool({
      client: resolved.client,
      model: resolved.model,
      system: validationSystemPrompt(ctx.activeType),
      userContent,
      tool: EMIT_DIAGNOSTICS_TOOL,
      maxTokens: 2048,
    });

    let diagnostics: Diagnostic[];
    try {
      diagnostics = validateDiagnostics(raw);
    } catch {
      recordActivity({
        route: 'validate',
        latencyMs: Date.now() - start,
        status: 'error',
        error: 'invalid tool output',
        activePath: body.activePath,
      });
      return jsonError(502, 'AI returned invalid output');
    }

    // In-range invariant: drop diagnostics whose line/column doesn't
    // fall inside the active document. Out-of-range markers would
    // confuse the user and Monaco renders them at line 1.
    const lineCount = body.content.split('\n').length;
    diagnostics = diagnostics.filter(
      (d) => d.line >= 1 && d.line <= lineCount,
    );

    cacheSet(cacheKey, diagnostics);

    recordActivity({
      route: 'validate',
      latencyMs: Date.now() - start,
      status: 'ok',
      activePath: body.activePath,
    });
    const responseBody: ValidateResponse = { enabled: true, diagnostics };
    return Response.json(responseBody);
  } catch (err) {
    const message =
      err instanceof AiTimeoutError
        ? 'AI request timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    console.error('[ai/validate] error', err);
    recordActivity({
      route: 'validate',
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

function buildValidateUserMessage(
  activePath: string,
  content: string,
  workspacePaths: string[],
  related: { path: string; content: string }[],
): string {
  const parts: string[] = [];
  parts.push(`<active_file path="${activePath}">`);
  parts.push(content);
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
    'Report Traefik-specific diagnostics for the active file using the emit_diagnostics tool. Each diagnostic must include a 1-based line and column from the active file.',
  );
  return parts.join('\n');
}

function computeCacheKey(
  active: string,
  related: { path: string; content: string }[],
): string {
  const hash = crypto.createHash('sha256');
  hash.update(active);
  // Sort by path for deterministic ordering.
  const sorted = [...related].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  for (const r of sorted) {
    hash.update('\0');
    hash.update(r.path);
    hash.update('\0');
    hash.update(r.content);
  }
  return hash.digest('hex');
}
