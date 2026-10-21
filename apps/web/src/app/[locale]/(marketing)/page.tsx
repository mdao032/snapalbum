import { ArrowRight, Check } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const pills = [t("pillNoApp"), t("pillNoAccount"), t("pillMedia")];

  return (
    <section className="bg-aurora relative isolate overflow-hidden">
      <div className="container-page grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:py-28">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <span className="animate-fade-up inline-flex items-center rounded-full bg-surface px-4 py-2 text-sm font-medium text-muted-foreground shadow-soft ring-1 ring-border/70">
            {t("eyebrow")}
          </span>
          <h1
            className="text-display animate-fade-up mt-6 max-w-2xl text-balance"
            style={{ animationDelay: "80ms" }}
          >
            {t("title")}
          </h1>
          <p
            className="text-lead animate-fade-up mt-6 max-w-xl text-pretty text-muted-foreground"
            style={{ animationDelay: "160ms" }}
          >
            {t("subtitle")}
          </p>
          <div
            className="animate-fade-up mt-9 flex flex-col items-center gap-3 lg:items-start"
            style={{ animationDelay: "240ms" }}
          >
            <Button asChild size="lg">
              <Link href="/login">
                {t("cta")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">{t("ctaHint")}</p>
          </div>
          <ul
            className="animate-fade-up mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 lg:justify-start"
            style={{ animationDelay: "320ms" }}
          >
            {pills.map((pill) => (
              <li key={pill} className="flex items-center gap-2 text-sm font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
                {pill}
              </li>
            ))}
          </ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}
