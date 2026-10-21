import { defaultAfterLoginPath, sanitizeRedirectPath } from "@snapalbum/shared";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Where every sign-in ends (F-001, F-002). The e-mail link brings a `token_hash` (works from any
 * device or browser), Google brings a `code` (same browser as the request). Both become a session
 * cookie, then the visitor continues to the page they asked for.
 */
const querySchema = z.object({
  token_hash: z.string().min(1).max(512).optional(),
  type: z.literal("email").optional(),
  code: z.string().min(1).max(512).optional(),
  next: z.string().max(512).optional(),
  locale: z.enum(routing.locales).default(routing.defaultLocale),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const query = parsed.success ? parsed.data : { locale: routing.defaultLocale };
  const next = sanitizeRedirectPath(
    "next" in query ? query.next : undefined,
    defaultAfterLoginPath(query.locale),
  );
  const supabase = await createSupabaseServerClient();

  let failure: "link_expired" | "oauth_failed" = "link_expired";
  if ("token_hash" in query && query.token_hash && query.type === "email") {
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: query.token_hash,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  } else if ("code" in query && query.code) {
    failure = "oauth_failed";
    const { error } = await supabase.auth.exchangeCodeForSession(query.code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const login = getPathname({
    locale: query.locale,
    href: { pathname: "/login", query: { error: failure, next } },
  });
  return NextResponse.redirect(new URL(login, request.url));
}
