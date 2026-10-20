import { APP_NAME } from "@snapalbum/shared/brand";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";

export function SiteHeader() {
  const t = useTranslations("layout");

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-3">
        <Link
          href="/"
          aria-label={t("homeLink", { appName: APP_NAME })}
          className="-ml-1 rounded-lg p-1"
        >
          <Logo />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          {/* Account pages arrive in phase 1: until then the button is shown but inactive. */}
          <Button type="button" className="hidden sm:inline-flex">
            {t("createAlbum")}
          </Button>
        </div>
      </div>
    </header>
  );
}
