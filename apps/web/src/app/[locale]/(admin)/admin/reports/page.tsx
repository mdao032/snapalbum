import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { ReportCard } from "@/components/admin/report-card";
import { Alert } from "@/components/ui/alert";
import { routing } from "@/i18n/routing";
import { listOpenReports } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/reports">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.reports",
  });
  return { title: t("title") };
}

/** Every open report of the platform, oldest first, with what can be done about each (F-090, F-091). */
export default async function AdminReportsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/reports">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const outcome = await searchParams;
  const t = await getTranslations("admin.reports");
  const reports = await listOpenReports(createSupabaseAdminClient(), getStorage());

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/reports" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {outcome.done ? <Alert tone="success">{t("done")}</Alert> : null}
      {outcome.failed ? <Alert tone="error">{t("failed")}</Alert> : null}
      {reports.length === 0 ? (
        <p data-testid="admin-no-reports">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reports.map((report) => (
            <li key={report.mediaId}>
              <ReportCard report={report} returnTo="/admin/reports" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
