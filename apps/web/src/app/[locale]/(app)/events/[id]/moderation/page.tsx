import { uuidSchema } from "@snapalbum/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { QualityNotice } from "@/components/events/quality-notice";
import { ModerationBoard } from "@/components/moderation/moderation-board";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireOrganiser } from "@/server/auth";
import { getOwnEvent } from "@/server/events";
import { listModeration, moderationCounts } from "@/server/moderation";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Moderation of an event (F-070 to F-073): what waits for approval, what is visible, hidden or
 * refused, what visitors reported, and the guests who can be blocked. Opens on what needs the
 * organiser first: the photos to approve, then the reports.
 */
export default async function ModerationPage({
  params,
}: PageProps<"/[locale]/events/[id]/moderation">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { supabase, user } = await requireOrganiser(locale);
  if (!uuidSchema.safeParse(id).success) notFound();
  const event = await getOwnEvent(supabase, id);
  if (!event || event.status !== "active") notFound();

  const admin = createSupabaseAdminClient();
  const counts = await moderationCounts(admin, id);
  const filter = counts.pending > 0 ? "pending" : counts.reported > 0 ? "reported" : "visible";
  const first = await listModeration({ admin, storage: getStorage() }, user.id, id, { filter });
  if (!first.ok) notFound();
  const t = await getTranslations("moderation");

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Link
          href={`/events/${id}`}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg font-medium text-primary hover:underline"
        >
          <ArrowLeft className="size-5" aria-hidden />
          {t("back")}
        </Link>
        <header className="flex flex-col gap-1">
          <h1 className="text-title text-balance">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </header>
        {event.plan === "free" ? <QualityNotice compact /> : null}
        <ModerationBoard eventId={id} initialFilter={filter} initialPage={first.body} />
      </div>
    </div>
  );
}
