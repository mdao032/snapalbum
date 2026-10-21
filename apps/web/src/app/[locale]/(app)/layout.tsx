import { CalendarDays, LogOut, UserRound } from "lucide-react";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { clientMessagesFor } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireOrganiser } from "@/server/auth";
import { signOutAction } from "./actions";

/** Pages for signed-in organisers (F-001): every page below is private. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireOrganiser(locale);
  const t = await getTranslations("nav");
  const tAccount = await getTranslations("account");

  return (
    <NextIntlClientProvider
      messages={clientMessagesFor(locale, ["account", "events", "share", "dashboard", "apiErrors"])}
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
        {children}
      </PageShell>
    </NextIntlClientProvider>
  );
}
