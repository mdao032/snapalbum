import {
  buildShortLink,
  canCancelDeletion,
  computeEventUsage,
  defaultEventSettings,
  eventSettingsSchema,
  purgeDeadline,
  uuidSchema,
  type EventType,
  type Locale,
  type PlanId,
} from "@snapalbum/shared";
import { ArrowLeft, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeleteEvent } from "@/components/events/delete-event";
import { EventCover } from "@/components/events/event-cover";
import { EventStatsPanel } from "@/components/events/event-stats";
import { PersonalizeForm } from "@/components/events/personalize-form";
import { SettingsForm } from "@/components/events/settings-form";
import { SharePanel } from "@/components/events/share-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientEnv } from "@/config/env";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { eventDisplayStatus, formatEventDate, formatInstantDate } from "@/lib/events";
import { requireOrganiser } from "@/server/auth";
import { getEventStats, getOwnEvent } from "@/server/events";
import { cancelDeletionAction } from "./actions";

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
  const tDanger = await getTranslations("dashboard.danger");
  const now = new Date();
  const status = eventDisplayStatus(event, now);
  const pendingDeletion = event.status === "pending_deletion";

  const parsedSettings = eventSettingsSchema.safeParse(event.settings);
  const settings = parsedSettings.success
    ? parsedSettings.data
    : defaultEventSettings(event.event_date);
  const usage = computeEventUsage({ plan: event.plan as PlanId, mediaCount: event.media_count });

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

        {pendingDeletion && event.deleted_at ? (
          <Card className="flex flex-col gap-4 bg-danger-soft p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-danger">
                {tDanger("pendingTitle", {
                  date: formatInstantDate(purgeDeadline(event.deleted_at), locale),
                })}
              </h2>
              <p>{tDanger("pendingDescription")}</p>
            </div>
            {canCancelDeletion(event, now) ? (
              <form action={cancelDeletionAction.bind(null, event.id)}>
                <Button type="submit" size="lg">
                  <Undo2 aria-hidden />
                  {tDanger("cancel")}
                </Button>
              </form>
            ) : null}
          </Card>
        ) : null}

        <EventStatsPanel stats={getEventStats(event)} usage={usage} />

        {pendingDeletion ? null : (
          <>
            <SharePanel
              eventId={event.id}
              title={event.title}
              link={buildShortLink(clientEnv.NEXT_PUBLIC_SHORT_LINK_BASE, event.public_code)}
            />

            <SettingsForm
              eventId={event.id}
              values={{
                galleryVisible: settings.gallery_visible,
                requireApproval: settings.require_approval,
                uploadOpensAt: settings.upload_opens_at,
                uploadClosesAt: settings.upload_closes_at,
              }}
            />

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

            <DeleteEvent eventId={event.id} title={event.title} />
          </>
        )}
      </div>
    </div>
  );
}
