import type { PlanId } from "@snapalbum/shared";
import { messages } from "@snapalbum/shared/messages";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { Cell, DataTable } from "@/components/admin/data-table";
import { Pager } from "@/components/admin/pager";
import { SearchForm } from "@/components/admin/search-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { eventDisplayStatus, formatBytes, formatEventDate } from "@/lib/events";
import { listAdminEvents } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/events">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.events",
  });
  return { title: t("title") };
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** Every event of the platform, searchable by title, code or organiser (F-090). */
export default async function AdminEventsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/events">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const raw = await searchParams;
  const query = one(raw.q).trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(one(raw.page), 10) || 1);

  const t = await getTranslations("admin.events");
  const tStatus = await getTranslations("events.status");
  const tPlans = await getTranslations("plans.names");
  const result = await listAdminEvents(createSupabaseAdminClient(), query, page);
  const columns = messages[locale].admin.events.columns;
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/events" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <SearchForm path="/admin/events" query={query} />
      <p className="text-muted-foreground" data-testid="admin-count">
        {t("count", { count: result.total })}
      </p>
      {result.rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <DataTable caption={t("title")} columns={Object.values(columns)}>
          {result.rows.map((row) => (
            <tr key={row.id} data-testid="admin-event-row">
              <Cell>
                <Link
                  href={`/admin/events/${row.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {row.title}
                </Link>
                <span className="block text-sm text-muted-foreground">{row.public_code}</span>
              </Cell>
              <Cell>{row.owner_email ?? "-"}</Cell>
              <Cell>
                {tStatus(
                  eventDisplayStatus({ status: row.status, expires_at: row.expires_at }, now),
                )}
              </Cell>
              <Cell>{tPlans(row.plan as PlanId)}</Cell>
              <Cell>{formatEventDate(row.event_date, locale)}</Cell>
              <Cell numeric>{row.media_count}</Cell>
              <Cell numeric>{formatBytes(row.bytes_used, locale)}</Cell>
              <Cell numeric>{row.open_reports}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager path="/admin/events" page={page} total={result.total} query={query} />
    </div>
  );
}
