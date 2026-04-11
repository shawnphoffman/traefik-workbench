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
import { loadSettings } from '@/lib/settings/store';

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(_request: NextRequest, context: Context) {
  const { path } = await context.params;

  const resolved = resolveDataPath(path);
  if (resolved === null) {
    return jsonError(400, 'Invalid path');
  }

  try {
    // Pull ignore patterns from settings on every request — settings are
    // tiny and the read happens once per tree refresh, so the cost is
    // negligible compared to the recursive walk itself. A bad settings
    // file shouldn't take down the tree, so a load failure here falls
    // back to "no filtering" rather than 500-ing.
    let ignorePatterns: readonly string[] = [];
    try {
      const settings = await loadSettings();
      ignorePatterns = settings.tree.ignorePatterns;
    } catch (err) {
      console.error('[tree] failed to load settings, ignoring filters', err);
    }
    const entries = await listDirectoryTree(DATA_DIR, resolved, {
      ignorePatterns,
    });
    return Response.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
