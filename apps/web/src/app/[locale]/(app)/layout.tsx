import type { Metadata } from "next";
import { CalendarDays, LogOut, UserRound } from "lucide-react";
import { purgeAfter } from "@snapalbum/shared";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { clientMessagesFor } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatInstantDate } from "@/lib/events";
import { getProfile, requireOrganiser } from "@/server/auth";
import { signOutAction } from "./actions";

/** Private areas (accounts, albums): never listed by search engines (step 5.1). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Pages for signed-in organisers (F-001): every page below is private. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { supabase, user } = await requireOrganiser(locale);
  const profile = await getProfile(supabase, user.id);
  const t = await getTranslations("nav");
  const tAccount = await getTranslations("account");
  const tDelete = await getTranslations("account.delete");

  return (
    <NextIntlClientProvider
      messages={clientMessagesFor(locale, [
        "account",
        "events",
        "share",
        "dashboard",
        "moderation",
        "apiErrors",
      ])}
    >
      <PageShell
        actions={
          <nav aria-label={t("primary")} className="flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" className="px-3 sm:px-5">
              <Link href="/events">
                <CalendarDays aria-hidden />
                <span className="sr-only sm:not-sr-only">{t("events")}</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" className="px-3 sm:px-5">
              <Link href="/account">
                <UserRound aria-hidden />
                <span className="sr-only sm:not-sr-only">{t("account")}</span>
              </Link>
            </Button>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" className="px-3 sm:px-5">
                <LogOut aria-hidden />
                <span className="sr-only sm:not-sr-only">{tAccount("signOut")}</span>
              </Button>
            </form>
          </nav>
        }
      >
        {profile?.deleted_at ? (
          <div
            role="status"
            data-testid="account-deletion-banner"
            className="bg-danger-soft px-4 py-3 text-center text-sm font-medium text-danger"
          >
            {tDelete("banner", {
              date: formatInstantDate(purgeAfter(profile.deleted_at), locale),
            })}{" "}
            <Link href="/account" className="underline">
              {tDelete("bannerLink")}
            </Link>
          </div>
        ) : null}
        {children}
      </PageShell>
    </NextIntlClientProvider>
  );
}
