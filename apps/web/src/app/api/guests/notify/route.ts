import { notifyRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { setNotifyEmail } from "@/server/guests";
import { checkRateLimit, NOTIFY_RATE_LIMIT } from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * A guest leaves an e-mail address, with a consent of its own, to be told when the album is ready
 * (F-044), or takes it back. Requires the guest's session: nobody can register an address for
 * someone else's session.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, notifyRequestSchema);
    if (!body.ok) return body.response;

    const limit = await checkRateLimit(NOTIFY_RATE_LIMIT, user.id);
    if (!limit.allowed) {
      return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    const result = await setNotifyEmail(createSupabaseAdminClient(), user, body.data);
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
