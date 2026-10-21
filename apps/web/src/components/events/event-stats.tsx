import type { EventUsage } from "@snapalbum/shared";
import { Camera, HardDrive, Users, Video } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/events";
import { cn } from "@/lib/utils";
import type { EventStats } from "@/server/events";

const BAR_COLORS = {
  ok: "bg-primary",
  warning: "bg-warm",
  full: "bg-danger",
} as const;

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-muted/60 p-4">
      <span
        className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4"
        aria-hidden
      >
        {icon}
      </span>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Dashboard counters and quota bar (F-018). */
export function EventStatsPanel({ stats, usage }: { stats: EventStats; usage: EventUsage }) {
  const t = useTranslations("dashboard.stats");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">{t("title")}</h2>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile icon={<Camera />} label={t("photos")} value={number.format(stats.photos)} />
          <Tile icon={<Video />} label={t("videos")} value={number.format(stats.videos)} />
          <Tile icon={<Users />} label={t("guests")} value={number.format(stats.guests)} />
          <Tile
            icon={<HardDrive />}
            label={t("space")}
            value={formatBytes(stats.bytesUsed, locale)}
          />
        </dl>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">{t("quotaTitle")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("quotaUsed", {
                used: number.format(usage.used),
                quota: number.format(usage.quota),
              })}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={t("progressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.percent}
            className="h-3 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                BAR_COLORS[usage.level],
              )}
              style={{ width: `${usage.percent}%` }}
            />
          </div>
          <p className="text-sm font-medium">
            {t("quotaRemaining", { remaining: usage.remaining })}
          </p>
          {usage.videoQuota !== null ? (
            <p className="text-sm text-muted-foreground">
              {t("videoLimit", { max: usage.videoQuota })}
            </p>
          ) : null}
          {usage.level === "warning" ? <Alert tone="error">{t("warning")}</Alert> : null}
          {usage.level === "full" ? <Alert tone="error">{t("full")}</Alert> : null}
        </div>
      </div>
    </Card>
  );
}
