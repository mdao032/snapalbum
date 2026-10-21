import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Standard page frame: skip link, header, main landmark, footer. `actions` replaces the header button. */
export function PageShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const t = useTranslations("layout");

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
    </div>
  );
}
