/**
 * Shared types used by both the server (route handlers, lib/) and the
 * client (components). Keep this file free of runtime imports — it should
 * be safe to import from any context.
 */

export type TreeEntryKind = 'file' | 'directory';

/**
 * A single node in a file tree. For directories, `children` may be
 * populated (recursive listing) or omitted (flat listing).
 */
export interface TreeEntry {
  /** Base name of the entry (e.g., `web.yml`). */
  name: string;
  /** POSIX-style path relative to the tree root (no leading slash). */
  path: string;
  kind: TreeEntryKind;
  /** Size in bytes. Only set for files. */
  size?: number;
  /** Child entries. Only set for directories when recursively listed. */
  children?: TreeEntry[];
}

export interface FileContentResponse {
  path: string;
  content: string;
}

export interface WriteFileRequest {
  content: string;
}

export type CreateEntryRequest =
  | { type: 'file'; content?: string }
  | { type: 'directory' };

export interface TemplateEntry {
  /** Base filename (e.g., `router.yml`). */
  name: string;
  /** Path relative to the templates root. */
  path: string;
}

export interface CopyTemplateRequest {
  /** Path of the source template, relative to the templates root. */
  templatePath: string;
  /** Destination path, relative to the data root. Must not already exist. */
  destinationPath: string;
}

/** Kinds of YAML tree nodes shown in the right pane. */
export type YamlNodeKind = 'map' | 'seq' | 'scalar';

/**
 * A node in the YAML structure tree shown in the right pane. The tree is
 * built from the parsed document AST and carries the source line for
 * "click to scroll editor" navigation.
 */
export interface YamlTreeNode {
  /** Stable id — a dot/bracket path from the root (e.g., `http.routers.web`). */
  id: string;
  /** Display key (map key or `[index]` for sequence items). */
  key: string;
  kind: YamlNodeKind;
  /** 1-based line number of the key/value in the source document. */
  line: number;
  /** Short preview of scalar value (truncated). Only set for scalars. */
  valuePreview?: string;
  children?: YamlTreeNode[];
}

export interface YamlParseError {
  message: string;
  /** 1-based line of the first error, if known. */
  line?: number;
  /** 1-based column of the first error, if known. */
  column?: number;
}

export type YamlParseResult =
  | { ok: true; tree: YamlTreeNode | null }
  | { ok: false; error: YamlParseError };

export interface ApiError {
  error: string;
}
