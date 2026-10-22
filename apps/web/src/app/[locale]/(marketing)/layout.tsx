import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { routing } from "@/i18n/routing";

export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Every layout and page sets the language itself: they render in parallel, and a component that
  // has to look it up in the request headers makes the whole page dynamic (nothing cached).
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <PageShell>{children}</PageShell>;
}
