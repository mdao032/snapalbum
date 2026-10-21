import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCover } from "@/components/events/event-cover";
import { EmptyState } from "@/components/feedback/empty-state";
import { JoinForm } from "@/components/guest/join-form";
import { clientEnv } from "@/config/env";
import { routing } from "@/i18n/routing";
import { getPublicEvent } from "@/server/events";
import { getGuestOfEvent } from "@/server/guests";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { robots: { index: false } };

/**
 * The page a guest reaches by scanning the QR code. A visitor who has not joined sees the light
 * join step (F-033 to F-035); one who has sees that they take part. The upload itself arrives
 * with the next steps of phase 2.
 */
export default async function GuestEventPage({ params }: PageProps<"/[locale]/e/[code]">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const admin = createSupabaseAdminClient();
  const event = await getPublicEvent(admin, code);
  if (!event || event.status !== "active") notFound();

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const guest = auth.user ? await getGuestOfEvent(admin, event.id, auth.user.id) : null;
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

        {guest ? (
          <>
            <p role="status" className="text-center font-medium">
              {guest.displayName
                ? t("join.joinedAs", { name: guest.displayName })
                : t("join.joinedAnonymous")}
            </p>
            <EmptyState
              title={t("comingSoonTitle")}
              description={t("comingSoonDescription")}
              tone="warm"
              as="h2"
              className="py-6"
            />
          </>
        ) : (
          <JoinForm
            eventCode={code}
            requiresAccessCode={event.requiresAccessCode}
            turnstileSiteKey={clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          />
        )}
      </div>
    </>
  );
}
