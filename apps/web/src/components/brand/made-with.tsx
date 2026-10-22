import { APP_NAME } from "@snapalbum/shared/brand";
import type { WatermarkMode } from "@snapalbum/shared/plans";
import { useLocale, useTranslations } from "next-intl";
import { LogoMark } from "@/components/brand/logo";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * The "Made with" notice of the plan (`plans.ts`, `watermark`): visible on the free plan, discreet
 * on the event plan, absent on the white-label plan. A server component with no script of its own,
 * not even a client-side link, so it adds nothing to the weight of the guest page (NF-002). The link opens in a new tab: a guest
 * in the middle of an upload never leaves the page by accident.
 */
export function MadeWith({ mode, className }: { mode: WatermarkMode; className?: string }) {
  const t = useTranslations("layout");
  const locale = useLocale();
  if (mode === "none") return null;

  const label = t("madeWith", { appName: APP_NAME });
  return (
    <p className={cn("flex justify-center", className)} data-testid="made-with" data-mode={mode}>
      {/* A plain link, and no import of the navigation helpers: they would load a client chunk (NF-002). */}
      <a
        href={locale === routing.defaultLocale ? "/" : `/${locale}`}
        target="_blank"
        rel="noopener"
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:underline",
          mode === "visible"
            ? "text-base font-medium text-foreground"
            : "text-sm text-muted-foreground",
        )}
      >
        {mode === "visible" ? <LogoMark className="size-6" /> : null}
        {label}
      </a>
    </p>
  );
}
