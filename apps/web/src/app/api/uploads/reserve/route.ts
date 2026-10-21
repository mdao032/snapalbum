import { reserveUploadRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import {
  checkRateLimit,
  EVENT_RESERVE_RATE_LIMIT,
  GUEST_RESERVE_RATE_LIMIT,
} from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { reserveUpload } from "@/server/uploads";

/** Reserves an upload slot and returns the signed addresses (SPEC 8.1, step 3). */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, reserveUploadRequestSchema);
    if (!body.ok) return body.response;

    for (const [rule, identifier] of [
      [GUEST_RESERVE_RATE_LIMIT, user.id],
      [EVENT_RESERVE_RATE_LIMIT, body.data.eventCode],
    ] as const) {
      const limit = await checkRateLimit(rule, identifier);
      if (!limit.allowed) {
        return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
      }
    }

    const result = await reserveUpload(
      { admin: createSupabaseAdminClient(), storage: getStorage() },
      user,
      body.data,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
