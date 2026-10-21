import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCover } from "@/components/events/event-cover";
import { EmptyState } from "@/components/feedback/empty-state";
import { routing } from "@/i18n/routing";
import { getPublicEvent } from "@/server/events";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const metadata: Metadata = { robots: { index: false } };

/**
 * The page a guest reaches by scanning the QR code. For now it welcomes them in the event's
 * colors; the upload flow itself arrives with phase 2.
 */
export default async function GuestEventPage({ params }: PageProps<"/[locale]/e/[code]">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const event = await getPublicEvent(createSupabaseAdminClient(), code);
  if (!event || event.status !== "active") notFound();
  const t = await getTranslations("guest");

  return (
    <>
      <EventCover accentColor={event.accent_color} className="h-44 rounded-b-3xl" />
      <div className="flex flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-title text-balance text-center">{event.title}</h1>
        {event.welcome_message ? (
          <p className="text-lead whitespace-pre-line text-pretty text-center text-muted-foreground">
            {event.welcome_message}
          </p>
        ) : null}
        <EmptyState
          title={t("comingSoonTitle")}
          description={t("comingSoonDescription")}
          tone="warm"
          as="h2"
          className="py-6"
        />
      </div>
    </>
  );
}
