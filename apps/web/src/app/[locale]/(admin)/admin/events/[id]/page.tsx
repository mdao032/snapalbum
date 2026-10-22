import {
  ADMIN_EXTEND_MONTHS,
  formatPrice,
  stripePaymentUrl,
  uuidSchema,
  type PlanId,
} from "@snapalbum/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { ReportCard } from "@/components/admin/report-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { eventDisplayStatus, formatBytes, formatEventDate, formatInstantDate } from "@/lib/events";
import { getAdminEvent } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { extendEventAction, suspendEventAction } from "../../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/events/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.events",
  });
  return { title: t("title") };
}

/** One event seen by the administrator: who owns it, what it paid, what was reported, and what to do (F-090, F-091). */
export default async function AdminEventPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/events/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale) || !uuidSchema.safeParse(id).success) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const detail = await getAdminEvent(createSupabaseAdminClient(), getStorage(), id);
  if (!detail) notFound();
  const { event } = detail;

  const outcome = await searchParams;
  const t = await getTranslations("admin.event");
  const tStatus = await getTranslations("events.status");
  const tPlans = await getTranslations("plans.names");
  const tProducts = await getTranslations("account.purchases");
  const tPayments = await getTranslations("admin.payments");
  const returnTo = `/admin/events/${event.id}`;
  const status = eventDisplayStatus(event, new Date());
  const canSuspend = event.status === "active";
  const canLift = event.status === "suspended";
  const canExtend =
    (event.status === "active" || event.status === "suspended") && event.plan !== "pro";

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/events" />
      <Link
        href="/admin/events"
        className="inline-flex min-h-11 items-center gap-2 self-start font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-5" aria-hidden />
        {t("back")}
      </Link>

      <Card className="flex flex-col gap-2" data-testid="admin-event">
        <h2 className="text-xl font-semibold">{event.title}</h2>
        <p className="text-muted-foreground">
          {formatEventDate(event.event_date, locale)} · {tStatus(status)} ·{" "}
          {tPlans(event.plan as PlanId)}
        </p>
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{t("owner")}</dt>
            <dd>{detail.ownerEmail ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("code")}</dt>
            <dd>{event.public_code}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("size")}</dt>
            <dd>
              {t("media", { count: event.media_count })} · {formatBytes(event.bytes_used, locale)}
            </dd>
          </div>
          <div>
            <dd>
              {t("created", { date: formatInstantDate(event.created_at, locale) })}
              <br />
              {event.expires_at
                ? t("expires", { date: formatInstantDate(event.expires_at, locale) })
                : t("noExpiry")}
            </dd>
          </div>
        </dl>
      </Card>

      {outcome.done ? <Alert tone="success">{t("done")}</Alert> : null}
      {outcome.failed ? <Alert tone="error">{t("failed")}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("suspendHint")}</p>
          {canSuspend || canLift ? (
            <form action={suspendEventAction}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="suspended" value={canSuspend ? "true" : "false"} />
              <Button type="submit" variant="secondary" className={canSuspend ? "text-danger" : ""}>
                {canSuspend ? t("suspend") : t("unsuspend")}
              </Button>
            </form>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-3">
          <p className="font-medium">{t("extend")}</p>
          <p className="text-sm text-muted-foreground">{t("extendHint")}</p>
          {canExtend ? (
            <form action={extendEventAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <label htmlFor="admin-extend-months" className="sr-only">
                {t("extend")}
              </label>
              <select
                id="admin-extend-months"
                name="months"
                defaultValue={ADMIN_EXTEND_MONTHS[1]}
                className="min-h-12 rounded-xl bg-surface px-4 text-base ring-1 ring-border"
              >
                {ADMIN_EXTEND_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {t("extendOption", { months })}
                  </option>
                ))}
              </select>
              <Button type="submit">{t("extendSubmit")}</Button>
            </form>
          ) : null}
        </Card>
      </div>

      <section aria-labelledby="admin-event-payments" className="flex flex-col gap-3">
        <h3 id="admin-event-payments" className="text-lg font-semibold">
          {t("payments")}
        </h3>
        {detail.purchases.length === 0 ? (
          <p>{t("noPayments")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.purchases.map((purchase) => (
              <li
                key={purchase.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1"
                data-testid="admin-event-payment"
              >
                <span>{formatInstantDate(purchase.created_at, locale)}</span>
                <span>
                  {tProducts(
                    `products.${purchase.product === "extension" ? "extension" : "event"}`,
                  )}
                </span>
                <span>{formatPrice(purchase.amount_cents, locale)}</span>
                <span>
                  {tProducts(`status.${purchase.status === "refunded" ? "refunded" : "paid"}`)}
                </span>
                {purchase.stripe_payment_intent_id && purchase.status === "paid" ? (
                  <a
                    href={stripePaymentUrl(purchase.stripe_payment_intent_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline"
                  >
                    {tPayments("refund")}
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-event-reports" className="flex flex-col gap-3">
        <h3 id="admin-event-reports" className="text-lg font-semibold">
          {t("reports")}
        </h3>
        {detail.reports.length === 0 ? (
          <p>-</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {detail.reports.map((report) => (
              <li key={report.mediaId}>
                <ReportCard report={report} returnTo={returnTo} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
