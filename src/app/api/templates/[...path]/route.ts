/**
 * Per-template-file API. Templates live under TEMPLATES_DIR (a separate
 * mount from DATA_DIR) and are always edited via this route — never via
 * /api/files, which is data-root scoped.
 *
 *   GET    /api/templates/foo/bar.yml  → read template content as text
 *   PUT    /api/templates/foo/bar.yml  → overwrite existing template
 *                                         body: { content: string }
 *   POST   /api/templates/foo/bar.yml  → create a new template file
 *                                         body: { content: string }
 *   PATCH  /api/templates/foo/bar.yml  → rename (move) a template
 *                                         body: { destinationPath: string }
 *   DELETE /api/templates/foo/bar.yml  → delete a template
 *
 * Templates are always writable from the workbench's perspective. If the
 * underlying volume is mounted read-only, the create/write/delete call
 * will fail at the filesystem layer and surface as a 500 via
 * `errorResponse`.
 */

import type { NextRequest } from 'next/server';

import {
  isYamlFile,
  relativeFromRoot,
  resolveTemplatePath,
  TEMPLATES_DIR,
} from '@/lib/paths';
import {
  createFile,
  deleteEntry,
  readTextFile,
  renameEntry,
  writeTextFile,
} from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';
import type {
  CreateTemplateRequest,
  FileContentResponse,
  RenameEntryRequest,
  WriteFileRequest,
} from '@/types';

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveTemplatePath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid template path');
  }

  try {
    const content = await readTextFile(resolved);
    const body: FileContentResponse = {
      path: relativeFromRoot(TEMPLATES_DIR, resolved),
      content,
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveTemplatePath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid template path');
  }

  let body: WriteFileRequest;
  try {
    body = (await request.json()) as WriteFileRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (typeof body?.content !== 'string') {
    return jsonError(400, '`content` must be a string');
  }

  try {
    await writeTextFile(resolved, body.content);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

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

export async function PATCH(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveTemplatePath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid template path');
  }
  if (resolved === TEMPLATES_DIR) {
    return jsonError(400, 'Refusing to rename the templates root');
  }

  let body: RenameEntryRequest;
  try {
    body = (await request.json()) as RenameEntryRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (typeof body?.destinationPath !== 'string') {
    return jsonError(400, '`destinationPath` must be a string');
  }
  if (!isYamlFile(body.destinationPath)) {
    return jsonError(400, 'Template name must end in .yml or .yaml');
  }

  const resolvedDest = resolveTemplatePath(body.destinationPath);
  if (resolvedDest === null) {
    return jsonError(400, 'Invalid destination path');
  }
  if (resolvedDest === TEMPLATES_DIR) {
    return jsonError(400, 'Refusing to rename to the templates root');
  }

  try {
    await renameEntry(resolved, resolvedDest);
    return Response.json({
      ok: true,
      path: relativeFromRoot(TEMPLATES_DIR, resolvedDest),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveTemplatePath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid template path');
  }
  if (resolved === TEMPLATES_DIR) {
    return jsonError(400, 'Refusing to delete the templates root');
  }

  try {
    await deleteEntry(resolved);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
