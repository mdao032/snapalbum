import "server-only";
import type { Database } from "@snapalbum/shared/db-types";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/config/env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Reads the session from cookies and acts as the signed-in user (RLS applies).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy
            // refreshes the session instead, so this can be ignored.
          }
        },
      },
    },
  );
}
