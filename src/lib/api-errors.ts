/**
 * Helpers for returning consistent JSON error responses from Route
 * Handlers. Keeping this logic in one place so we don't leak filesystem
 * paths in error messages and so status codes are uniform across routes.
 */

import { FsError } from './fs';
import type { ApiError } from '@/types';

export function jsonError(status: number, message: string): Response {
  const body: ApiError = { error: message };
  return Response.json(body, { status });
}

/**
 * Map a thrown error to an HTTP response. Known `FsError` codes are
 * translated into appropriate status codes; everything else is a 500
 * with a generic message (the real error is logged to the server).
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof FsError) {
    switch (err.code) {
      case 'NOT_FOUND':
      case 'NOT_A_FILE':
      case 'NOT_A_DIRECTORY':
        return jsonError(404, 'Not found');
      case 'ALREADY_EXISTS':
        return jsonError(409, 'Already exists');
      case 'READ_ONLY':
        return jsonError(403, 'Read-only');
    }
  }
  // Unknown — log server-side and return a sanitized message.
  console.error('[api] unhandled error', err);
  return jsonError(500, 'Internal server error');
}
