/**
 * GET /api/ai/activity — recent AI calls (in-memory ring buffer).
 *
 * Used by the Settings page "Recent AI activity" panel. Cleared on
 * server restart by design.
 */

import { listActivity } from '@/lib/ai/activity';

export async function GET(): Promise<Response> {
  return Response.json({ entries: listActivity() });
}
