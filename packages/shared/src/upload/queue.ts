import { backoffDelayMs } from "./backoff";

/** Maximum simultaneous uploads per device (NF-003). */
export const MAX_CONCURRENT_UPLOADS = 3;

export type QueueItemStatus =
  | "queued"
  | "uploading"
  | "sent"
  | "failed"
  /** Refused for a permanent reason (corrupted file, unsupported format). */
  | "rejected"
  /** Kept on the device because the album quota is reached (R1). */
  | "waiting_quota";

export interface QueueItem {
  /** Local identifier, stable across page reloads. */
  id: string;
  status: QueueItemStatus;
  attempts: number;
  /** Timestamp (ms) before which the item must not be retried. */
  retryAt: number;
  addedAt: number;
}

export function createQueueItem(id: string, now: number): QueueItem {
  return { id, status: "queued", attempts: 0, retryAt: 0, addedAt: now };
}

/** Items that can start now, oldest first, never exceeding the concurrency limit. */
export function pickNextItems<T extends QueueItem>(
  items: readonly T[],
  now: number,
  maxConcurrent: number = MAX_CONCURRENT_UPLOADS,
): T[] {
  const running = items.filter((i) => i.status === "uploading").length;
  const slots = Math.max(0, maxConcurrent - running);
  return items
    .filter((i) => (i.status === "queued" || i.status === "failed") && i.retryAt <= now)
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, slots);
}

export function markUploading<T extends QueueItem>(item: T): T {
  return { ...item, status: "uploading" };
}

/** The server confirmed the file: it may now be removed from local storage (NF-010). */
export function markSent<T extends QueueItem>(item: T): T {
  return { ...item, status: "sent" };
}

/** Temporary failure (network, expired URL): schedule an exponential retry. */
export function markFailed<T extends QueueItem>(item: T, now: number): T {
  return {
    ...item,
    status: "failed",
    attempts: item.attempts + 1,
    retryAt: now + backoffDelayMs(item.attempts),
  };
}

export function markRejected<T extends QueueItem>(item: T): T {
  return { ...item, status: "rejected" };
}

export function markWaitingQuota<T extends QueueItem>(item: T): T {
  return { ...item, status: "waiting_quota" };
}

/** Back to the queue when the connection returns or the organiser upgrades. */
export function resetForRetry<T extends QueueItem>(item: T): T {
  if (item.status === "sent" || item.status === "rejected") return item;
  return { ...item, status: "queued", retryAt: 0 };
}

export interface QueueSummary {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  rejected: number;
  waitingQuota: number;
}

export function summarizeQueue(items: readonly QueueItem[]): QueueSummary {
  const summary: QueueSummary = {
    total: items.length,
    sent: 0,
    pending: 0,
    failed: 0,
    rejected: 0,
    waitingQuota: 0,
  };
  for (const item of items) {
    if (item.status === "sent") summary.sent += 1;
    else if (item.status === "rejected") summary.rejected += 1;
    else if (item.status === "waiting_quota") summary.waitingQuota += 1;
    else if (item.status === "failed") summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}
