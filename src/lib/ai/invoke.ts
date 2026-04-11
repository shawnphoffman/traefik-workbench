/**
 * Shared helper for the three AI tool routes. Wraps the SDK call with:
 *
 * - forced single-tool `tool_choice` (no free-form text path)
 * - 15s abort timeout
 * - tool_use block extraction (no surprises if Claude returns text)
 *
 * Each route then re-validates the extracted JSON against its own
 * runtime validator from `tools.ts`.
 */

import type Anthropic from '@anthropic-ai/sdk';

export interface InvokeToolOptions {
  client: Anthropic;
  model: string;
  system: string;
  userContent: string;
  tool: {
    name: string;
    description: string;
    input_schema: object;
  };
  maxTokens: number;
  /** Hard cap in milliseconds. Default 15000. */
  timeoutMs?: number;
}

export class AiTimeoutError extends Error {
  constructor() {
    super('AI request timed out');
    this.name = 'AiTimeoutError';
  }
}

export class AiToolMissingError extends Error {
  constructor() {
    super('Model returned no tool_use block');
    this.name = 'AiToolMissingError';
  }
}

/**
 * Invoke Claude with a single forced tool. Returns the parsed tool input
 * (still untyped — caller must run a runtime validator).
 */
export async function invokeTool(opts: InvokeToolOptions): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 15_000,
  );
  try {
    const response = await opts.client.messages.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        tools: [
          {
            name: opts.tool.name,
            description: opts.tool.description,
            // Anthropic SDK uses a JSONSchema-like object here.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input_schema: opts.tool.input_schema as any,
          },
        ],
        tool_choice: { type: 'tool', name: opts.tool.name },
        messages: [{ role: 'user', content: opts.userContent }],
      },
      { signal: controller.signal },
    );

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === opts.tool.name) {
        return block.input;
      }
    }
    throw new AiToolMissingError();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'APIUserAbortError')
    ) {
      throw new AiTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
