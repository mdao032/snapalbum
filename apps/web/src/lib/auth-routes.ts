import { stripLocalePrefix } from "@snapalbum/shared";

/** Pages reserved to signed-in organisers: the `(app)` route group, without the language prefix. */
const APP_PREFIXES = ["/account", "/events"] as const;
/** Pages reserved to administrators: the `(admin)` route group. The role check lives in the page. */
const ADMIN_PREFIXES = ["/admin"] as const;

export type ProtectedArea = "app" | "admin";

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Which protected area a request path belongs to, or null for a public page. */
export function protectedAreaOf(pathname: string): ProtectedArea | null {
  const path = stripLocalePrefix(pathname);
  if (ADMIN_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return "admin";
  if (APP_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return "app";
  return null;
}

/** Cookies written by `@supabase/ssr`: their presence means a session may need refreshing. */
export function hasSupabaseSessionCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}
