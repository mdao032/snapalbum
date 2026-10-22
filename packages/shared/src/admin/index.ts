/**
 * The administrator area's rules that do not need a database (F-090 to F-092, SPEC 9.3): page size,
 * the estimate of the storage bill, the conversion rate and the storage alert. Pure, so that they
 * are tested without a network.
 */

/** Rows per page of the lists. */
export const ADMIN_PAGE_SIZE = 25;

const GB = 1024 ** 3;

/**
 * Cloudflare R2 storage, in euros per GB and month (about 0.015 US dollars): **an estimate to
 * check against the current price list**, used only to give an order of magnitude (F-092). The
 * first free gigabytes and the operations are not counted.
 */
export const STORAGE_EUR_PER_GB_MONTH = 0.014;

/** Months of an extension the administrator can grant in one gesture (F-091). */
export const ADMIN_EXTEND_MONTHS = [1, 3, 6, 12] as const;

/** The estimated monthly bill, in euro cents, for `bytes` stored. */
export function estimateStorageCostCents(bytes: number): number {
  return Math.round((Math.max(0, bytes) / GB) * STORAGE_EUR_PER_GB_MONTH * 100);
}

/** Share of events on a paid plan, 0 to 1 (F-092: free → paid conversion); 0 with no events. */
export function conversionRate(paidEvents: number, totalEvents: number): number {
  if (totalEvents <= 0) return 0;
  return Math.min(1, Math.max(0, paidEvents / totalEvents));
}

/** Days between two storage alerts: a platform that stays above the threshold is not written to every day. */
export const STORAGE_ALERT_REPEAT_DAYS = 7;

/**
 * Whether to warn the administrators of the stored volume (SPEC 9.3): the total is over the
 * threshold, and no warning went out during the last `STORAGE_ALERT_REPEAT_DAYS` days. No threshold
 * configured: never.
 */
export function shouldAlertStorage(input: {
  totalBytes: number;
  thresholdBytes: number | null;
  lastAlertAt: Date | null;
  now: Date;
}): boolean {
  if (!input.thresholdBytes || input.thresholdBytes <= 0) return false;
  if (input.totalBytes <= input.thresholdBytes) return false;
  if (!input.lastAlertAt) return true;
  const days = (input.now.getTime() - input.lastAlertAt.getTime()) / (24 * 60 * 60 * 1000);
  return days >= STORAGE_ALERT_REPEAT_DAYS;
}

/** The threshold the environment gives in gigabytes, in bytes; null when absent or not a positive number. */
export function storageThresholdBytes(gigabytes: number | null | undefined): number | null {
  if (!gigabytes || !Number.isFinite(gigabytes) || gigabytes <= 0) return null;
  return Math.round(gigabytes * GB);
}

/** The Stripe dashboard page of a payment, to refund it there (F-091; refunds stay manual, R6). */
export function stripePaymentUrl(paymentIntentId: string): string {
  // Keys are test keys only for now (`env.server.ts` refuses others): the test dashboard.
  return `https://dashboard.stripe.com/test/payments/${encodeURIComponent(paymentIntentId)}`;
}
