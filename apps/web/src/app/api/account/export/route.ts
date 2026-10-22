import { APP_NAME } from "@snapalbum/shared/brand";
import { apiError, guarded } from "@/server/api-response";
import { buildAccountExport } from "@/server/account";
import { getOrganiser } from "@/server/auth";
import { ACCOUNT_EXPORT_RATE_LIMIT, checkRateLimit } from "@/server/rate-limit";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * A copy of the signed-in organiser's data, as a JSON file (G-004). Only their own: the person is
 * the one the session says, nothing in the request chooses it. Read-only, so a link is enough.
 */
export function GET() {
  return guarded(async () => {
    const user = await getOrganiser(await createSupabaseServerClient());
    if (!user) return apiError(401, "unauthorized");
    if (!(await checkRateLimit(ACCOUNT_EXPORT_RATE_LIMIT, user.id)).allowed) {
      return apiError(429, "rate_limited");
    }

    const now = new Date();
    const data = await buildAccountExport(createSupabaseAdminClient(), user, now);
    const name = `${APP_NAME.toLowerCase()}-data-${now.toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
