import { APP_NAME } from "@snapalbum/shared/brand";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import { howItWorksHref } from "@/lib/home-links";
import { LEGAL_PAGES } from "@/lib/legal";
import { USAGES, usageSlug } from "@/lib/usages";

const LINK = "inline-flex min-h-11 items-center hover:underline";

export function SiteFooter() {
  const t = useTranslations("layout");
  const tUsages = useTranslations("usages.common.names");
  const locale = useLocale() as "fr" | "en";
  const legalLabels = {
    notice: t("legalNotice"),
    terms: t("legalTerms"),
    sales: t("legalSales"),
    privacy: t("legalPrivacy"),
    cookies: t("legalCookies"),
  } satisfies Record<(typeof LEGAL_PAGES)[number], string>;

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="container-page flex flex-col gap-8 py-10 md:flex-row md:justify-between">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">{t("footerTagline")}</p>
          <p className="text-sm text-muted-foreground">
            {t("copyright", { year: new Date().getFullYear(), appName: APP_NAME })}
          </p>
        </div>
        <nav aria-label={t("footerNav")} className="grid gap-8 sm:grid-cols-3 md:gap-12">
          <div className="flex flex-col">
            <p className="font-semibold">{t("footerProduct")}</p>
            <a href={howItWorksHref(locale)} className={LINK}>
              {t("navHow")}
            </a>
            <Link href="/demo" className={LINK}>
              {t("navDemo")}
            </Link>
            <Link href="/pricing" className={LINK}>
              {t("pricingLink")}
            </Link>
          </div>
          <div className="flex flex-col">
            <p className="font-semibold">{t("footerUses")}</p>
            {USAGES.map((usage) => (
              <Link key={usage} href={`/usages/${usageSlug(locale, usage)}`} className={LINK}>
                {tUsages(usage)}
              </Link>
            ))}
          </div>
          <div className="flex flex-col">
            <p className="font-semibold">{t("footerLegal")}</p>
            {LEGAL_PAGES.map((page) => (
              <Link key={page} href={`/legal/${page}`} className={LINK}>
                {legalLabels[page]}
              </Link>
            ))}
            {/* Hidden until the banner's script finds that a tracker is set up: with none there is
                nothing to choose. A plain button: the script listens for clicks on it. */}
            <button type="button" data-manage-cookies hidden className={`${LINK} text-left`}>
              {t("manageCookies")}
            </button>
          </div>
        </nav>
      </div>
    </footer>
  );
}
