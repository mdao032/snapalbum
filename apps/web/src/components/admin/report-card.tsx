import { getLocale, getTranslations } from "next-intl/server";
import { handleReportAction } from "@/app/[locale]/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatInstantDate } from "@/lib/events";
import type { OpenReport } from "@/server/admin";

/**
 * One reported media: its picture, why it was reported, and the three things the administrator
 * can do (F-090, F-091): hide it, delete it for good (a second step, with the consequences said),
 * or keep it. Plain forms: no script needed.
 */
export async function ReportCard({ report, returnTo }: { report: OpenReport; returnTo: string }) {
  const t = await getTranslations("admin.reports");
  const locale = await getLocale();
  const hidden = { eventId: report.eventId, mediaId: report.mediaId, returnTo };

  return (
    <Card className="flex flex-col gap-4 sm:flex-row" data-testid="admin-report">
      <div className="grid size-40 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
        {report.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed address
          <img src={report.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="px-2 text-center text-sm text-muted-foreground">{t("noPicture")}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            {t("event")} :{" "}
            <Link href={`/admin/events/${report.eventId}`} className="text-primary hover:underline">
              {report.eventTitle}
            </Link>
          </p>
          <p>
            {t("count", { count: report.count })} ·{" "}
            {report.reasons.map((reason) => t(`reasons.${reason as "other"}`)).join(", ")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("since", { date: formatInstantDate(report.firstReportedAt, locale) })}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {report.status === "ready" ? (
            <form action={handleReportAction}>
              {Object.entries(hidden).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <input type="hidden" name="action" value="hide" />
              <Button type="submit" variant="secondary">
                {t("hide")}
              </Button>
            </form>
          ) : null}
          <form action={handleReportAction}>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="action" value="dismiss" />
            <Button type="submit" variant="secondary">
              {t("dismiss")}
            </Button>
          </form>
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-full bg-surface px-6 font-medium text-danger ring-1 ring-border hover:bg-muted [&::-webkit-details-marker]:hidden">
              {t("delete")}
            </summary>
            <form action={handleReportAction} className="mt-3 flex flex-col gap-3">
              {Object.entries(hidden).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <input type="hidden" name="action" value="delete" />
              <p className="text-sm">{t("deleteWarning")}</p>
              <Button type="submit" variant="secondary" className="self-start text-danger">
                {t("deleteConfirm")}
              </Button>
            </form>
          </details>
        </div>
      </div>
    </Card>
  );
}
