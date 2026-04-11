/**
 * Per-template-file API. Currently exposes a single verb:
 *
 *   POST /api/templates/foo/bar.yml  → create a new template file
 *                                       body: { content: string }
 *
 * Templates are always writable from the workbench's perspective. If the
 * underlying volume is mounted read-only, the create call will fail at
 * the filesystem layer and surface as a 500 via `errorResponse`.
 */

import type { NextRequest } from 'next/server';

import { isYamlFile, resolveTemplatePath } from '@/lib/paths';
import { createFile } from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';
import type { CreateTemplateRequest } from '@/types';

type Context = { params: Promise<{ path: string[] }> };

export async function POST(request: NextRequest, context: Context) {
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
