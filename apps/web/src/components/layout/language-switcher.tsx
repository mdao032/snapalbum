"use client";

import { LOCALES } from "@snapalbum/shared/constants";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** FR / EN toggle. Keeps the current page and remembers the choice (next-intl cookie). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("language");
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div
      role="group"
      aria-label={t("label")}
      className={cn("inline-flex rounded-full bg-muted p-1", className)}
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={active}
            onClick={() => router.replace(pathname, { locale })}
            className={cn(
              "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full px-3 text-sm font-semibold uppercase tracking-wide transition-colors duration-200",
              active
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{locale}</span>
            <span className="sr-only">{` ${t(locale)}`}</span>
          </button>
        );
      })}
    </div>
  );
}
