import {
  BETA_GATE,
  conversionRate,
  sendSuccessRate,
  estimateStorageCostCents,
  formatPrice,
  STORAGE_EUR_PER_GB_MONTH,
  storageThresholdBytes,
} from "@snapalbum/shared";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { StatCard } from "@/components/admin/stat-card";
import { getServerEnv } from "@/config/env.server";
import { routing } from "@/i18n/routing";
import { formatBytes } from "@/lib/events";
import { adminOverview } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.overview",
  });
  return { title: t("title") };
}

/** The figures of the platform (F-092) and the storage alert's state (SPEC 9.3). */
export default async function AdminOverviewPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const t = await getTranslations("admin.overview");
  const overview = await adminOverview(createSupabaseAdminClient());
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const threshold = storageThresholdBytes(getServerEnv().STORAGE_ALERT_GB);

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          testId="stat-events"
          label={t("events")}
          value={number.format(overview.events_total)}
          hint={t("events30", { count: number.format(overview.events_30d) })}
        />
        <StatCard
          testId="stat-active"
          label={t("active")}
          value={number.format(overview.events_active)}
          hint={`${t("suspended")} : ${overview.events_suspended} · ${t("pendingDeletion")} : ${overview.events_pending_deletion}`}
        />
        <StatCard
          testId="stat-conversion"
          label={t("conversion")}
          value={percent.format(conversionRate(overview.events_paid, overview.events_total))}
          hint={`${t("paid")} : ${number.format(overview.events_paid)} · ${t("beta")} : ${number.format(overview.events_beta ?? 0)}. ${t("conversionHint")}`}
        />
        <StatCard
          testId="stat-media"
          label={t("media")}
          value={number.format(overview.media_total)}
          hint={t("media30", { count: number.format(overview.media_30d) })}
        />
        <StatCard
          testId="stat-storage"
          label={t("storage")}
          value={formatBytes(overview.bytes_total, locale)}
          hint={
            threshold ? t("alertOn", { threshold: formatBytes(threshold, locale) }) : t("alertOff")
          }
        />
        <StatCard
          testId="stat-cost"
          label={t("cost")}
          value={formatPrice(estimateStorageCostCents(overview.bytes_total), locale)}
          hint={t("costHint", {
            price: new Intl.NumberFormat(locale, {
              style: "currency",
              currency: "EUR",
              maximumFractionDigits: 3,
            }).format(STORAGE_EUR_PER_GB_MONTH),
          })}
        />
        <StatCard
          testId="stat-revenue"
          label={t("revenue")}
          value={formatPrice(overview.revenue_cents, locale)}
          hint={t("revenueHint", {
            paid: overview.purchases_paid,
            refunded: overview.purchases_refunded,
          })}
        />
        <StatCard
          testId="stat-beta-sends"
          label={t("betaSends")}
          value={(() => {
            const rate = sendSuccessRate(
              overview.beta_uploads_delivered,
              overview.beta_uploads_failed,
            );
            return rate === null
              ? "-"
              : new Intl.NumberFormat(locale, {
                  style: "percent",
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(rate);
          })()}
          hint={t("betaSendsHint", {
            delivered: number.format(overview.beta_uploads_delivered),
            failed: number.format(overview.beta_uploads_failed),
            target: new Intl.NumberFormat(locale, {
              style: "percent",
              minimumFractionDigits: 1,
            }).format(BETA_GATE.sendSuccessRate),
          })}
        />
        <StatCard
          testId="stat-organisers"
          label={t("organisers")}
          value={number.format(overview.organisers_total)}
        />
        <StatCard
          testId="stat-reports"
          label={t("reports")}
          value={number.format(overview.open_reports)}
        />
      </div>
    </div>
  );
}
