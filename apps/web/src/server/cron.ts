import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/config/env.server";

/** The scheduled tasks (SPEC 9.2, 14), named as in `vercel.json`. */
export const CRON_TASKS = ["expire-events", "reminders", "cleanup-uploads", "daily-recap"] as const;
export type CronTask = (typeof CRON_TASKS)[number];

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether a call comes from the scheduler: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 * The comparison takes the same time whatever the guess, and without a secret configured nobody
 * is ever let in: a forgotten variable must close the door, not open it.
 */
export function isCronRequest(request: Request): boolean {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return false;
  const sent = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  return timingSafeEqual(digest(sent), digest(secret));
}
