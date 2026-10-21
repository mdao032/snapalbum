import "server-only";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/config/env";
import { createSupabaseServerClient } from "./supabase/server";

export interface RequestUser {
  id: string;
  isAnonymous: boolean;
}

/**
 * Who calls an API route: the web sends its session cookie, the mobile apps and the App Clip send
 * `Authorization: Bearer <access token>` (`packages/shared` API client). Either way the token is
 * checked with the Auth server (`getUser`), never just decoded, so it cannot be forged.
 */
export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const header = request.headers.get("authorization");
  const token = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1];

  const client = token
    ? createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : await createSupabaseServerClient();

  const { data, error } = token ? await client.auth.getUser(token) : await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}
