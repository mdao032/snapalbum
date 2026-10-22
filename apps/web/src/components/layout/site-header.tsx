import { APP_NAME } from "@snapalbum/shared/brand";
import type { Locale } from "@snapalbum/shared/messages";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { howItWorksHref } from "@/lib/home-links";
import { LanguageSwitcher } from "./language-switcher";

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-full px-4 font-medium text-muted-foreground hover:text-foreground";

export function SiteHeader({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("layout");
  const locale = useLocale() as Locale;

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-3">
        <Link
          href="/"
          aria-label={t("homeLink", { appName: APP_NAME })}
          className="-ml-1 rounded-lg p-1"
        >
          {/* With the signed-in menu, the name gives way to the mark on narrow screens. */}
          <Logo nameClassName={actions ? "hidden min-[560px]:inline" : undefined} />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {actions ? null : (
            <nav aria-label={t("navMain")} className="mr-2 hidden items-center gap-1 md:flex">
              <a href={howItWorksHref(locale)} className={NAV_LINK}>
                {t("navHow")}
              </a>
              <Link href="/demo" className={NAV_LINK}>
                {t("navDemo")}
              </Link>
              <Link href="/pricing" className={NAV_LINK}>
                {t("pricingLink")}
              </Link>
            </nav>
          )}
          <LanguageSwitcher />
          {actions ?? (
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/login">{t("createAlbum")}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
