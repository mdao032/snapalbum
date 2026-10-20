import type { Database } from "@snapalbum/shared/db-types";
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/config/env";

/**
 * Supabase client for the browser (organiser session and anonymous guest session).
 * Uses the public anon key only: access is limited by RLS.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
