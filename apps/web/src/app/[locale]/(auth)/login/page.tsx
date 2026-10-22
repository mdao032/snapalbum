import { defaultAfterLoginPath, loginErrorSchema, sanitizeRedirectPath } from "@snapalbum/shared";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { LoginForm } from "@/components/auth/login-form";
import { clientEnv } from "@/config/env";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getOrganiser } from "@/server/auth";
import { createSupabaseServerClient } from "@/server/supabase/server";

const searchSchema = z.object({
  next: z.string().max(512).optional(),
  error: loginErrorSchema.optional(),
});

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "auth.login",
  });
  // A page with no content for search engines: it only leads to a private space.
  return { title: t("title"), robots: { index: false } };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const rawSearch = await searchParams;
  const search = searchSchema.safeParse({
    next: typeof rawSearch.next === "string" ? rawSearch.next : undefined,
    error: typeof rawSearch.error === "string" ? rawSearch.error : undefined,
  });
  const { next, error } = search.success ? search.data : { next: undefined, error: undefined };
  const target = sanitizeRedirectPath(next, defaultAfterLoginPath(locale));

  // Someone already signed in has nothing to do here.
  const user = await getOrganiser(await createSupabaseServerClient());
  if (user) redirect(target);

  const t = await getTranslations("auth.login");

  return (
    <div className="flex flex-col gap-4">
      <LoginForm
        locale={locale}
        next={next ? target : undefined}
        initialError={error}
        googleEnabled={clientEnv.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === true}
        turnstileSiteKey={clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
      <p className="px-2 text-center text-sm text-muted-foreground">
        {t.rich("legal", {
          terms: (chunks) => (
            <Link href="/legal/terms" className="underline hover:text-foreground">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/legal/privacy" className="underline hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
