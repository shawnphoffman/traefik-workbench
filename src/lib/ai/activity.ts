/**
 * In-memory ring buffer of recent AI calls. Surfaced via
 * `GET /api/ai/activity` for the Settings page "Recent AI activity"
 * panel.
 *
 * Intentionally not persisted: cleared on server restart, capped at 100
 * entries. The point is to give the user a quick window into what
 * Claude is being asked to do — not to be an audit log.
 */

export type AiActivityRoute =
  | 'complete'
  | 'validate'
  | 'format'
  | 'test'
  | 'traefik-review';
export type AiActivityStatus = 'ok' | 'error' | 'disabled';

export interface AiActivityEntry {
  id: string;
  /** Wall-clock ISO timestamp. */
  timestamp: string;
  route: AiActivityRoute;
  /** Latency in milliseconds (end-to-end including model time). */
  latencyMs: number;
  status: AiActivityStatus;
  /** Optional short error message when status === 'error'. */
  error?: string;
  /** Path of the active file the call was about, when applicable. */
  activePath?: string;
}

const CAPACITY = 100;
const buffer: AiActivityEntry[] = [];

export function recordActivity(
  entry: Omit<AiActivityEntry, 'id' | 'timestamp'>,
): void {
  buffer.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (buffer.length > CAPACITY) buffer.length = CAPACITY;
}

export function listActivity(): AiActivityEntry[] {
  // Return a copy so callers can't mutate the ring.
  return buffer.slice();
}

export function clearActivity(): void {
  buffer.length = 0;
}
