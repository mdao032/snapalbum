/**
 * Plans, prices and quotas (SPEC section 3).
 * Every limit enforced by the web, the mobile apps and the server is read from here.
 * Never hard-code a price or a limit anywhere else.
 */

export const PLAN_IDS = ["free", "event", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type WatermarkMode = "visible" | "discreet" | "none";

export interface Plan {
  id: PlanId;
  /** Price in euro cents, VAT included. `null` for the subscription plan (see `PRO_PRICING`). */
  priceCents: number | null;
  maxMedia: number;
  /** Maximum number of videos per event, `null` when only `maxMedia` applies. */
  maxVideos: number | null;
  maxVideoSeconds: number;
  maxVideoBytes: number;
  /** Originals are only kept on paid plans (rule R2). */
  keepsOriginals: boolean;
  displayMaxPx: number;
  zipContains: "display" | "originals";
  watermark: WatermarkMode;
  /** Simultaneous active events, `null` for unlimited. */
  maxActiveEvents: number | null;
  retention:
    | { kind: "days_after_event"; days: number }
    | { kind: "months_after_purchase"; months: number }
    | { kind: "while_subscribed"; graceDays: number };
}

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    priceCents: 0,
    maxMedia: 200,
    maxVideos: 10,
    maxVideoSeconds: 30,
    maxVideoBytes: 100 * MB,
    keepsOriginals: false,
    displayMaxPx: 2048,
    zipContains: "display",
    watermark: "visible",
    maxActiveEvents: 1,
    retention: { kind: "days_after_event", days: 30 },
  },
  event: {
    id: "event",
    priceCents: 4900,
    maxMedia: 10_000,
    maxVideos: null,
    maxVideoSeconds: 180,
    maxVideoBytes: 500 * MB,
    keepsOriginals: true,
    displayMaxPx: 2048,
    zipContains: "originals",
    watermark: "discreet",
    maxActiveEvents: 1,
    retention: { kind: "months_after_purchase", months: 12 },
  },
  pro: {
    id: "pro",
    priceCents: null,
    maxMedia: 10_000,
    maxVideos: null,
    maxVideoSeconds: 180,
    maxVideoBytes: 500 * MB,
    keepsOriginals: true,
    displayMaxPx: 2048,
    zipContains: "originals",
    watermark: "none",
    maxActiveEvents: null,
    retention: { kind: "while_subscribed", graceDays: 90 },
  },
};

export const CURRENCY = "EUR";

export const PRO_PRICING = { monthlyCents: 5900, yearlyCents: 59_000 } as const;

/** Paid extension of the retention period (rule R4). */
export const EXTENSION = { priceCents: 1900, months: 12 } as const;

/** Refund window and threshold (rule R6). */
export const REFUND = { windowDays: 14, maxMediaForRefund: 20 } as const;

/** Reminders before deletion (rule R3), in days. */
export const EXPIRY_REMINDER_DAYS = [7, 1] as const;

/** Delay during which an organiser can cancel an event deletion (rule R5). */
export const DELETION_GRACE_DAYS = 7;

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

export function isPaidPlan(id: PlanId): boolean {
  return id !== "free";
}

/** Formats a euro-cent amount for display, e.g. 4900 -> "49 €" in French. */
export function formatPrice(cents: number, locale: string): string {
  const hasDecimals = cents % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
