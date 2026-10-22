import { formatPrice } from "@snapalbum/shared/plans";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatInstantDate } from "@/lib/events";
import type { PurchaseRow } from "@/server/payments";

/**
 * The organiser's payments, newest first (SPEC 13, "Mon compte"): date, event, what was bought,
 * the amount in euros and whether it was refunded. The invoice itself is Stripe's, sent by e-mail.
 */
export async function PurchaseHistory({ purchases }: { purchases: PurchaseRow[] }) {
  const t = await getTranslations("account.purchases");
  const locale = await getLocale();

  return (
    <Card className="p-6 sm:p-8" data-testid="purchase-history">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {purchases.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {purchases.map((purchase) => (
              <li
                key={purchase.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                data-testid="purchase"
                data-status={purchase.status}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{t(`products.${purchase.product}`)}</span>
                  {purchase.eventId ? (
                    <Link
                      href={`/events/${purchase.eventId}`}
                      className="truncate text-primary hover:underline"
                    >
                      {purchase.eventTitle}
                    </Link>
                  ) : (
                    <span className="truncate text-muted-foreground">{purchase.eventTitle}</span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatInstantDate(purchase.createdAt, locale)}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-semibold tabular-nums">
                    {formatPrice(purchase.amountCents, locale)}
                  </span>
                  <span
                    className={
                      purchase.status === "refunded"
                        ? "text-sm font-medium text-danger"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    {t(`status.${purchase.status}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
