import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

/** What needs the organiser's eye, and the way to the moderation page (F-070, F-071, F-073). */
export async function ModerationCard({
  eventId,
  pending,
  reported,
}: {
  eventId: string;
  pending: number;
  reported: number;
}) {
  const t = await getTranslations("dashboard.moderationCard");
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <ul className="flex flex-col gap-1 font-medium">
          <li data-testid="attention-pending">{t("pending", { count: pending })}</li>
          <li data-testid="attention-reported">{t("reported", { count: reported })}</li>
        </ul>
        <Link
          href={`/events/${eventId}/moderation`}
          className={`${buttonVariants()} self-start`}
          data-testid="open-moderation"
        >
          <ShieldCheck aria-hidden />
          {t("open")}
        </Link>
      </div>
    </Card>
  );
}
