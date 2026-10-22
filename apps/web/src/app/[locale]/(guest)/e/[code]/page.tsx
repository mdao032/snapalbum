import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPlan, type PlanId } from "@snapalbum/shared/plans";
import { MadeWith } from "@/components/brand/made-with";
import { EventCover } from "@/components/events/event-cover";
import { GuestExperience } from "@/components/guest/guest-experience";
import { clientEnv } from "@/config/env";
import { routing } from "@/i18n/routing";
import { getPublicEvent } from "@/server/events";
import { getGuestOfEvent } from "@/server/guests";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { robots: { index: false } };

/**
 * The page a guest reaches by scanning the QR code. A visitor who has not joined sees the light
 * photo and gallery buttons, with the light join step shown the first time (F-033 to F-035).
 */
export default async function GuestEventPage({ params }: PageProps<"/[locale]/e/[code]">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const admin = createSupabaseAdminClient();
  const event = await getPublicEvent(admin, code);
  if (!event || event.status !== "active") notFound();

  const plan = getPlan(event.plan as PlanId);

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const guest = auth.user ? await getGuestOfEvent(admin, event.id, auth.user.id) : null;

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

        <GuestExperience
          eventCode={code}
          joined={guest !== null}
          displayName={guest?.displayName ?? null}
          requiresAccessCode={event.requiresAccessCode}
          galleryVisible={event.galleryVisible}
          phase={event.phase}
          notifyEmail={guest?.notifyEmail ?? null}
          title={event.title}
          turnstileSiteKey={clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          plan={plan.id}
          maxVideoSeconds={plan.maxVideoSeconds}
        />
        <MadeWith mode={plan.watermark} className="mt-auto" />
      </div>
    </>
  );
}
