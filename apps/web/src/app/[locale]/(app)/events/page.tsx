import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventCard } from "@/components/events/event-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireOrganiser } from "@/server/auth";
import { listOwnEvents } from "@/server/events";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/events">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "events.list",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function EventsPage({ params }: PageProps<"/[locale]/events">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { supabase } = await requireOrganiser(locale);
  const events = await listOwnEvents(supabase);
  const t = await getTranslations("events.list");
  const now = new Date();

  const createButton = (
    <Button asChild size={events.length === 0 ? "lg" : "md"}>
      <Link href="/events/new">
        <Plus aria-hidden />
        {t("create")}
      </Link>
    </Button>
  );

  if (events.length === 0) {
    return (
      <div className="container-page py-6">
        <h1 className="sr-only">{t("title")}</h1>
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={createButton}
          tone="warm"
        />
      </div>
    );
  }

  return (
    <div className="container-page flex flex-col gap-8 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-title">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {createButton}
      </div>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <li key={event.id}>
            <EventCard event={event} now={now} />
          </li>
        ))}
      </ul>
    </div>
  );
}
