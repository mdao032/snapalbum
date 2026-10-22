import { APP_NAME } from "@snapalbum/shared/brand";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";

export function SiteFooter() {
  const t = useTranslations("layout");

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="container-page flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">{t("footerTagline")}</p>
        </div>
        <nav aria-label={t("footerNav")} className="flex flex-col gap-1 sm:items-end">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center font-medium hover:underline"
          >
            {t("pricingLink")}
          </Link>
        </nav>
        <p className="text-sm text-muted-foreground">
          {t("copyright", { year: new Date().getFullYear(), appName: APP_NAME })}
        </p>
      </div>
    </footer>
  );
}
