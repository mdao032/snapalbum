import { APP_NAME } from "@snapalbum/shared/brand";
import { EXTENSION, formatPrice, PLANS, REFUND } from "@snapalbum/shared/plans";
import { formatBytes } from "./events";
import { formatDuration } from "./plan-format";

/**
 * The figures quoted in public texts (FAQ, occasion pages), all read from `plans.ts`: a price or a
 * limit changed there changes every sentence, and no page can promise more than the product does.
 */
export function marketingFacts(locale: string) {
  const number = new Intl.NumberFormat(locale);
  const { free, event } = PLANS;
  const freeDays = free.retention.kind === "days_after_event" ? free.retention.days : 0;
  const eventMonths = event.retention.kind === "months_after_purchase" ? event.retention.months : 0;

  return {
    appName: APP_NAME,
    freeMedia: number.format(free.maxMedia),
    freeVideos: free.maxVideos ?? 0,
    freeVideoDuration: formatDuration(free.maxVideoSeconds, locale),
    freeDays,
    px: number.format(free.displayMaxPx),
    eventPrice: formatPrice(event.priceCents ?? 0, locale),
    eventMedia: number.format(event.maxMedia),
    eventVideoDuration: formatDuration(event.maxVideoSeconds, locale),
    eventVideoSize: formatBytes(event.maxVideoBytes, locale),
    eventMonths,
    extensionMonths: EXTENSION.months,
    extensionPrice: formatPrice(EXTENSION.priceCents, locale),
    days: REFUND.windowDays,
    max: REFUND.maxMediaForRefund,
  };
}
