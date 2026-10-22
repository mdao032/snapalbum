import { APP_NAME } from "@snapalbum/shared/brand";
import { CURRENCY, PLANS } from "@snapalbum/shared/plans";
import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DemoBand } from "@/components/marketing/demo-band";
import { Faq, getFaqEntries } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { JsonLd } from "@/components/marketing/json-ld";
import { ScrollToHash } from "@/components/marketing/scroll-to-hash";
import { PricingTeaser } from "@/components/marketing/pricing-teaser";
import { Testimonials } from "@/components/marketing/testimonials";
import { UsesSection } from "@/components/marketing/uses-section";
import { ValuesSection } from "@/components/marketing/values-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { clientEnv } from "@/config/env";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  faqJsonLd,
  offersJsonLd,
  organizationJsonLd,
  pageAlternates,
  pageUrl,
  websiteJsonLd,
} from "@/lib/seo";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: { absolute: t("title", { appName: APP_NAME }) },
    description: t("description"),
    alternates: pageAlternates(clientEnv.NEXT_PUBLIC_SITE_URL, locale, { kind: "home" }),
    openGraph: {
      type: "website",
      siteName: APP_NAME,
      title: t("title", { appName: APP_NAME }),
      description: t("description"),
    },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tPlans = await getTranslations("plans");
  const pills = [t("pillNoApp"), t("pillNoAccount"), t("pillMedia")];
  const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;
  const homeUrl = pageUrl(siteUrl, locale, { kind: "home" });
  const faq = await getFaqEntries();
  const structuredData = [
    organizationJsonLd({ name: APP_NAME, url: homeUrl }),
    websiteJsonLd({ name: APP_NAME, url: homeUrl, inLanguage: locale }),
    offersJsonLd({
      name: APP_NAME,
      description: (await getTranslations("metadata"))("description"),
      url: homeUrl,
      offers: (["free", "event"] as const).map((id) => ({
        name: tPlans(`names.${id}`),
        priceCents: PLANS[id].priceCents ?? 0,
        currency: CURRENCY,
      })),
    }),
    faqJsonLd(faq.map(({ question, answer }) => ({ question, answer }))),
  ];

  return (
    <>
      {structuredData.map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
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
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/login">
                    {t("cta")}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Link
                  href="/demo"
                  className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
                >
                  {t("ctaDemo")}
                </Link>
              </div>
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
      <ScrollToHash />
      <HowItWorks />
      <ValuesSection />
      <DemoBand />
      <PricingTeaser />
      <UsesSection />
      <Testimonials />
      <Faq />
      <FinalCta />
    </>
  );
}
