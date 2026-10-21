import { galleryRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { clientIpFrom } from "@/server/client-ip";
import { gallery } from "@/server/gallery";
import { checkRateLimit, GALLERY_RATE_LIMIT } from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * The album (F-039, F-050 to F-054): a page of thumbnails, fresh addresses, or the files of the
 * viewer. A guest identifies with their session; the holder of a share link needs none, so a
 * request that names a share link never requires one.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const body = await parseBody(request, galleryRequestSchema);
    if (!body.ok) return body.response;

    const user = body.data.access.type === "share" ? null : await getRequestUser(request);
    if (body.data.access.type === "event" && !user) return apiError(401, "unauthorized");

    const key = user?.id ?? clientIpFrom(request.headers) ?? "unknown";
    const limit = await checkRateLimit(GALLERY_RATE_LIMIT, key);
    if (!limit.allowed) {
      return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    const result = await gallery(
      { admin: createSupabaseAdminClient(), storage: getStorage() },
      user,
      body.data,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
