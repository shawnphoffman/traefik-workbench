/**
 * File operations API.
 *
 * GET    /api/files/foo/bar.yml   → read file content as text
 * PUT    /api/files/foo/bar.yml   → overwrite existing file; body: { content }
 * POST   /api/files/foo/bar.yml   → create new file or directory;
 *                                    body: { type: 'file', content? } or
 *                                          { type: 'directory' }
 * PATCH  /api/files/foo/bar.yml   → rename (move) file or directory;
 *                                    body: { destinationPath }
 * DELETE /api/files/foo/bar.yml   → delete file or directory (recursive)
 *
 * All paths are sanitized against DATA_DIR before any filesystem call.
 */

import type { NextRequest } from 'next/server';

import { resolveDataPath, relativeFromRoot, DATA_DIR } from '@/lib/paths';
import {
  readTextFile,
  writeTextFile,
  createFile,
  createDirectory,
  deleteEntry,
  renameEntry,
} from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';
import type {
  CreateEntryRequest,
  FileContentResponse,
  RenameEntryRequest,
  WriteFileRequest,
} from '@/types';

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }

  try {
    const content = await readTextFile(resolved);
    const body: FileContentResponse = {
      path: relativeFromRoot(DATA_DIR, resolved),
      content,
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
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
  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }

  let body: CreateEntryRequest;
  try {
    body = (await request.json()) as CreateEntryRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (!body || (body.type !== 'file' && body.type !== 'directory')) {
    return jsonError(400, '`type` must be "file" or "directory"');
  }

  try {
    if (body.type === 'directory') {
      await createDirectory(resolved);
    } else {
      const content =
        typeof body.content === 'string' ? body.content : '';
      await createFile(resolved, content);
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }
  if (resolved === DATA_DIR) {
    return jsonError(400, 'Refusing to rename the data root');
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

  const resolvedDest = resolveDataPath(body.destinationPath);
  if (resolvedDest === null) {
    return jsonError(400, 'Invalid destination path');
  }
  if (resolvedDest === DATA_DIR) {
    return jsonError(400, 'Refusing to rename to the data root');
  }

  try {
    await renameEntry(resolved, resolvedDest);
    return Response.json({
      ok: true,
      path: relativeFromRoot(DATA_DIR, resolvedDest),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }
  // Refuse to delete the data root itself.
  if (resolved === DATA_DIR) {
    return jsonError(400, 'Refusing to delete the data root');
  }

  try {
    await deleteEntry(resolved);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
