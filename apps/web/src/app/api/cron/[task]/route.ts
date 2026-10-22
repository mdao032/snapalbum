import { apiError, apiJson, guarded } from "@/server/api-response";
import { CRON_TASKS, isCronRequest, type CronTask } from "@/server/cron";
import { getMailer } from "@/server/email/mailer";
import { cleanupUploads, expireEvents, purgeDueEvents } from "@/server/lifecycle";
import { runDailyRecap, sendExpiryReminders } from "@/server/notifications";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/** A purge of many albums can take a while: the platform's longest allowance. */
export const maxDuration = 300;

/**
 * The scheduled tasks (SPEC 9.2, 14), called by the scheduler of `vercel.json` with the shared
 * secret. Each is safe to run twice: expiry and purge only touch what is due, and every e-mail is
 * logged so it goes out once.
 */
export function GET(request: Request, context: { params: Promise<{ task: string }> }) {
  return guarded(async () => {
    // The secret first: nobody learns which tasks exist without it.
    if (!isCronRequest(request)) return apiError(401, "unauthorized");
    const { task } = await context.params;
    if (!(CRON_TASKS as readonly string[]).includes(task)) return apiError(404, "not_found");

    const admin = createSupabaseAdminClient();
    switch (task as CronTask) {
      case "expire-events": {
        const storage = getStorage();
        const expired = await expireEvents({ admin, storage });
        const purge = await purgeDueEvents({ admin, storage });
        return apiJson({ task, expired: expired.expired.length, ...purge });
      }
      case "cleanup-uploads":
        return apiJson({ task, ...(await cleanupUploads({ admin, storage: getStorage() })) });
      case "reminders":
        return apiJson({ task, ...(await sendExpiryReminders({ admin, mailer: getMailer() })) });
      case "daily-recap":
        return apiJson({ task, ...(await runDailyRecap({ admin, mailer: getMailer() })) });
    }
  });
}
