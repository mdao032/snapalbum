import { DELETION_GRACE_DAYS, EXPIRY_REMINDER_DAYS } from "../plans";
import { eventOverAt } from "./guest-phase";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The recap of the day after is not sent for an event that is long over (a task that was down). */
export const RECAP_MAX_AGE_DAYS = 7;

/** Name under which a reminder is logged, so each is sent once per event (`email_log`). */
export function reminderKind(days: number): string {
  return `expiry_reminder_${days}`;
}

/**
 * The expiry reminder to send now, if any (R3): J-7 and J-1 before the album closes. When several
 * are due (the task was down for days) only the most imminent is sent: a "7 days left" message
 * with one day left would be wrong. The date it states is the closing date, so a late reminder
 * is still true.
 */
export function dueReminderDays(expiresAt: Date | string, now: Date): number | null {
  const expires = typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  if (now.getTime() >= expires) return null;
  const due = EXPIRY_REMINDER_DAYS.filter((days) => now.getTime() >= expires - days * DAY_MS);
  return due.length > 0 ? Math.min(...due) : null;
}

/** When the recap of the day after (SPEC 14) and the default "album ready" e-mail become due. */
export function nextDayAt(eventDate: string): Date {
  return eventOverAt(eventDate);
}

/** True when the recap for the organiser should go out: the party is over, and not long ago. */
export function isRecapDue(eventDate: string, now: Date): boolean {
  const over = nextDayAt(eventDate).getTime();
  return now.getTime() >= over && now.getTime() < over + RECAP_MAX_AGE_DAYS * DAY_MS;
}

/**
 * When the guests who asked for it get the album link (F-044): as soon as the organiser declares
 * the album ready, otherwise the day after the event.
 */
export function albumReadyDueAt(event: { eventDate: string; readyAt?: string | null }): Date {
  const over = nextDayAt(event.eventDate).getTime();
  const ready = event.readyAt ? Date.parse(event.readyAt) : Infinity;
  return new Date(Math.min(over, ready));
}

/** The moment an expired album, or a deleted one, is purged for good (R5, SPEC 9.2). */
export function purgeAfter(deletedAt: string | Date): Date {
  const start = typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt.getTime();
  return new Date(start + DELETION_GRACE_DAYS * DAY_MS);
}
