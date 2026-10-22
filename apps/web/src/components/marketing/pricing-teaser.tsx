import { formatPrice, getPlan } from "@snapalbum/shared/plans";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { planFeatureLines } from "./plan-features";
import { Section } from "./section";

/** The first lines of a plan: how many photos, which guests, which videos, which quality (F-045). */
const SHOWN_LINES = 4;

const PLANS = ["free", "event"] as const;

/**
 * The two plans on the home page, read from `plans.ts` like the pricing page. The quality line is
 * always among the lines shown: the free plan never hides that photos are optimised (F-045).
 */
export async function PricingTeaser() {
  const t = await getTranslations("home");
  const tPricing = await getTranslations("pricing");
  const tPlans = await getTranslations("plans");
  const locale = await getLocale();

  const cards = await Promise.all(
    PLANS.map(async (id) => {
      const plan = getPlan(id);
      return { id, plan, lines: (await planFeatureLines(plan)).slice(0, SHOWN_LINES) };
    }),
  );

  return (
    <Section id="tarifs" title={t("pricingTitle")} subtitle={t("pricingSubtitle")} tone="soft">
      <div className="mx-auto grid w-full max-w-4xl gap-5 md:grid-cols-2">
        {cards.map(({ id, plan, lines }) => (
          <Card
            key={id}
            data-testid={`home-plan-${id}`}
            className={cn(
              "flex flex-col gap-5 p-6 sm:p-8",
              id === "event" && "ring-2 ring-primary",
            )}
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-title">{tPlans(`names.${id}`)}</h3>
              <p className="text-muted-foreground">{tPricing(`${id}.tagline`)}</p>
            </div>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">
                {formatPrice(plan.priceCents ?? 0, locale)}
              </span>
              {id === "event" ? (
                <span className="text-muted-foreground">{tPricing("perEvent")}</span>
              ) : null}
            </p>
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <Link href="/pricing" className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}>
          {t("pricingAll")}
        </Link>
        <p className="max-w-xl text-pretty text-sm text-muted-foreground">{t("pricingProNote")}</p>
      </div>
    </Section>
  );
}
