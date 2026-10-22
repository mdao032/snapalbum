import { APP_NAME, BRAND_COLORS } from "@snapalbum/shared/brand";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { clientEnv } from "@/config/env";
import { clientMessagesFor } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "metadata",
  });
  return {
    metadataBase: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
    title: { default: t("title", { appName: APP_NAME }), template: `%s · ${APP_NAME}` },
    description: t("description"),
    applicationName: APP_NAME,
  };
}

export const viewport: Viewport = {
  themeColor: BRAND_COLORS.canvas,
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={GeistSans.variable}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider messages={clientMessagesFor(locale)}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
