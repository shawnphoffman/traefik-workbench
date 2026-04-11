/**
 * Per-template-file API. Currently exposes a single verb:
 *
 *   POST /api/templates/foo/bar.yml  → create a new template file
 *                                       body: { content: string }
 *
 * Gated by `TEMPLATES_READONLY`. The default is read-only — operators
 * have to opt in by setting `TEMPLATES_READONLY=false` (and ensuring the
 * templates volume is mounted read-write) before this verb succeeds.
 */

import type { NextRequest } from 'next/server';

import {
  isYamlFile,
  resolveTemplatePath,
  TEMPLATES_READONLY,
} from '@/lib/paths';
import { createFile } from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';
import type { CreateTemplateRequest } from '@/types';

type Context = { params: Promise<{ path: string[] }> };

export async function POST(request: NextRequest, context: Context) {
  if (TEMPLATES_READONLY) {
    return jsonError(
      403,
      'Templates are read-only. Set TEMPLATES_READONLY=false to enable writes.',
    );
  }

  const { path } = await context.params;
  const resolved = resolveTemplatePath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid template path');
  }

  // Templates are YAML-only — same constraint as the listing endpoint.
  // Reject paths that don't end in .yml/.yaml so a bad client can't
  // poison the templates dir with arbitrary files.
  const joined = Array.isArray(path) ? path.join('/') : String(path);
  if (!isYamlFile(joined)) {
    return jsonError(400, 'Template name must end in .yml or .yaml');
  }

  let body: CreateTemplateRequest;
  try {
    body = (await request.json()) as CreateTemplateRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (typeof body?.content !== 'string') {
    return jsonError(400, '`content` must be a string');
  }

  try {
    await createFile(resolved, body.content);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
