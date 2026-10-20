import "server-only";
import type { Database } from "@snapalbum/shared/db-types";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/config/env";
import { getServerEnv } from "@/config/env.server";

/**
 * Administrator client using the service role key: it BYPASSES RLS.
 * Use it only in trusted server code (cron jobs, webhooks, purges) and always check the
 * caller's rights before. Never import it from client code (`server-only` enforces it).
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
