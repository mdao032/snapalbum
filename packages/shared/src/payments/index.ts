import { z } from "zod";
import { computeExpiresAt } from "../events/expiry";
import { EXTENSION, getPlan, type PlanId } from "../plans";
import { uuidSchema } from "../schemas/common";

/**
 * What can be bought (SPEC 13) and the rules around it, shared by the web, the apps and the
 * server. Prices and durations come from `plans.ts` only.
 */

export const CHECKOUT_PRODUCTS = ["event", "extension"] as const;
export type CheckoutProduct = (typeof CHECKOUT_PRODUCTS)[number];
export const checkoutProductSchema = z.enum(CHECKOUT_PRODUCTS);

/** Price in euro cents and months of conservation that a product gives. */
export function productDetails(product: CheckoutProduct): { priceCents: number; months: number } {
  if (product === "extension")
    return { priceCents: EXTENSION.priceCents, months: EXTENSION.months };
  const plan = getPlan("event");
  if (plan.priceCents === null || plan.retention.kind !== "months_after_purchase") {
    throw new Error("The event plan must have a price and a retention in months (plans.ts)");
  }
  return { priceCents: plan.priceCents, months: plan.retention.months };
}

export type PurchaseRefusal = "not_active" | "already_upgraded" | "plan_not_sold";

/**
 * Whether an organiser may buy `product` for an event (checked on the server before a payment page
 * is opened): the event plan only upgrades a free event, an extension is for events that are not
 * on the subscription plan, and a suspended or deleted event sells nothing.
 */
export function canBuy(input: {
  product: CheckoutProduct;
  plan: PlanId;
  status: string;
  /** Why the event waits for its purge, if it does (`events.deletion_reason`). */
  deletionReason?: string | null;
}): { ok: true } | { ok: false; reason: PurchaseRefusal } {
  // An album that expired can be brought back during its 7 days; one the organiser deleted cannot.
  const expired = input.status === "pending_deletion" && input.deletionReason === "expired";
  if (input.status !== "active" && !expired) return { ok: false, reason: "not_active" };
  if (input.plan === "pro") return { ok: false, reason: "plan_not_sold" };
  if (input.product === "event" && input.plan !== "free") {
    return { ok: false, reason: "already_upgraded" };
  }
  return { ok: true };
}

/** Where a full refund of the event plan puts the expiry back: the free retention. */
export function expiryAfterRefund(eventDate: string): Date {
  const expiresAt = computeExpiresAt({ plan: "free", eventDate });
  if (!expiresAt) throw new Error("The free plan must have an expiry (plans.ts)");
  return expiresAt;
}

/** What the web sends to start a payment. */
export const checkoutRequestSchema = z.object({
  eventId: uuidSchema,
  product: checkoutProductSchema,
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** Metadata written on a checkout session and read back from the webhook. */
export const checkoutMetadataSchema = z.object({
  event_id: uuidSchema,
  user_id: uuidSchema,
  product: checkoutProductSchema,
});
export type CheckoutMetadata = z.infer<typeof checkoutMetadataSchema>;

/** Identifier of a Stripe checkout session, as it comes back in the return address. */
export const checkoutSessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{10,200}$/);

/** The query of the address Stripe sends the organiser back to. */
export const paymentReturnSchema = z.object({
  payment: z.enum(["success", "cancelled"]),
  session_id: checkoutSessionIdSchema.optional(),
});
export type PaymentReturn = z.infer<typeof paymentReturnSchema>;

export const PURCHASE_STATUSES = ["paid", "refunded"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
