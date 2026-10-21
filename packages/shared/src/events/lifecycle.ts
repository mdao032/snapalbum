import { DELETION_GRACE_DAYS } from "../plans";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an event asked for deletion is purged for good (R5). */
export function purgeDeadline(deletedAt: string | Date): Date {
  const start = typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt.getTime();
  return new Date(start + DELETION_GRACE_DAYS * DAY_MS);
}

interface DeletionState {
  status: string;
  deleted_at: string | null;
}

/** An event can be deleted unless a deletion is already pending or the event is suspended. */
export function canRequestDeletion(event: DeletionState): boolean {
  return event.status === "active";
}

/** A pending deletion can be cancelled until the deadline (R5). */
export function canCancelDeletion(event: DeletionState, now: Date): boolean {
  return (
    event.status === "pending_deletion" &&
    event.deleted_at !== null &&
    now.getTime() < purgeDeadline(event.deleted_at).getTime()
  );
}
