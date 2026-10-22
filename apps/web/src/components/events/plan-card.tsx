import { productDetails } from "@snapalbum/shared/payments";
import { formatPrice, getPlan, type PlanId } from "@snapalbum/shared/plans";
import { getLocale, getTranslations } from "next-intl/server";
import { PlanFeatureList } from "@/components/marketing/plan-features";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatInstantDate } from "@/lib/events";
import { CheckoutButton } from "./checkout-button";
import { QualityNotice } from "./quality-notice";
import type { CheckoutState } from "@/app/[locale]/(app)/events/[id]/payment/actions";

/**
 * The plan of the event, what it includes and until when the album is kept (F-045). On the free
 * plan the quality of the photos is stated first; on a paid plan, the photos sent before the
 * upgrade are counted, since only their optimised version exists (R2).
 */
export async function PlanCard({
  plan: planId,
  expiresAt,
  optimizedOnlyCount,
  upgrade,
  extend,
}: {
  plan: PlanId;
  expiresAt: string | null;
  optimizedOnlyCount: number;
  /** Opens the payment page for the event plan; null when this event cannot buy it. */
  upgrade: ((previous: CheckoutState) => Promise<CheckoutState>) | null;
  /** Opens the payment page for an extension; null when this event cannot buy one. */
  extend: ((previous: CheckoutState) => Promise<CheckoutState>) | null;
}) {
  const t = await getTranslations("dashboard.plan");
  const tPlans = await getTranslations("plans");
  const locale = await getLocale();
  const plan = getPlan(planId);

  return (
    <Card className="p-6 sm:p-8" data-testid="plan-card" data-plan={planId}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-lg font-medium">{t("name", { plan: tPlans(`names.${planId}`) })}</p>
          {expiresAt ? (
            <p className="text-muted-foreground">
              {t("keptUntil", { date: formatInstantDate(expiresAt, locale) })}
            </p>
          ) : null}
        </div>

        {plan.keepsOriginals ? null : <QualityNotice />}
        {plan.keepsOriginals && optimizedOnlyCount > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="optimized-only">
            {t("optimizedOnly", { count: optimizedOnlyCount })}
          </p>
        ) : null}

        <PlanFeatureList plan={plan} />

        {upgrade || extend ? (
          <div className="flex flex-col gap-4">
            {upgrade ? (
              <div className="flex flex-col gap-2">
                <CheckoutButton
                  action={upgrade}
                  testId="upgrade-button"
                  label={t("upgrade", {
                    price: formatPrice(productDetails("event").priceCents, locale),
                  })}
                />
                <p className="text-sm text-muted-foreground">{t("upgradeHint")}</p>
                <p className="text-sm text-muted-foreground">
                  {t.rich("salesNote", {
                    sales: (chunks) => (
                      <Link href="/legal/sales" className="underline hover:text-foreground">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              </div>
            ) : null}
            {extend ? (
              <CheckoutButton
                action={extend}
                testId="extend-button"
                variant="secondary"
                label={t("extend", {
                  months: productDetails("extension").months,
                  price: formatPrice(productDetails("extension").priceCents, locale),
                })}
              />
            ) : null}
          </div>
        ) : null}

        <Link href="/pricing" className={`${buttonVariants({ variant: "secondary" })} self-start`}>
          {t("seeOffers")}
        </Link>
      </div>
    </Card>
  );
}
