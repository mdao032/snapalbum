import { feedbackRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { submitFeedback } from "@/server/feedback";
import { checkRateLimit, FEEDBACK_RATE_LIMIT } from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * Feedback (step 6.2), from an organiser or from a guest. Requires a session
 * (the guest's anonymous one counts); the server checks that the author belongs to the event.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, feedbackRequestSchema);
    if (!body.ok) return body.response;

    const limit = await checkRateLimit(FEEDBACK_RATE_LIMIT, user.id);
    if (!limit.allowed) {
      return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    const result = await submitFeedback(createSupabaseAdminClient(), user, body.data);
    return result.ok ? apiJson({ ok: true }) : apiError(result.status, result.code);
  });
}
