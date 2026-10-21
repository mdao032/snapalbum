import { shortLinkCodeOf } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/config/env";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { hasSupabaseSessionCookie, protectedAreaOf } from "@/lib/auth-routes";

const handleI18nRouting = createMiddleware(routing);

function localeOf(request: NextRequest): (typeof routing.locales)[number] {
  const first = request.nextUrl.pathname.split("/")[1];
  return routing.locales.find((locale) => locale === first) ?? routing.defaultLocale;
}

// Next.js 16 renamed `middleware` to `proxy`. It routes by language, keeps the Supabase session
// fresh and sends visitors without an organiser session away from protected pages (F-001).
export default async function proxy(request: NextRequest) {
  // A printed QR code: `/{code}` is looked up by `/s/{code}`, which sends the guest to the event page.
  const shortCode = shortLinkCodeOf(request.nextUrl.pathname);
  if (shortCode) return NextResponse.rewrite(new URL(`/s/${shortCode}`, request.url));

  const response = handleI18nRouting(request);
  // Language redirects (`/` to `/en`) are final; the guard runs on the next request.
  if (response.status >= 300 && response.status < 400) return response;

  const area = protectedAreaOf(request.nextUrl.pathname);
  const hasSession = hasSupabaseSessionCookie(request.cookies.getAll().map(({ name }) => name));
  if (!area && !hasSession) return response;

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        // A refreshed session must reach both the page being rendered and the browser.
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Verifies the token (and refreshes it when it expired). Pages and actions re-check with `getUser`.
  const { data } = await supabase.auth.getClaims();
  const signedInOrganiser = Boolean(data?.claims) && data?.claims.is_anonymous !== true;

  if (area && !signedInOrganiser) {
    const { pathname, search } = request.nextUrl;
    const login = getPathname({
      locale: localeOf(request),
      href: { pathname: "/login", query: { next: `${pathname}${search}` } },
    });
    return NextResponse.redirect(new URL(login, request.url));
  }
  return response;
}

export const config = {
  // Everything except API routes, the sign-in return and short link routes, Next.js internals and static files.
  matcher: ["/((?!api|auth/|s/|_next|_vercel|.*\\..*).*)"],
};
