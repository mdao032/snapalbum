import { APP_NAME } from "@snapalbum/shared/brand";
import {
  EXTENSION,
  formatPrice,
  getPlan,
  PRO_PRICING,
  REFUND,
  type PlanId,
} from "@snapalbum/shared/plans";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PlanFeatureList } from "@/components/marketing/plan-features";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** The page exists once per language: both are built ahead of time and served from the cache. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "pricing",
  });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const SHOWN: readonly PlanId[] = ["free", "event", "pro"];

/**
 * The plans and their prices (SPEC 3, F-045). Every figure is read from `plans.ts`; the free plan
 * says plainly that photos are kept optimised and that originals come with the Event plan.
 */
export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const tPlans = await getTranslations("plans");

  return (
    <div className="container-page flex flex-col gap-10 py-12 sm:py-16">
      <header className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
        <h1 className="text-display text-balance">{t("title")}</h1>
        <p className="text-lead text-pretty text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-3">
        {SHOWN.map((id) => {
          const plan = getPlan(id);
          const isPro = id === "pro";
          return (
            <Card
              key={id}
              data-testid={`plan-${id}`}
              className={cn(
                "flex flex-col gap-6 p-6 sm:p-8",
                id === "event" && "ring-2 ring-primary",
                isPro && "bg-muted/50",
              )}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold">{tPlans(`names.${id}`)}</h2>
                  {id === "event" ? (
                    <span className="rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
                      {t("event.badge")}
                    </span>
                  ) : null}
                  {isPro ? (
                    <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
                      {t("pro.soon")}
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground">{t(`${id}.tagline`)}</p>
              </div>

              {isPro ? (
                <p className="text-lg font-semibold">
                  {t("pro.price", {
                    monthly: formatPrice(PRO_PRICING.monthlyCents, locale),
                    yearly: formatPrice(PRO_PRICING.yearlyCents, locale),
                  })}
                </p>
              ) : (
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight">
                    {formatPrice(plan.priceCents ?? 0, locale)}
                  </span>
                  {id === "event" ? (
                    <span className="text-muted-foreground">{t("perEvent")}</span>
                  ) : null}
                </p>
              )}

              <PlanFeatureList plan={plan} />

              {isPro ? null : (
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({
                      size: "lg",
                      variant: id === "event" ? "primary" : "secondary",
                    }),
                    "mt-auto",
                  )}
                >
                  {t(`${id}.cta`)}
                </Link>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 text-center">
        <p className="text-pretty">{t("originalsRule")}</p>
        <p className="text-pretty text-muted-foreground">
          <strong className="font-semibold text-foreground">{t("extension.title")}</strong>{" "}
          {t("extension.text", {
            months: EXTENSION.months,
            price: formatPrice(EXTENSION.priceCents, locale),
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("notes.vat", { appName: APP_NAME })}{" "}
          {t("notes.refund", {
            days: REFUND.windowDays,
            max: REFUND.maxMediaForRefund,
          })}
        </p>
      </div>
    </div>
  );
}
