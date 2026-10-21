import { completeUploadRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { getRequestUser } from "@/server/request-user";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { completeUpload } from "@/server/uploads";

/** Confirms an upload: the files are checked in the storage, then the media becomes ready. */
export function POST(request: Request) {
  return guarded(async () => {
    const user = await getRequestUser(request);
    if (!user) return apiError(401, "unauthorized");

    const body = await parseBody(request, completeUploadRequestSchema);
    if (!body.ok) return body.response;

    const result = await completeUpload(
      { admin: createSupabaseAdminClient(), storage: getStorage() },
      user,
      body.data.mediaId,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
