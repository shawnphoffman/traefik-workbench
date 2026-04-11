/**
 * Cross-page handoff for "open this file in the editor at this line".
 *
 * The /traefik diagnostics panel is a separate route from the workbench
 * (/) but lives in the same browser tab, so we use sessionStorage as a
 * one-shot mailbox: write before navigation, consume on workbench mount.
 *
 * sessionStorage (not localStorage) because the handoff is scoped to the
 * current tab — opening the workbench in another tab should not pick up
 * a stale instruction that was meant for the originating tab.
 */

const PENDING_OPEN_KEY = 'traefik-workbench:pending-open';

export interface PendingOpen {
  /** Workspace-relative POSIX path. */
  path: string;
  /** 1-based editor line number. Optional — omit to just open the file. */
  line?: number;
}

/**
 * Stash an "open this file" instruction for the next workbench mount.
 * No-op on the server (where sessionStorage doesn't exist).
 */
export function setPendingOpen(target: PendingOpen): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify(target));
  } catch {
    // Quota / private mode — silently drop. The deep-link is a
    // nice-to-have, not a correctness requirement.
  }
}

/**
 * Read and clear the pending-open instruction. Returns null when there
 * isn't one (or when the stored value is corrupt).
 */
export function consumePendingOpen(): PendingOpen | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_OPEN_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_OPEN_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as PendingOpen).path !== 'string'
    ) {
      return null;
    }
    const candidate = parsed as PendingOpen;
    const result: PendingOpen = { path: candidate.path };
    if (typeof candidate.line === 'number' && candidate.line >= 1) {
      result.line = Math.floor(candidate.line);
    }
    return result;
  } catch {
    return null;
  }
}
