import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { Pager } from "@/components/admin/pager";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatInstantDate } from "@/lib/events";
import { requireAdmin } from "@/server/auth";
import { listFeedback } from "@/server/feedback";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { handleFeedbackAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/feedback">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.feedback",
  });
  return { title: t("title") };
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** What organisers and guests wrote during the field beta (step 6.2), unhandled first. */
export default async function AdminFeedbackPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/feedback">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(one(query.page), 10) || 1);
  const t = await getTranslations("admin.feedback");
  const result = await listFeedback(createSupabaseAdminClient(), page);
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/feedback" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {one(query.done) ? <Alert tone="success">{t("done")}</Alert> : null}
      {one(query.failed) ? <Alert tone="error">{t("failed")}</Alert> : null}

      <p className="text-muted-foreground" data-testid="admin-count">
        {t("summary", {
          total: result.total,
          open: result.open,
          average: number.format(result.average),
        })}
      </p>

      {result.rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.rows.map((row) => (
            <li key={row.id} data-testid="feedback-row" data-handled={row.handled_at !== null}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {t("rating", { value: row.rating })} ·{" "}
                    <span className="font-normal text-muted-foreground">
                      {t(`audience.${row.audience}`)}
                      {row.author_email ? ` (${row.author_email})` : ""}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatInstantDate(row.created_at, locale)}
                  </p>
                </div>
                {row.event_id ? (
                  <p className="text-sm">
                    <Link
                      href={`/admin/events/${row.event_id}`}
                      className="text-primary hover:underline"
                    >
                      {row.event_title || "-"}
                    </Link>
                  </p>
                ) : null}
                {row.message ? (
                  <p className="whitespace-pre-line text-pretty">{row.message}</p>
                ) : (
                  <p className="text-muted-foreground">{t("noMessage")}</p>
                )}
                <form action={handleFeedbackAction}>
                  <input type="hidden" name="returnTo" value="/admin/feedback" />
                  <input type="hidden" name="feedbackId" value={row.id} />
                  <input type="hidden" name="handled" value={row.handled_at ? "false" : "true"} />
                  <Button type="submit" variant="secondary" data-testid="feedback-toggle">
                    {row.handled_at ? t("reopen") : t("markHandled")}
                  </Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pager path="/admin/feedback" page={page} total={result.total} />
    </div>
  );
}
