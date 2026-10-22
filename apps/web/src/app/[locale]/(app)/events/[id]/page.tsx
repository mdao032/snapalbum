import {
  buildShortLink,
  canBuy,
  canCancelDeletion,
  computeEventUsage,
  defaultEventSettings,
  eventSettingsSchema,
  paymentReturnSchema,
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
import { AlbumReady } from "@/components/events/album-ready";
import { LiveCard } from "@/components/events/live-card";
import { ModerationCard } from "@/components/events/moderation-card";
import { DeleteEvent } from "@/components/events/delete-event";
import { DownloadAlbum } from "@/components/events/download-album";
import { EventCover } from "@/components/events/event-cover";
import { EventStatsPanel } from "@/components/events/event-stats";
import { PaymentReturn } from "@/components/events/payment-return";
import { PlanCard } from "@/components/events/plan-card";
import { PersonalizeForm } from "@/components/events/personalize-form";
import { SettingsForm } from "@/components/events/settings-form";
import { SharePanel } from "@/components/events/share-panel";
import { ShareLinks } from "@/components/events/share-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientEnv } from "@/config/env";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { eventDisplayStatus, formatEventDate, formatInstantDate } from "@/lib/events";
import { requireOrganiser } from "@/server/auth";
import {
  countNotifyGuests,
  countOptimizedOnlyPhotos,
  getEventStats,
  getOwnEvent,
} from "@/server/events";
import { moderationCounts } from "@/server/moderation";
import { shareLinkViews } from "@/server/share-links";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import {
  cancelDeletionAction,
  createShareLinkAction,
  markAlbumReadyAction,
  revokeShareLinkAction,
} from "./actions";
import { planAlbumAction, signAlbumFilesAction } from "./download/actions";
import { checkoutAction, confirmPaymentAction } from "./payment/actions";

export const metadata: Metadata = { robots: { index: false } };

export default async function EventPage({
  params,
  searchParams,
}: PageProps<"/[locale]/events/[id]">) {
  const { locale, id } = await params;
  // Where Stripe sends the organiser back to (SPEC 13); anything else is ignored.
  const payment = paymentReturnSchema.safeParse(await searchParams);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { supabase, user } = await requireOrganiser(locale);
  if (!uuidSchema.safeParse(id).success) notFound();

  const event = await getOwnEvent(supabase, id);
  // Someone else's event is invisible (RLS), so it looks like any missing page.
  if (!event) notFound();
  const t = await getTranslations("events");
  const tDanger = await getTranslations("dashboard.danger");
  const tExpired = await getTranslations("dashboard.expired");
  const tAccountPending = await getTranslations("dashboard.accountPending");
  const now = new Date();
  const status = eventDisplayStatus(event, now);
  const pendingDeletion = event.status === "pending_deletion";

  const parsedSettings = eventSettingsSchema.safeParse(event.settings);
  const settings = parsedSettings.success
    ? parsedSettings.data
    : defaultEventSettings(event.event_date);
  const notifyCount = pendingDeletion
    ? 0
    : await countNotifyGuests(createSupabaseAdminClient(), event.id);
  const attention = pendingDeletion
    ? null
    : await moderationCounts(createSupabaseAdminClient(), event.id);
  const optimizedOnlyCount = pendingDeletion
    ? 0
    : await countOptimizedOnlyPhotos(createSupabaseAdminClient(), event.id);
  const shareLinks = pendingDeletion
    ? []
    : await shareLinkViews(createSupabaseAdminClient(), user.id, event.id);
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
            {event.deletion_reason === "account" ? (
              <div className="flex flex-col gap-1" data-testid="account-pending-card">
                <h2 className="text-xl font-semibold text-danger">{tAccountPending("title")}</h2>
                <p>
                  {tAccountPending("text", {
                    date: formatInstantDate(purgeDeadline(event.deleted_at), locale),
                  })}
                </p>
                <Link href="/account" className="mt-2 font-semibold text-primary hover:underline">
                  {tAccountPending("link")}
                </Link>
              </div>
            ) : event.deletion_reason === "expired" ? (
              <div className="flex flex-col gap-1" data-testid="expired-card">
                <h2 className="text-xl font-semibold text-danger">{tExpired("title")}</h2>
                <p>
                  {tExpired("text", {
                    date: formatInstantDate(purgeDeadline(event.deleted_at), locale),
                  })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold text-danger">
                  {tDanger("pendingTitle", {
                    date: formatInstantDate(purgeDeadline(event.deleted_at), locale),
                  })}
                </h2>
                <p>{tDanger("pendingDescription")}</p>
              </div>
            )}
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

        {payment.success ? (
          <PaymentReturn
            state={payment.data.payment}
            sessionId={payment.data.session_id}
            onConfirm={confirmPaymentAction.bind(null, event.id)}
          />
        ) : null}

        <PlanCard
          plan={event.plan as PlanId}
          expiresAt={event.expires_at}
          optimizedOnlyCount={optimizedOnlyCount}
          upgrade={
            canBuy({
              product: "event",
              plan: event.plan as PlanId,
              status: event.status,
              deletionReason: event.deletion_reason,
            }).ok
              ? checkoutAction.bind(null, event.id, "event")
              : null
          }
          extend={
            canBuy({
              product: "extension",
              plan: event.plan as PlanId,
              status: event.status,
              deletionReason: event.deletion_reason,
            }).ok
              ? checkoutAction.bind(null, event.id, "extension")
              : null
          }
        />

        {pendingDeletion ? null : (
          <>
            <SharePanel
              eventId={event.id}
              title={event.title}
              link={buildShortLink(clientEnv.NEXT_PUBLIC_SHORT_LINK_BASE, event.public_code)}
            />

            {attention ? (
              <ModerationCard
                eventId={event.id}
                pending={attention.pending}
                reported={attention.reported}
              />
            ) : null}

            <DownloadAlbum
              onPlan={planAlbumAction.bind(null, event.id)}
              onSign={signAlbumFilesAction.bind(null, event.id)}
            />

            <LiveCard code={event.public_code} />

            <AlbumReady
              waitingCount={notifyCount}
              readyAt={settings.album_ready_at ?? null}
              onDeclare={markAlbumReadyAction.bind(null, event.id)}
            />

            <ShareLinks
              initialLinks={shareLinks}
              onCreate={createShareLinkAction.bind(null, event.id)}
              onRevoke={revokeShareLinkAction.bind(null, event.id)}
            />

            <SettingsForm
              eventId={event.id}
              values={{
                galleryVisible: settings.gallery_visible,
                requireApproval: settings.require_approval,
                uploadOpensAt: settings.upload_opens_at,
                uploadClosesAt: settings.upload_closes_at,
                accessCodeSet:
                  typeof settings.access_code_hash === "string" && settings.access_code_hash !== "",
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
