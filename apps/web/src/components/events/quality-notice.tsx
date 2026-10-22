import { getPlan } from "@snapalbum/shared/plans";
import { Info } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * What the free plan does to the photos, said plainly (F-045): optimised versions only, originals
 * with the Event plan. Shown where the organiser decides (creation), looks at the photos
 * (moderation) and reads about the plans, so no loss of quality is ever hidden.
 */
export async function QualityNotice({ compact = false }: { compact?: boolean }) {
  const t = await getTranslations("plans");
  const locale = await getLocale();
  const px = getPlan("free").displayMaxPx;

  return (
    <aside
      className="flex items-start gap-3 rounded-2xl bg-muted/70 px-4 py-3 text-sm"
      data-testid="quality-notice"
    >
      <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t("qualityLine")}</p>
        {compact ? null : (
          <p className="text-muted-foreground">
            {t("qualityNoticeDetail", { px: new Intl.NumberFormat(locale).format(px) })}
          </p>
        )}
        <Link href="/pricing" className="self-start font-medium text-primary hover:underline">
          {t("seeOffers")}
        </Link>
      </div>
    </aside>
  );
}
