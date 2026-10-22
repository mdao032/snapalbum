import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { clientMessagesFor } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";

/** Private areas (accounts, albums): never listed by search engines (step 5.1). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The live slideshow: the whole screen, no header, nothing but the photos. */
export default async function LiveLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <NextIntlClientProvider messages={clientMessagesFor(locale, ["live", "apiErrors"], ["layout"])}>
      <main id="contenu" className="min-h-dvh bg-black text-white">
        {children}
      </main>
    </NextIntlClientProvider>
  );
}
