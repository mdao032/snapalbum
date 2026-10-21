import { shareTokenSchema } from "@snapalbum/shared";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCover } from "@/components/events/event-cover";
import { Gallery } from "@/components/gallery/gallery";
import { routing } from "@/i18n/routing";
import { resolveGalleryAccess } from "@/server/gallery";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

// The token is the secret: keep the page out of search results and never pass it on as a referrer.
export const metadata: Metadata = { robots: { index: false }, referrer: "no-referrer" };

/**
 * The album of an event, read-only, for anyone holding a share link (F-054). No account and no
 * session: the token in the address is the proof. A revoked or unknown link looks like any missing
 * page.
 */
export default async function SharedAlbumPage({ params }: PageProps<"/[locale]/g/[token]">) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  if (!shareTokenSchema.safeParse(token).success) notFound();

  const access = await resolveGalleryAccess(createSupabaseAdminClient(), null, {
    type: "share",
    token,
  });
  if (!access.ok) notFound();
  const { title, accentColor } = access.body;
  const t = await getTranslations("gallery.shared");

  return (
    <>
      <EventCover accentColor={accentColor} className="h-36 rounded-b-3xl sm:h-44" />
      <div className="flex flex-1 flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-1 text-center">
          <h1 className="text-title text-balance">{title}</h1>
          <p className="text-muted-foreground">{t("readOnly")}</p>
        </header>
        <Gallery access={{ type: "share", token }} title={title} />
      </div>
    </>
  );
}
