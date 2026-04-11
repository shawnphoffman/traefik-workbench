/**
 * POST /api/traefik/locate
 *
 * Given a list of Traefik resource names, walk the workspace YAML
 * files in DATA_DIR and find which file (if any) defines each one.
 * Used by the diagnostics panel to power the "Open in editor" deep
 * links: clicking a diagnostic about `auth@file` only makes sense if
 * we can take the user to the file where `auth` is actually declared.
 *
 * Strategy:
 *   - Read every YAML file under DATA_DIR (capped at MAX_FILES /
 *     MAX_BYTES so a pathological workspace can't OOM the route)
 *   - For each requested name, look for the bare name appearing as a
 *     YAML key — i.e. preceded by indentation and followed by `:` —
 *     because that's the canonical "definition" form in dynamic
 *     config. References-from-elsewhere shouldn't claim ownership.
 *   - Return the first match per name (workspace files for a single
 *     resource shouldn't normally exist twice; if they do, picking
 *     the first is no worse than guessing)
 *
 * No filesystem state is modified; the route is read-only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { jsonError } from '@/lib/api-errors';
import { DATA_DIR, isYamlFile } from '@/lib/paths';

export interface LocateRequest {
  names: string[];
}

export interface LocateMatch {
  /** The original (possibly suffixed) name from the request. */
  name: string;
  /** Workspace-relative POSIX path. */
  path: string;
  /** 1-based line number in the file. */
  line: number;
}

export interface LocateResponse {
  matches: LocateMatch[];
}

const MAX_FILES = 200;
const MAX_BYTES_PER_FILE = 256 * 1024;
const MAX_REQUEST_NAMES = 200;

export async function POST(request: Request): Promise<Response> {
  let body: LocateRequest;
  try {
    body = (await request.json()) as LocateRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (!Array.isArray(body.names)) {
    return jsonError(400, 'Invalid request shape');
  }

  // Strip provider suffixes — workspace files only ever declare bare
  // names (provider tags are added by Traefik at runtime). Dedup so we
  // don't pay to scan the same name twice.
  const wanted = new Set<string>();
  const originals = new Map<string, string>(); // bare → first original
  for (const raw of body.names.slice(0, MAX_REQUEST_NAMES)) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const at = raw.indexOf('@');
    const bare = at >= 0 ? raw.slice(0, at) : raw;
    if (bare.length === 0) continue;
    if (!originals.has(bare)) originals.set(bare, raw);
    wanted.add(bare);
  }

  if (wanted.size === 0) {
    const empty: LocateResponse = { matches: [] };
    return Response.json(empty);
  }

  const yamlFiles = await collectYamlFiles(DATA_DIR);
  const matches: LocateMatch[] = [];
  const found = new Set<string>();

  for (const relPath of yamlFiles) {
    if (found.size === wanted.size) break;
    if (matches.length >= wanted.size) break;

    const abs = path.join(DATA_DIR, relPath);
    let content: string;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_BYTES_PER_FILE) {
        // Read only the first chunk — definitions in Traefik dynamic
        // config tend to live near the top of small files.
        const fh = await fs.open(abs, 'r');
        try {
          const buf = Buffer.alloc(MAX_BYTES_PER_FILE);
          const { bytesRead } = await fh.read(buf, 0, MAX_BYTES_PER_FILE, 0);
          content = buf.subarray(0, bytesRead).toString('utf8');
        } finally {
          await fh.close();
        }
      } else {
        content = await fs.readFile(abs, 'utf8');
      }
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const key = extractYamlKey(line);
      if (key === null) continue;
      if (!wanted.has(key) || found.has(key)) continue;
      found.add(key);
      matches.push({
        name: originals.get(key) ?? key,
        path: relPath,
        line: i + 1,
      });
    }
  }

  const responseBody: LocateResponse = { matches };
  return Response.json(responseBody);
}

/**
 * Pull the YAML map key from a line, or `null` if the line isn't a
 * map-key declaration. Tolerates leading indentation, list-item
 * dashes, and quoted keys.
 */
function extractYamlKey(line: string): string | null {
  // Empty line, comment, or doc separator — not a key.
  const trimmed = line.replace(/^[\s-]+/, '');
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('#')) return null;

  // Match `key:` or `"key":` or `'key':` followed by end-of-line or
  // whitespace+value. The colon must be unquoted, so anchoring to
  // start-of-rest works as long as we strip the optional quote.
  let i = 0;
  let quote: '"' | "'" | null = null;
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    quote = trimmed[0] as '"' | "'";
    i = 1;
  }
  let key = '';
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (quote && ch === quote) {
      i++;
      break;
    }
    if (!quote && (ch === ':' || ch === ' ' || ch === '\t')) break;
    if (
      !quote &&
      !/[\w.\-/@]/.test(ch)
    ) {
      return null;
    }
    key += ch;
    i++;
  }
  if (key.length === 0) return null;
  // Skip whitespace
  while (i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) {
    i++;
  }
  if (trimmed[i] !== ':') return null;
  return key;
}

async function collectYamlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;
    if (out.length >= MAX_FILES) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort for deterministic traversal — same input always returns
    // the same first match for a given name.
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (out.length >= MAX_FILES) return;
      if (dirent.name.startsWith('.')) continue;
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (dirent.isFile() && isYamlFile(dirent.name)) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        out.push(rel);
      }
    }
  }
  await walk(root, 0);
  return out;
}
