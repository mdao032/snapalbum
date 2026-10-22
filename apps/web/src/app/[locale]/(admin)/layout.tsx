import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/server/auth";

/** The administrator area is private and never listed (F-090). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Pages for the administrator (F-090): anyone else gets a plain "not found". The proxy sends
 * visitors without a session to the login page first; the role is checked here, on every request.
 */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("admin");

  return (
    <PageShell>
      <div className="container-page py-8 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-title">{t("title")}</h1>
            <Link href="/events" className="font-medium text-primary hover:underline">
              {t("backToApp")}
            </Link>
          </header>
          {children}
        </div>
      </div>
    </PageShell>
  );
}
