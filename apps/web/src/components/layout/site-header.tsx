import { APP_NAME } from "@snapalbum/shared/brand";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";

export function SiteHeader({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("layout");

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
