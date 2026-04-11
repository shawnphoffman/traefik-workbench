/**
 * POST /api/settings/test — test that the configured Anthropic API key
 * works by sending a single tiny message to Claude. Returns
 * `{ ok: true, model }` or `{ ok: false, error }`. The Settings page
 * shows a green check or a red error message.
 *
 * This route reads from the live settings (or env fallback). The test
 * is also recorded in the in-memory activity ring so the user can see
 * it land in "Recent AI activity".
 */

import { jsonError } from '@/lib/api-errors';
import { getAi, AiDisabledError, AiNoKeyError } from '@/lib/ai/client';
import { recordActivity } from '@/lib/ai/activity';
import { TEST_PING_SYSTEM } from '@/lib/ai/prompts';

export async function POST(): Promise<Response> {
  const start = Date.now();
  try {
    const { client, model } = await getAi();
    await client.messages.create({
      model,
      max_tokens: 16,
      system: TEST_PING_SYSTEM,
      messages: [{ role: 'user', content: 'ping' }],
    });
    recordActivity({
      route: 'test',
      latencyMs: Date.now() - start,
      status: 'ok',
    });
    return Response.json({ ok: true, model });
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiNoKeyError) {
      recordActivity({
        route: 'test',
        latencyMs: Date.now() - start,
        status: 'disabled',
      });
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[settings/test] error', err);
    recordActivity({
      route: 'test',
      latencyMs: Date.now() - start,
      status: 'error',
      error: message.slice(0, 200),
    });
    return jsonError(502, message.slice(0, 200));
  }
}
