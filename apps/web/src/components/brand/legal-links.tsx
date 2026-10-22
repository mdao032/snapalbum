import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Terms of use and privacy policy, at the bottom of the pages a guest sees. Plain links and no
 * import of the navigation helpers: they would load a client chunk (NF-002). They open in a new tab
 * so that a guest in the middle of an upload never leaves the page.
 */
export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations("layout");
  const locale = useLocale();
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const link =
    "inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-muted-foreground hover:underline";

  return (
    <nav
      aria-label={t("footerLegal")}
      className={cn("flex flex-wrap justify-center gap-x-2", className)}
    >
      <a href={`${prefix}/legal/terms`} target="_blank" rel="noopener" className={link}>
        {t("legalTerms")}
      </a>
      <a href={`${prefix}/legal/privacy`} target="_blank" rel="noopener" className={link}>
        {t("legalPrivacy")}
      </a>
    </nav>
  );
}
