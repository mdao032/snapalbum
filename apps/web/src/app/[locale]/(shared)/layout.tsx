import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { clientMessagesFor } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";

/** Read-only album seen through a share link (F-054): no header, the album is the page. */
export default async function SharedLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <NextIntlClientProvider
      messages={clientMessagesFor(locale, ["gallery", "apiErrors"], ["layout"])}
    >
      <main id="contenu" className="bg-aurora mx-auto flex min-h-dvh w-full max-w-6xl flex-col">
        {children}
      </main>
    </NextIntlClientProvider>
  );
}
