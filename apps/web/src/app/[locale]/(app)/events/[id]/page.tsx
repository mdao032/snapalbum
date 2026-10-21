import { uuidSchema, type EventType, type Locale } from "@snapalbum/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCover } from "@/components/events/event-cover";
import { PersonalizeForm } from "@/components/events/personalize-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { eventDisplayStatus, formatEventDate } from "@/lib/events";
import { requireOrganiser } from "@/server/auth";
import { getOwnEvent } from "@/server/events";

export const metadata: Metadata = { robots: { index: false } };

export default async function EventPage({ params }: PageProps<"/[locale]/events/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { supabase } = await requireOrganiser(locale);
  if (!uuidSchema.safeParse(id).success) notFound();

  const event = await getOwnEvent(supabase, id);
  // Someone else's event is invisible (RLS), so it looks like any missing page.
  if (!event) notFound();
  const t = await getTranslations("events");
  const status = eventDisplayStatus(event, new Date());

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <Link
          href="/events"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg font-medium text-primary hover:underline"
        >
          <ArrowLeft className="size-5" aria-hidden />
          {t("detail.back")}
        </Link>

        <div className="overflow-hidden rounded-3xl shadow-soft ring-1 ring-border/70">
          <EventCover accentColor={event.accent_color} className="h-36" />
          <div className="flex flex-col gap-2 bg-surface p-6">
            <h1 className="text-title text-balance">{event.title}</h1>
            <p className="text-muted-foreground">
              {t(`types.${event.type as EventType}`)} · {formatEventDate(event.event_date, locale)}{" "}
              · {t(`status.${status}`)}
            </p>
          </div>
        </div>

        <PersonalizeForm
          eventId={event.id}
          values={{
            title: event.title,
            type: event.type as EventType,
            locale: event.locale as Locale,
            welcomeMessage: event.welcome_message ?? "",
            accentColor: event.accent_color,
          }}
        />
      </div>
    </div>
  );
}
