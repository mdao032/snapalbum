import { myMediaRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { getRequestUser } from "@/server/request-user";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { myMedia } from "@/server/uploads";

/** The guest's own uploads, and deleting one of them (F-038, G-005). */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, myMediaRequestSchema);
    if (!body.ok) return body.response;

    const result = await myMedia(
      { admin: createSupabaseAdminClient(), storage: getStorage() },
      user,
      body.data,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
