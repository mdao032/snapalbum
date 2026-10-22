import { APP_NAME } from "@snapalbum/shared/brand";
import type { Plan } from "@snapalbum/shared/plans";
import { Check } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDuration } from "@/lib/plan-format";
import { formatBytes } from "@/lib/events";

/**
 * What a plan includes, written from `plans.ts` alone: nothing here is typed in by hand, so the
 * pricing page, the dashboard and the server can never disagree (SPEC 3).
 */
export async function planFeatureLines(plan: Plan): Promise<string[]> {
  const t = await getTranslations("pricing.features");
  const locale = await getLocale();
  const number = new Intl.NumberFormat(locale);
  const duration = formatDuration(plan.maxVideoSeconds, locale);

  const retention = plan.retention;
  return [
    t(plan.id === "free" ? "media" : "mediaReasonable", { count: number.format(plan.maxMedia) }),
    t("guests"),
    plan.maxVideos === null
      ? t("videos", { duration, size: formatBytes(plan.maxVideoBytes, locale) })
      : t("videosLimited", { count: plan.maxVideos, duration }),
    plan.keepsOriginals
      ? t("qualityPaid")
      : t("qualityFree", { px: number.format(plan.displayMaxPx) }),
    retention.kind === "days_after_event"
      ? t("retentionDays", { days: retention.days })
      : retention.kind === "months_after_purchase"
        ? t("retentionMonths", { months: retention.months })
        : t("retentionSubscribed", { days: retention.graceDays }),
    t("live"),
    plan.zipContains === "originals" ? t("zipOriginals") : t("zipDisplay"),
    plan.watermark === "visible"
      ? t("watermarkVisible", { appName: APP_NAME })
      : plan.watermark === "discreet"
        ? t("watermarkDiscreet", { appName: APP_NAME })
        : t("watermarkNone"),
    plan.maxActiveEvents === null ? t("manyActiveEvents") : t("oneActiveEvent"),
  ];
}

export async function PlanFeatureList({ plan }: { plan: Plan }) {
  const lines = await planFeatureLines(plan);
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
