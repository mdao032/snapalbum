import { formatPrice, stripePaymentUrl } from "@snapalbum/shared";
import { ExternalLink } from "lucide-react";
import { messages } from "@snapalbum/shared/messages";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { Cell, DataTable } from "@/components/admin/data-table";
import { Pager } from "@/components/admin/pager";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatInstantDate } from "@/lib/events";
import { listAdminPurchases } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/payments">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.payments",
  });
  return { title: t("title") };
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** Every payment, newest first, with the link to refund it in Stripe (F-090, F-091, R6). */
export default async function AdminPaymentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/payments">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const page = Math.max(1, Number.parseInt(one((await searchParams).page), 10) || 1);
  const t = await getTranslations("admin.payments");
  const tProducts = await getTranslations("account.purchases");
  const result = await listAdminPurchases(createSupabaseAdminClient(), page);
  const columns = messages[locale].admin.payments.columns;

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/payments" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="text-muted-foreground" data-testid="admin-count">
        {t("count", { count: result.total })}
      </p>
      <p className="text-sm text-muted-foreground">{t("refundHint")}</p>
      {result.rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <DataTable caption={t("title")} columns={[...Object.values(columns), ""]}>
          {result.rows.map((row) => (
            <tr key={row.id} data-testid="admin-payment-row" data-status={row.status}>
              <Cell>{formatInstantDate(row.created_at, locale)}</Cell>
              <Cell>{row.owner_email ?? "-"}</Cell>
              <Cell>
                {row.event_id ? (
                  <Link
                    href={`/admin/events/${row.event_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.event_title || "-"}
                  </Link>
                ) : (
                  row.event_title || "-"
                )}
              </Cell>
              <Cell>
                {tProducts(`products.${row.product === "extension" ? "extension" : "event"}`)}
              </Cell>
              <Cell numeric>{formatPrice(row.amount_cents, locale)}</Cell>
              <Cell>{tProducts(`status.${row.status === "refunded" ? "refunded" : "paid"}`)}</Cell>
              <Cell>
                {row.stripe_payment_intent_id && row.status === "paid" ? (
                  <a
                    href={stripePaymentUrl(row.stripe_payment_intent_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline"
                  >
                    {t("refund")}
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                ) : null}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager path="/admin/payments" page={page} total={result.total} />
    </div>
  );
}
