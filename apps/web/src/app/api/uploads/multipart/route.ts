import { multipartRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { getRequestUser } from "@/server/request-user";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { multipartAction } from "@/server/uploads";

/** Sending a large video in parts: create, sign a part, list, assemble or abort (NF-013). */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, multipartRequestSchema);
    if (!body.ok) return body.response;

    const result = await multipartAction(
      { admin: createSupabaseAdminClient(), storage: getStorage() },
      user,
      body.data,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
