import { APP_NAME } from "@snapalbum/shared/brand";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DemoExperience } from "@/components/marketing/demo/demo-experience";
import { clientEnv } from "@/config/env";
import { clientMessagesFor } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/demo">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "demo" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: pageAlternates(clientEnv.NEXT_PUBLIC_SITE_URL, locale, { kind: "demo" }),
    openGraph: {
      type: "website",
      siteName: APP_NAME,
      title: t("metaTitle"),
      description: t("metaDescription"),
    },
  };
}

/**
 * A public demonstration of the guest page, with no account and no way to write anywhere: it is
 * played in the browser with sample drawings, never with a real event (decisions.md, step 5.1).
 */
export default async function DemoPage({ params }: PageProps<"/[locale]/demo">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("demo");

  return (
    <div className="container-page flex flex-col gap-10 py-12 sm:py-16">
      <header className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
        <h1 className="text-display text-balance">{t("title")}</h1>
        <p className="text-lead text-pretty text-muted-foreground">{t("intro")}</p>
      </header>
      <NextIntlClientProvider messages={clientMessagesFor(locale, ["demo"])}>
        <DemoExperience />
      </NextIntlClientProvider>
    </div>
  );
}
