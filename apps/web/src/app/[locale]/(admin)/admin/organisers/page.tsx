import { formatPrice } from "@snapalbum/shared";
import { messages } from "@snapalbum/shared/messages";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { Cell, DataTable } from "@/components/admin/data-table";
import { Pager } from "@/components/admin/pager";
import { SearchForm } from "@/components/admin/search-form";
import { routing } from "@/i18n/routing";
import { formatInstantDate } from "@/lib/events";
import { listAdminOrganisers } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/organisers">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.organisers",
  });
  return { title: t("title") };
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** The organisers: address, name, events, what they paid, and whether they asked to leave (F-090). */
export default async function AdminOrganisersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/organisers">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const raw = await searchParams;
  const query = one(raw.q).trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(one(raw.page), 10) || 1);

  const t = await getTranslations("admin.organisers");
  const result = await listAdminOrganisers(createSupabaseAdminClient(), query, page);
  const columns = messages[locale].admin.organisers.columns;

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/organisers" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <SearchForm path="/admin/organisers" query={query} />
      <p className="text-muted-foreground" data-testid="admin-count">
        {t("count", { count: result.total })}
      </p>
      {result.rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <DataTable caption={t("title")} columns={Object.values(columns)}>
          {result.rows.map((row) => (
            <tr key={row.user_id} data-testid="admin-organiser-row">
              <Cell>{row.email ?? "-"}</Cell>
              <Cell>{row.display_name ?? "-"}</Cell>
              <Cell numeric>{row.events_count}</Cell>
              <Cell numeric>{formatPrice(row.paid_cents, locale)}</Cell>
              <Cell>{formatInstantDate(row.created_at, locale)}</Cell>
              <Cell>
                {row.deleted_at ? t("deleting") : row.role === "admin" ? t("admin") : "-"}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager path="/admin/organisers" page={page} total={result.total} query={query} />
    </div>
  );
}
