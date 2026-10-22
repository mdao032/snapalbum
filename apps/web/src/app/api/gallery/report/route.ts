import { reportRequestSchema } from "@snapalbum/shared";
import { getServerEnv } from "@/config/env.server";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { clientIpFrom } from "@/server/client-ip";
import { resolveGalleryAccess } from "@/server/gallery";
import { reporterFingerprint, reportMedia } from "@/server/moderation";
import { checkRateLimit, REPORT_RATE_LIMIT } from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * A visitor of the album reports a photo (F-073): a guest with their session, or the holder of a
 * share link with none. One report per person and photo.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const body = await parseBody(request, reportRequestSchema);
    if (!body.ok) return body.response;

    const user = body.data.access.type === "share" ? null : await getRequestUser(request);
    if (body.data.access.type === "event" && !user) return apiError(401, "unauthorized");

    const fingerprint = reporterFingerprint(getServerEnv().SUPABASE_SERVICE_ROLE_KEY, {
      userId: user?.id,
      ip: clientIpFrom(request.headers),
    });
    const limit = await checkRateLimit(REPORT_RATE_LIMIT, fingerprint);
    if (!limit.allowed) {
      return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    const admin = createSupabaseAdminClient();
    const access = await resolveGalleryAccess(admin, user, body.data.access);
    if (!access.ok) return apiError(access.status, access.code);

    const result = await reportMedia(
      admin,
      access.body.eventId,
      fingerprint,
      body.data.mediaId,
      body.data.reason,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
