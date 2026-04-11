/**
 * API-key masking. Used everywhere a key leaves the server.
 *
 * The mask shows enough characters to verify "yes I pasted the right one"
 * without leaking the secret in screenshots or logs:
 *
 *   sk-ant-api03-abcdef…WXYZ  →  sk-ant-•••••WXYZ
 *
 * For very short keys we mask everything to avoid showing too much.
 */

const VISIBLE_TAIL = 4;

export function maskApiKey(key: string | null | undefined): string | null {
  if (key == null || key.length === 0) return null;
  if (key.length <= VISIBLE_TAIL + 4) {
    // Too short to safely show any plaintext.
    return '•'.repeat(8);
  }
  // Preserve the `sk-ant-` family prefix if present so the user can tell
  // it's an Anthropic key at a glance, then bullets, then the last 4.
  const prefixMatch = /^sk-[a-z0-9]+-/.exec(key);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const tail = key.slice(-VISIBLE_TAIL);
  return `${prefix}•••••${tail}`;
}
