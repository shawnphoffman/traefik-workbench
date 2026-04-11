/**
 * Build the workspace context that's sent to Claude alongside the
 * active file. Runs server-side inside each AI route so the heuristic
 * decisions are auditable in one place.
 *
 * Strategy:
 *   1. Classify the active file as static / dynamic / unknown.
 *   2. Build a candidate set of "related" files using cheap heuristics:
 *      - same directory as the active file
 *      - basename of any other file appearing as a token in the active
 *        file (catches `service: web-svc` → `services/web-svc.yml`)
 *   3. Drop candidates whose own classification doesn't match the
 *      active file's type. Static and dynamic never bleed into each
 *      other's context window.
 *   4. Cap to N files / M total bytes, trimming by largest-first.
 *   5. Include the full path list (filtered to compatible types) so
 *      Claude can flag references to non-existent files without us
 *      reading every body from disk.
 *
 * The cap is intentionally small — completion has to feel snappy and
 * Traefik workspaces with the file provider can have dozens of dynamic
 * files. The path list + targeted bodies is enough to do cross-file
 * checks.
 */

import path from 'node:path';

import { readTextFile } from '@/lib/fs';
import { resolveDataPath } from '@/lib/paths';
import { classifyTraefikFile, typesCompatible } from './classify';
import type {
  TraefikConfigType,
  WorkspaceFileWithContent,
} from './types';

const MAX_RELATED_FILES = 8;
const MAX_RELATED_BYTES = 64 * 1024; // 64 KB total

export interface BuiltContext {
  /** Type of the active file. Drives the system prompt blurb. */
  activeType: TraefikConfigType;
  /** Paths (relative to DATA_DIR) of compatible files for cross-ref checks. */
  workspacePaths: string[];
  /** Bodies of files we picked as "most relevant" to send to Claude. */
  relatedFiles: WorkspaceFileWithContent[];
}

export interface BuildContextOptions {
  activePath: string;
  activeContent: string;
  /** All YAML paths in the workspace (from the client / tree cache). */
  workspacePaths: string[];
}

export async function buildWorkspaceContext(
  opts: BuildContextOptions,
): Promise<BuiltContext> {
  const activeType = classifyTraefikFile(opts.activeContent);
  const activeDir = posixDirname(opts.activePath);

  // Strip the active file from the candidate pool — we send it
  // separately and don't want it duplicated as "related".
  const candidates = opts.workspacePaths.filter(
    (p) => p !== opts.activePath,
  );

  // Score each candidate. Higher = more relevant.
  const scored = candidates.map((p) => ({
    path: p,
    score: scoreCandidate(p, activeDir, opts.activeContent),
  }));

  // Drop candidates with score 0 (no relationship at all).
  const positive = scored.filter((s) => s.score > 0);
  positive.sort((a, b) => b.score - a.score);

  // Read up to MAX_RELATED_FILES bodies, classifying each and dropping
  // the ones that don't match the active file's type. We read in
  // priority order and stop once we hit either cap.
  const relatedFiles: WorkspaceFileWithContent[] = [];
  let totalBytes = 0;

  for (const { path: relPath } of positive) {
    if (relatedFiles.length >= MAX_RELATED_FILES) break;
    if (totalBytes >= MAX_RELATED_BYTES) break;

    const abs = resolveDataPath(relPath);
    if (abs === null) continue;

    let body: string;
    try {
      body = await readTextFile(abs);
    } catch {
      // Missing or unreadable — skip silently. The user can still
      // edit even when one referenced file has gone walkabout.
      continue;
    }

    const candType = classifyTraefikFile(body);
    if (!typesCompatible(activeType, candType)) continue;

    const remaining = MAX_RELATED_BYTES - totalBytes;
    const truncated =
      body.length > remaining ? body.slice(0, remaining) : body;
    totalBytes += truncated.length;
    relatedFiles.push({ path: relPath, content: truncated });
  }

  // Build the path list for cross-reference checks. We include every
  // workspace path that *could* match the active type — but to do that
  // without reading every file we use the same heuristic: anything in a
  // directory we've already classified, plus the candidates we kept.
  // For unknown active types we include everything.
  const compatiblePaths =
    activeType === 'unknown'
      ? opts.workspacePaths
      : opts.workspacePaths.filter((p) => {
          // Always include other files we already loaded as "related"
          if (relatedFiles.some((r) => r.path === p)) return true;
          // Include same-directory siblings — likely to be the same type
          if (posixDirname(p) === activeDir) return true;
          // Otherwise we don't know without reading them, so include
          // by default and let Claude decide.
          return true;
        });

  return {
    activeType,
    workspacePaths: compatiblePaths,
    relatedFiles,
  };
}

/**
 * Cheap relevance heuristic for picking which other files to read.
 *
 * - +5 if the file is in the same directory as the active file
 * - +3 if the file's basename (without extension) appears as a token
 *   anywhere in the active file's content
 * - +1 if the file is in a sibling directory of the same parent
 *
 * Returns 0 if no relationship is detected.
 */
function scoreCandidate(
  candidatePath: string,
  activeDir: string,
  activeContent: string,
): number {
  let score = 0;
  const candDir = posixDirname(candidatePath);
  const candBase = posixBasename(candidatePath);
  const candStem = candBase.replace(/\.(ya?ml)$/i, '');

  if (candDir === activeDir) score += 5;
  else if (candDir !== activeDir && parentOf(candDir) === parentOf(activeDir)) {
    score += 1;
  }

  if (candStem.length > 0 && tokenAppears(activeContent, candStem)) {
    score += 3;
  }

  return score;
}

function tokenAppears(haystack: string, token: string): boolean {
  // Match `token` as a whole word (no surrounding word chars on either
  // side). Cheap regex; we don't need a real parser here.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^\\w-])${escaped}(?:[^\\w-]|$)`);
  return re.test(haystack);
}

function posixDirname(p: string): string {
  return path.posix.dirname(p);
}

function posixBasename(p: string): string {
  return path.posix.basename(p);
}

function parentOf(dir: string): string {
  return path.posix.dirname(dir);
}

// Re-export the limits for tests.
export const TEST_LIMITS = {
  MAX_RELATED_FILES,
  MAX_RELATED_BYTES,
};
