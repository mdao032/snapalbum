import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { clientMessagesFor } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";

/** Private areas (accounts, albums): never listed by search engines (step 5.1). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <NextIntlClientProvider messages={clientMessagesFor(locale, ["auth", "apiErrors"])}>
      <PageShell>
        <div className="bg-aurora flex flex-1 items-center justify-center py-10 sm:py-16">
          <div className="container-page flex justify-center">
            <div className="w-full max-w-md">{children}</div>
          </div>
        </div>
      </PageShell>
    </NextIntlClientProvider>
  );
}
