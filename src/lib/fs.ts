/**
 * Filesystem primitives used by the API route handlers.
 *
 * Every function in this module accepts **already-sanitized absolute
 * paths**. The caller MUST run user-supplied paths through
 * `resolveWithinRoot` (or one of its wrappers in `lib/paths.ts`) before
 * invoking any function here. This module does not perform traversal
 * checks of its own.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { TreeEntry } from '@/types';
import { isYamlFile } from './paths';

/**
 * A custom error class so callers can distinguish expected FS errors
 * (missing file, conflict, etc.) from unexpected bugs.
 */
export class FsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'ALREADY_EXISTS'
      | 'NOT_A_FILE'
      | 'NOT_A_DIRECTORY'
      | 'READ_ONLY',
  ) {
    super(message);
    this.name = 'FsError';
  }
}

/**
 * Read a UTF-8 text file. Throws `FsError('NOT_FOUND')` if the path does
 * not exist or is not a regular file.
 */
export async function readTextFile(absolutePath: string): Promise<string> {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(`Not found: ${absolutePath}`, 'NOT_FOUND');
    }
    throw err;
  }
  if (!stat.isFile()) {
    throw new FsError(`Not a file: ${absolutePath}`, 'NOT_A_FILE');
  }
  return fs.readFile(absolutePath, 'utf8');
}

/**
 * Write to an existing file. Fails with `FsError('NOT_FOUND')` if the
 * file does not exist (use `createFile` to create new files). The write
 * is atomic-ish: we write to a temp file in the same directory and
 * rename.
 */
export async function writeTextFile(
  absolutePath: string,
  content: string,
): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(`Not found: ${absolutePath}`, 'NOT_FOUND');
    }
    throw err;
  }
  if (!stat.isFile()) {
    throw new FsError(`Not a file: ${absolutePath}`, 'NOT_A_FILE');
  }

  await atomicWrite(absolutePath, content);
}

/**
 * Create a new file. Fails with `FsError('ALREADY_EXISTS')` if the path
 * already exists. The parent directory must already exist.
 */
export async function createFile(
  absolutePath: string,
  content: string = '',
): Promise<void> {
  try {
    // Use the 'wx' flag so we fail if the file exists.
    const handle = await fs.open(absolutePath, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'EEXIST') {
      throw new FsError(
        `Already exists: ${absolutePath}`,
        'ALREADY_EXISTS',
      );
    }
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      // Parent directory doesn't exist.
      throw new FsError(
        `Parent directory not found: ${path.dirname(absolutePath)}`,
        'NOT_FOUND',
      );
    }
    throw err;
  }
}

/**
 * Create a new directory. Fails with `FsError('ALREADY_EXISTS')` if the
 * path already exists. The parent directory must already exist.
 */
export async function createDirectory(absolutePath: string): Promise<void> {
  try {
    await fs.mkdir(absolutePath);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'EEXIST') {
      throw new FsError(
        `Already exists: ${absolutePath}`,
        'ALREADY_EXISTS',
      );
    }
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(
        `Parent directory not found: ${path.dirname(absolutePath)}`,
        'NOT_FOUND',
      );
    }
    throw err;
  }
}

/**
 * Delete a file or directory. Directories are deleted recursively. Fails
 * with `FsError('NOT_FOUND')` if the path doesn't exist.
 */
export async function deleteEntry(absolutePath: string): Promise<void> {
  try {
    await fs.rm(absolutePath, { recursive: true, force: false });
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(`Not found: ${absolutePath}`, 'NOT_FOUND');
    }
    throw err;
  }
}

/**
 * List the immediate contents of a directory. Each entry's `path` is
 * POSIX-style and expressed relative to `root`. Use `listDirectoryTree`
 * for recursive listings.
 */
export async function listDirectory(
  root: string,
  absolutePath: string,
): Promise<TreeEntry[]> {
  const dirents = await readdirOrThrow(absolutePath);
  const entries: TreeEntry[] = [];

  for (const dirent of dirents) {
    const childAbs = path.join(absolutePath, dirent.name);
    if (dirent.isDirectory()) {
      entries.push({
        name: dirent.name,
        path: toPosixRelative(root, childAbs),
        kind: 'directory',
      });
    } else if (dirent.isFile()) {
      const stat = await fs.stat(childAbs);
      entries.push({
        name: dirent.name,
        path: toPosixRelative(root, childAbs),
        kind: 'file',
        size: stat.size,
      });
    }
    // Symlinks and other entry kinds are ignored for v1.
  }

  return sortEntries(entries);
}

/**
 * Options for `listDirectoryTree`. Kept as a single object so future
 * filters (size limits, hidden-file rules, etc.) can be added without
 * breaking call sites.
 */
export interface ListDirectoryTreeOptions {
  /** Cap on recursion depth. Default 16. */
  maxDepth?: number;
  /**
   * Glob-ish ignore patterns applied per entry. Matched against both
   * the basename and the POSIX path relative to `root`. Patterns
   * ending in `/` only match directories. See `matchesIgnorePattern`.
   */
  ignorePatterns?: readonly string[];
}

/**
 * Recursively list a directory. Returns an array of top-level entries;
 * each directory entry carries a `children` array.
 *
 * `maxDepth` guards against runaway recursion (e.g., accidental symlink
 * loops); entries beyond the depth cap are returned without children.
 */
export async function listDirectoryTree(
  root: string,
  absolutePath: string,
  options: ListDirectoryTreeOptions = {},
): Promise<TreeEntry[]> {
  const { maxDepth = 16, ignorePatterns = [] } = options;
  return listDirectoryTreeInner(
    root,
    absolutePath,
    maxDepth,
    0,
    ignorePatterns,
  );
}

async function listDirectoryTreeInner(
  root: string,
  absolutePath: string,
  maxDepth: number,
  depth: number,
  ignorePatterns: readonly string[],
): Promise<TreeEntry[]> {
  const dirents = await readdirOrThrow(absolutePath);
  const entries: TreeEntry[] = [];

  for (const dirent of dirents) {
    const childAbs = path.join(absolutePath, dirent.name);
    const relPath = toPosixRelative(root, childAbs);
    if (
      shouldIgnoreEntry(
        dirent.name,
        relPath,
        dirent.isDirectory(),
        ignorePatterns,
      )
    ) {
      continue;
    }
    if (dirent.isDirectory()) {
      const node: TreeEntry = {
        name: dirent.name,
        path: relPath,
        kind: 'directory',
      };
      if (depth + 1 < maxDepth) {
        node.children = await listDirectoryTreeInner(
          root,
          childAbs,
          maxDepth,
          depth + 1,
          ignorePatterns,
        );
      } else {
        node.children = [];
      }
      entries.push(node);
    } else if (dirent.isFile()) {
      const stat = await fs.stat(childAbs);
      entries.push({
        name: dirent.name,
        path: relPath,
        kind: 'file',
        size: stat.size,
      });
    }
  }

  return sortEntries(entries);
}

/**
 * True if `name` / `relPath` is excluded by any of the user-supplied
 * ignore patterns. See `matchesIgnorePattern` for the matcher rules.
 */
export function shouldIgnoreEntry(
  name: string,
  relPath: string,
  isDirectory: boolean,
  patterns: readonly string[],
): boolean {
  for (const raw of patterns) {
    if (matchesIgnorePattern(name, relPath, isDirectory, raw)) return true;
  }
  return false;
}

/**
 * Minimal glob matcher tailored to the ignore-pattern UX. Intentionally
 * not a full minimatch — just enough to cover the common cases the user
 * is likely to type into the Settings page:
 *
 *   .git/            → only matches directories named `.git` anywhere
 *   node_modules     → matches files OR directories named `node_modules`
 *   *.log            → matches any file (or directory) whose basename ends in .log
 *   secrets/private  → matches the exact relative path
 *   **\/draft        → matches any segment named `draft`
 *
 * Rules:
 *   - A trailing `/` means "directories only" (and is then stripped).
 *   - If the pattern contains `/`, we match against the full POSIX
 *     relative path; otherwise we match against the basename. This
 *     mirrors gitignore's "anywhere" vs "anchored" behavior closely
 *     enough for the workbench's use case.
 *   - `*` matches any run of characters except `/`. `?` matches a
 *     single non-`/` character. No `**` support (the basename-vs-path
 *     split makes it largely unnecessary).
 */
export function matchesIgnorePattern(
  name: string,
  relPath: string,
  isDirectory: boolean,
  rawPattern: string,
): boolean {
  const trimmed = rawPattern.trim();
  if (trimmed.length === 0) return false;

  let pattern = trimmed;
  let directoryOnly = false;
  if (pattern.endsWith('/')) {
    directoryOnly = true;
    pattern = pattern.slice(0, -1);
  }
  if (pattern.length === 0) return false;
  if (directoryOnly && !isDirectory) return false;

  const target = pattern.includes('/') ? relPath : name;
  const re = globToRegExp(pattern);
  return re.test(target);
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  out += '$';
  return new RegExp(out);
}

/**
 * List templates recursively, filtering to YAML files only. Paths in the
 * result are relative to `templatesRoot`.
 */
export async function listTemplateFiles(
  templatesRoot: string,
): Promise<{ name: string; path: string }[]> {
  const collected: { name: string; path: string }[] = [];
  await walkForYaml(templatesRoot, templatesRoot, collected);
  collected.sort((a, b) => a.path.localeCompare(b.path));
  return collected;
}

async function walkForYaml(
  root: string,
  dir: string,
  out: { name: string; path: string }[],
): Promise<void> {
  const dirents = await readdirOrThrow(dir);
  for (const dirent of dirents) {
    const abs = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      await walkForYaml(root, abs, out);
    } else if (dirent.isFile() && isYamlFile(dirent.name)) {
      out.push({ name: dirent.name, path: toPosixRelative(root, abs) });
    }
  }
}

/**
 * Rename (or move) a file or directory. Fails with:
 * - `NOT_FOUND` if the source does not exist or the destination's parent
 *   directory does not exist
 * - `ALREADY_EXISTS` if the destination path already exists (we never
 *   overwrite on rename)
 *
 * Uses `fs.rename` under the hood, which is atomic within a single
 * filesystem on POSIX. Cross-device moves will fail with `EXDEV` and
 * surface as a generic 500 — acceptable since /data is a single mount
 * in production.
 *
 * There is a small TOCTOU race between the "destination exists" check
 * and the actual `rename` call: another process could create the
 * destination in between. For the intended single-user workbench this
 * is acceptable.
 */
export async function renameEntry(
  sourceAbs: string,
  destinationAbs: string,
): Promise<void> {
  if (sourceAbs === destinationAbs) return;

  // Source must exist.
  try {
    await fs.stat(sourceAbs);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(`Not found: ${sourceAbs}`, 'NOT_FOUND');
    }
    throw err;
  }

  // Destination must NOT exist.
  try {
    await fs.stat(destinationAbs);
    throw new FsError(
      `Already exists: ${destinationAbs}`,
      'ALREADY_EXISTS',
    );
  } catch (err) {
    if (err instanceof FsError) throw err;
    if (!isNodeErrnoException(err) || err.code !== 'ENOENT') throw err;
    // ENOENT is the happy path — the destination is free.
  }

  try {
    await fs.rename(sourceAbs, destinationAbs);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      // Destination parent directory doesn't exist.
      throw new FsError(
        `Parent directory not found: ${path.dirname(destinationAbs)}`,
        'NOT_FOUND',
      );
    }
    throw err;
  }
}

/**
 * Copy a file from one absolute path to another. Fails if the destination
 * already exists or the source is missing.
 */
export async function copyFile(
  sourceAbs: string,
  destinationAbs: string,
): Promise<void> {
  try {
    await fs.copyFile(
      sourceAbs,
      destinationAbs,
      // COPYFILE_EXCL: fail if destination exists
      fs.constants?.COPYFILE_EXCL ?? 1,
    );
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'EEXIST') {
      throw new FsError(
        `Already exists: ${destinationAbs}`,
        'ALREADY_EXISTS',
      );
    }
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(
        `Source or destination directory not found`,
        'NOT_FOUND',
      );
    }
    throw err;
  }
}

// ---------- helpers ----------

async function readdirOrThrow(absolutePath: string) {
  try {
    return await fs.readdir(absolutePath, { withFileTypes: true });
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new FsError(`Not found: ${absolutePath}`, 'NOT_FOUND');
    }
    if (isNodeErrnoException(err) && err.code === 'ENOTDIR') {
      throw new FsError(
        `Not a directory: ${absolutePath}`,
        'NOT_A_DIRECTORY',
      );
    }
    throw err;
  }
}

async function atomicWrite(
  absolutePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmp, content, 'utf8');
  try {
    await fs.rename(tmp, absolutePath);
  } catch (err) {
    // Clean up the temp file if rename failed, but don't mask the error.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function toPosixRelative(root: string, absolutePath: string): string {
  const rel = path.relative(root, absolutePath);
  return rel.split(path.sep).join('/');
}

function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  // Folders first, then alphabetical within each group.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function isNodeErrnoException(
  err: unknown,
): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}
