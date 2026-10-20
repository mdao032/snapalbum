/** Retry delays: 1 s, 2 s, 4 s ... capped at 60 s (NF-011). */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

export function backoffDelayMs(attempt: number): number {
  const safeAttempt = Math.min(30, Math.max(0, Math.floor(attempt)));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** safeAttempt);
}
