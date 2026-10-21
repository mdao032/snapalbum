import type { EventType } from "@snapalbum/shared";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { eventDisplayStatus, formatEventDate } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EventCover } from "./event-cover";
import type { EventRow } from "@/server/events";

const STATUS_STYLES = {
  active: "bg-success-soft text-success",
  expired: "bg-muted text-muted-foreground",
  suspended: "bg-danger-soft text-danger",
  pending_deletion: "bg-danger-soft text-danger",
} as const;

/** One event of the "My events" list (F-018): cover, name, date, photo count and state. */
export function EventCard({ event, now }: { event: EventRow; now: Date }) {
  const t = useTranslations("events");
  const locale = useLocale();
  const status = eventDisplayStatus(event, now);

  return (
    <Card className="relative overflow-hidden p-0 transition-shadow focus-within:ring-4 focus-within:ring-primary/30 hover:shadow-lift">
      <EventCover accentColor={event.accent_color} className="h-32" />
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-snug text-balance">
            {/* The whole card is the link: the stretched ::after covers it. */}
            <Link
              href={`/events/${event.id}`}
              className="outline-none after:absolute after:inset-0 after:content-['']"
            >
              {event.title}
            </Link>
          </h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-sm font-medium",
              STATUS_STYLES[status],
            )}
          >
            {t(`status.${status}`)}
          </span>
        </div>
        <p className="text-muted-foreground">
          {t(`types.${event.type as EventType}`)} · {formatEventDate(event.event_date, locale)}
        </p>
        <p className="text-sm font-medium">{t("list.photoCount", { count: event.media_count })}</p>
      </div>
    </Card>
  );
}
