/**
 * GET /api/tree            → list the full recursive tree of DATA_DIR
 * GET /api/tree/foo/bar    → list the recursive tree of DATA_DIR/foo/bar
 *
 * The client uses the recursive response to populate the left-pane file
 * tree in one shot. If config directories grow large we can switch to
 * lazy per-directory loading later.
 */

import type { NextRequest } from 'next/server';

import { resolveDataPath, DATA_DIR } from '@/lib/paths';
import { listDirectoryTree } from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(_request: NextRequest, context: Context) {
  const { path } = await context.params;

  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }

  try {
    const entries = await listDirectoryTree(DATA_DIR, resolved);
    return Response.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
