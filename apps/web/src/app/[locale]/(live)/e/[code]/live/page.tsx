import { buildShortLink } from "@snapalbum/shared";
import { APP_NAME } from "@snapalbum/shared/brand";
import { getPlan } from "@snapalbum/shared/plans";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LiveSlideshow } from "@/components/live/live-slideshow";
import { clientEnv } from "@/config/env";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getEventPlan } from "@/server/events";
import { resolveGalleryAccess } from "@/server/gallery";
import { qrDarkColor, qrSvg } from "@/server/qr";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { robots: { index: false } };

/**
 * The live slideshow of an event (F-060 to F-064), for a screen or a projector. It follows the same
 * rules as the album: the organiser, or a guest when the gallery is open, with their own session;
 * only approved photos are ever shown. Someone who is not signed in is sent to sign in first.
 */
export default async function LivePage({ params }: PageProps<"/[locale]/e/[code]/live">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return redirect({
      href: { pathname: "/login", query: { next: `/e/${code}/live` } },
      locale,
    });
  }

  const admin = createSupabaseAdminClient();
  const access = await resolveGalleryAccess(
    admin,
    { id: auth.user.id },
    {
      type: "event",
      eventCode: code,
    },
  );
  if (!access.ok) notFound();

  const link = buildShortLink(clientEnv.NEXT_PUBLIC_SHORT_LINK_BASE, code);
  const svg = await qrSvg(link, qrDarkColor("ink", access.body.accentColor));

  const watermark = getPlan(await getEventPlan(admin, access.body.eventId)).watermark;
  const tLayout = await getTranslations("layout");

  return (
    <LiveSlideshow
      eventCode={code}
      eventId={access.body.eventId}
      title={access.body.title}
      qr={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      madeWith={
        watermark === "none"
          ? null
          : { label: tLayout("madeWith", { appName: APP_NAME }), mode: watermark }
      }
    />
  );
}
