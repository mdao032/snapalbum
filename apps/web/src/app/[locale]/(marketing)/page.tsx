import { ArrowRight, QrCode } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { routing } from "@/i18n/routing";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16 text-center">
      <div
        aria-hidden
        className="absolute inset-x-0 -top-40 -z-10 mx-auto h-[36rem] max-w-3xl rounded-full bg-gradient-to-br from-primary/30 via-warm/20 to-transparent blur-3xl"
      />
      <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-medium text-muted-foreground ring-1 ring-border">
        <QrCode className="size-4 text-primary" aria-hidden />
        {t("eyebrow")}
      </span>
      <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
        {t("title")}
      </h1>
      <p className="mt-6 max-w-xl text-pretty text-lg text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-10 flex flex-col items-center gap-3">
        <Button size="lg" type="button">
          {t("cta")}
          <ArrowRight aria-hidden />
        </Button>
        <p className="text-sm text-muted-foreground">{t("ctaHint")}</p>
      </div>
    </main>
  );
}
