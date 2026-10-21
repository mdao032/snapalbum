import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CreateEventForm } from "@/components/events/create-event-form";
import { routing } from "@/i18n/routing";
import { todayIsoDate } from "@/lib/events";
import { requireOrganiser } from "@/server/auth";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/events/new">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "events.new",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function NewEventPage({ params }: PageProps<"/[locale]/events/new">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireOrganiser(locale);
  const t = await getTranslations("events.new");

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-title">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <CreateEventForm today={todayIsoDate()} />
      </div>
    </div>
  );
}
