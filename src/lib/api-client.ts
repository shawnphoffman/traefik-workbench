/**
 * Typed client-side wrappers around the /api routes.
 *
 * These are the ONLY functions the UI should use to talk to the backend
 * — keep path construction and error handling in one place so
 * components stay focused on rendering.
 */

import type {
  TreeEntry,
  FileContentResponse,
  TemplateEntry,
  CreateEntryRequest,
  CopyTemplateRequest,
  ApiError,
} from '@/types';

/**
 * Thrown for any non-2xx response. Carries the HTTP status and the
 * server-provided error message so callers can render something
 * actionable.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as ApiError;
    if (body?.error) message = body.error;
  } catch {
    // body wasn't JSON — keep generic message
  }
  throw new ApiClientError(message, res.status);
}

/**
 * Build a URL for a file or tree path. Each segment is individually
 * encoded so that `#`, `?`, spaces, and other URL-meaningful characters
 * in filenames survive the round trip.
 */
function encodeSegments(relativePath: string): string {
  return relativePath
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

// ---------- tree ----------

export async function fetchTree(
  relativePath: string = '',
): Promise<TreeEntry[]> {
  const encoded = encodeSegments(relativePath);
  const url = encoded.length > 0 ? `/api/tree/${encoded}` : '/api/tree';
  const res = await fetch(url);
  const body = await parseJsonOrThrow<{ entries: TreeEntry[] }>(res);
  return body.entries;
}

// ---------- files ----------

export async function fetchFile(
  relativePath: string,
): Promise<FileContentResponse> {
  const url = `/api/files/${encodeSegments(relativePath)}`;
  const res = await fetch(url);
  return parseJsonOrThrow<FileContentResponse>(res);
}

export async function saveFile(
  relativePath: string,
  content: string,
): Promise<void> {
  const url = `/api/files/${encodeSegments(relativePath)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await parseJsonOrThrow<{ ok: true }>(res);
}

export async function createEntry(
  relativePath: string,
  body: CreateEntryRequest,
): Promise<void> {
  const url = `/api/files/${encodeSegments(relativePath)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await parseJsonOrThrow<{ ok: true }>(res);
}

export async function deleteEntry(relativePath: string): Promise<void> {
  const url = `/api/files/${encodeSegments(relativePath)}`;
  const res = await fetch(url, { method: 'DELETE' });
  await parseJsonOrThrow<{ ok: true }>(res);
}

// ---------- templates ----------

export async function fetchTemplates(): Promise<TemplateEntry[]> {
  const res = await fetch('/api/templates');
  const body = await parseJsonOrThrow<{ entries: TemplateEntry[] }>(res);
  return body.entries;
}

export async function copyTemplate(
  body: CopyTemplateRequest,
): Promise<void> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await parseJsonOrThrow<{ ok: true }>(res);
}
