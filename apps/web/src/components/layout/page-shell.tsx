import type { Locale } from "@snapalbum/shared/messages";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { jsonLdScript } from "@/lib/seo";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Standard page frame: skip link, header, main landmark, footer. `actions` replaces the header button. */
export function PageShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const t = useTranslations("layout");
  const tConsent = useTranslations("consent");
  const locale = useLocale() as Locale;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenu"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-full focus-visible:bg-surface focus-visible:px-5 focus-visible:py-3 focus-visible:font-medium focus-visible:shadow-lift"
      >
        {t("skipToContent")}
      </a>
      <SiteHeader actions={actions} />
      <main id="contenu" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
      {/* The banner is a small script served as it is, not part of the bundle (see public/consent). The
          page carries only texts, so it stays the same for everyone and can be cached; the script asks
          `/api/analytics-config` whether a tracker is set up, and does nothing when it is not. */}
      <script
        type="application/json"
        id="consent-config"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            cookiesHref: getPathname({ href: "/legal/cookies", locale }),
            texts: {
              title: tConsent("title"),
              text: tConsent("text"),
              more: tConsent("more"),
              refuse: tConsent("refuse"),
              accept: tConsent("accept"),
            },
          }),
        }}
      />
      <script type="module" src="/consent/entry.js" defer />
    </div>
  );
}
