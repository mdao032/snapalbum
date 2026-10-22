import { APP_NAME } from "@snapalbum/shared/brand";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Section } from "@/components/marketing/section";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientEnv } from "@/config/env";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { marketingFacts } from "@/lib/marketing-facts";
import { pageAlternates } from "@/lib/seo";
import { USAGES, usageFromSlug, usageParams, usageSlug } from "@/lib/usages";
import { cn } from "@/lib/utils";

/** Unknown occasions are a real 404, not a page that streams in with a 200. */
export const dynamicParams = false;

export function generateStaticParams() {
  return usageParams();
}

const POINTS = ["a", "b", "c"] as const;
const TIPS = ["a", "b", "c", "d"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/usages/[usage]">): Promise<Metadata> {
  const { locale, usage: slug } = await params;
  const usage = usageFromSlug(slug);
  if (!hasLocale(routing.locales, locale) || !usage) return {};
  const t = await getTranslations({ locale, namespace: `usages.${usage}` });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: pageAlternates(clientEnv.NEXT_PUBLIC_SITE_URL, locale, { kind: "usage", usage }),
    openGraph: {
      type: "article",
      siteName: APP_NAME,
      title: t("metaTitle"),
      description: t("metaDescription"),
    },
  };
}

/**
 * A page written for one occasion (wedding, birthday, company event): what the service does for it,
 * which plan fits, practical advice. Every figure comes from `plans.ts` (step 5.1).
 */
export default async function UsagePage({ params }: PageProps<"/[locale]/usages/[usage]">) {
  const { locale, usage: slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const usage = usageFromSlug(slug);
  if (!usage) notFound();
  // The language switcher keeps the slug it was on: send the visitor to the address of this language.
  if (slug !== usageSlug(locale, usage)) {
    redirect({ href: `/usages/${usageSlug(locale, usage)}`, locale });
  }
  setRequestLocale(locale);

  const t = await getTranslations(`usages.${usage}`);
  const tCommon = await getTranslations("usages.common");
  const facts = marketingFacts(locale);

  return (
    <>
      <article>
        <header className="bg-aurora">
          <div className="container-page flex flex-col items-center gap-5 py-14 text-center sm:py-20">
            <p className="inline-flex items-center rounded-full bg-surface px-4 py-2 text-sm font-medium text-muted-foreground shadow-soft ring-1 ring-border/70">
              {tCommon(`names.${usage}`)}
            </p>
            <h1 className="text-display max-w-4xl text-balance">{t("title")}</h1>
            <p className="text-lead max-w-2xl text-pretty text-muted-foreground">{t("intro")}</p>
            <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
              <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
                {tCommon("ctaPrimary")}
              </Link>
              <Link
                href="/demo"
                className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
              >
                {tCommon("ctaDemo")}
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">{tCommon("ctaHint")}</p>
          </div>
        </header>

        <Section id="points" title={t("pointsTitle")}>
          <ul className="grid gap-5 md:grid-cols-3">
            {POINTS.map((point) => (
              <li key={point} className="flex">
                <Card className="flex w-full flex-col gap-2">
                  <h3 className="text-title">{t(`points.${point}.title`)}</h3>
                  <p className="text-muted-foreground">{t(`points.${point}.text`, facts)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="offre" title={t("planTitle")} tone="soft">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
            <p className="text-lead text-pretty">{t("planText", facts)}</p>
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
            >
              {tCommon("pricingLink")}
            </Link>
          </div>
        </Section>

        <Section id="conseils" title={tCommon("tipsTitle")}>
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {TIPS.map((tip, index) => (
              <li key={tip} className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <p className="pt-0.5 text-pretty">{t(`tips.${tip}`)}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="autres-occasions" title={tCommon("otherTitle")} tone="soft">
          <ul className="flex flex-wrap justify-center gap-3">
            {USAGES.filter((other) => other !== usage).map((other) => (
              <li key={other}>
                <Link
                  href={`/usages/${usageSlug(locale, other)}`}
                  className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
                >
                  {tCommon(`names.${other}`)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </article>
    </>
  );
}
