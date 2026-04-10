/**
 * YAML parsing utilities.
 *
 * This module wraps the `yaml` package's `parseDocument` to:
 * 1. Return a serializable tree (`YamlTreeNode`) for the right-pane
 *    structure view, with 1-based source line numbers so the UI can
 *    scroll the editor to the clicked node.
 * 2. Gracefully surface parse errors without throwing — callers get a
 *    discriminated-union result so the UI can show an error banner while
 *    still rendering the last-known-good tree.
 *
 * Design notes
 * ------------
 * - Each node's `line` is the 1-based line of the pair key (for maps),
 *   the item start (for sequences), or the scalar itself. We derive this
 *   from `range[0]` via a `LineCounter` for O(log n) offset→line lookups.
 * - Scalar keys are coerced to a displayable string. Non-string keys
 *   (numbers, booleans) are stringified; complex keys (maps/seqs) are
 *   shown as "<complex key>".
 * - `id` is a dot/bracket path from the root (e.g.,
 *   `http.routers.web`, `items[0].name`). It is stable across re-parses
 *   as long as structure is unchanged.
 */

import {
  parseDocument,
  LineCounter,
  isMap,
  isSeq,
  isScalar,
  isPair,
  type Node,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
  type Pair,
} from 'yaml';

import type {
  YamlParseResult,
  YamlTreeNode,
  YamlNodeKind,
} from '@/types';

const SCALAR_PREVIEW_MAX_LENGTH = 60;

/**
 * Parse a YAML source string. Never throws — errors are returned in the
 * result. Empty / whitespace-only input is treated as a valid empty
 * document (`tree: null`).
 */
export function parseYaml(source: string): YamlParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, {
    lineCounter,
    // Keep source info for range lookups.
    keepSourceTokens: false,
  });

  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const [start] = first.pos;
    const { line, col } = lineCounter.linePos(start);
    return {
      ok: false,
      error: {
        message: first.message,
        line: line || undefined,
        column: col || undefined,
      },
    };
  }

  const contents = doc.contents;
  if (contents == null) {
    return { ok: true, tree: null };
  }

  // The document root is almost always a map or seq, but can be a bare
  // scalar. We synthesize a top-level node so the UI has something to
  // render.
  const tree = buildNode(contents as Node, ROOT_ID, ROOT_ID, lineCounter);
  return { ok: true, tree };
}

/** Stable identifier for the synthetic root node. */
const ROOT_ID = '$';

/**
 * Combine a parent id with a child key/index into a dot/bracket path.
 * The synthetic root id `$` is treated as an empty prefix so that
 * top-level children have clean ids like `http` and `items[0]` rather
 * than `$.http` and `$.items[0]`.
 */
function joinId(parentId: string, child: string, isIndex: boolean): string {
  const base = parentId === ROOT_ID ? '' : parentId;
  if (isIndex) return `${base}${child}`;
  return base === '' ? child : `${base}.${child}`;
}

/**
 * Recursively build a `YamlTreeNode` from a parsed YAML node.
 *
 * @param node  The parsed AST node.
 * @param id    Stable identifier for this node.
 * @param key   Display key for this node.
 * @param lc    LineCounter for offset→line conversion.
 */
function buildNode(
  node: Node,
  id: string,
  key: string,
  lc: LineCounter,
): YamlTreeNode {
  const line = getLine(node, lc);

  if (isMap(node)) {
    return {
      id,
      key,
      kind: 'map',
      line,
      children: mapChildren(node as YAMLMap, id, lc),
    };
  }

  if (isSeq(node)) {
    return {
      id,
      key,
      kind: 'seq',
      line,
      children: seqChildren(node as YAMLSeq, id, lc),
    };
  }

  if (isScalar(node)) {
    return {
      id,
      key,
      kind: 'scalar',
      line,
      valuePreview: scalarPreview((node as Scalar).value),
    };
  }

  // Aliases and unknown nodes — render as scalars with no preview.
  return {
    id,
    key,
    kind: 'scalar',
    line,
  };
}

function mapChildren(
  map: YAMLMap,
  parentId: string,
  lc: LineCounter,
): YamlTreeNode[] {
  const children: YamlTreeNode[] = [];
  for (const item of map.items) {
    if (!isPair(item)) continue;
    const pair = item as Pair<Node | null, Node | null>;

    const keyString = pairKeyToString(pair.key);
    const childId = joinId(parentId, keyString, false);

    if (pair.value == null) {
      // Key with no value (e.g., `foo:` with nothing after it). Use the
      // key's line if available.
      const line =
        pair.key && typeof pair.key === 'object'
          ? getLine(pair.key as Node, lc)
          : 1;
      children.push({
        id: childId,
        key: keyString,
        kind: 'scalar',
        line,
      });
      continue;
    }

    // For the child, prefer the pair key's line over the value's line,
    // because the key is what the user sees and wants to jump to.
    const child = buildNode(pair.value, childId, keyString, lc);
    if (pair.key && typeof pair.key === 'object') {
      child.line = getLine(pair.key as Node, lc);
    }
    children.push(child);
  }
  return children;
}

function seqChildren(
  seq: YAMLSeq,
  parentId: string,
  lc: LineCounter,
): YamlTreeNode[] {
  const children: YamlTreeNode[] = [];
  seq.items.forEach((item, index) => {
    const key = `[${index}]`;
    const childId = joinId(parentId, key, true);
    if (item == null || typeof item !== 'object') {
      // Bare primitive in a sequence — wrap it as a scalar tree node.
      children.push({
        id: childId,
        key,
        kind: 'scalar',
        line: 1,
        valuePreview: scalarPreview(item),
      });
      return;
    }
    children.push(buildNode(item as Node, childId, key, lc));
  });
  return children;
}

function getLine(node: Node, lc: LineCounter): number {
  // NodeBase.range is [start, valueEnd, nodeEnd] in character offsets,
  // or undefined/null if the node was synthesized.
  const range = (node as { range?: [number, number, number] | null }).range;
  if (!range) return 1;
  const { line } = lc.linePos(range[0]);
  return line || 1;
}

function pairKeyToString(key: unknown): string {
  if (key == null) return '';
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);
  if (isScalar(key as Node)) {
    const value = (key as Scalar).value;
    if (value == null) return '';
    return String(value);
  }
  // Complex keys (map/seq) — YAML allows them but they're rare.
  return '<complex key>';
}

function scalarPreview(value: unknown): string {
  if (value == null) return '~';
  const raw =
    typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SCALAR_PREVIEW_MAX_LENGTH) return oneLine;
  return oneLine.slice(0, SCALAR_PREVIEW_MAX_LENGTH - 1) + '…';
}

/**
 * Utility: recursively collect every node's id so tests can assert on
 * the full tree shape.
 */
export function collectIds(tree: YamlTreeNode | null): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (n: YamlTreeNode) => {
    out.push(n.id);
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Re-export kind for convenience. */
export type { YamlNodeKind };
