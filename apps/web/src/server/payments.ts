import "server-only";
import {
  canBuy,
  checkoutMetadataSchema,
  expiryAfterRefund,
  productDetails,
  STRIPE_LOOKUP_KEYS,
  type ApiErrorCode,
  type CheckoutProduct,
  type CheckoutRequest,
  type PlanId,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getServerEnv } from "@/config/env.server";
import { localePrefix } from "./urls";

type Client = SupabaseClient<Database>;

/**
 * Payment by Stripe Checkout (SPEC 13). The page that takes the card is Stripe's: no card data
 * ever reaches this application. What the application does is open that page for an event it
 * checked, and turn a payment Stripe confirms into a plan and an expiry, once, through the
 * database function `apply_purchase`. Test mode only: `env.server.ts` refuses any other key.
 */

/** The part of the Stripe client used here, so tests can stand in for it. */
export type StripeApi = {
  prices: Pick<Stripe["prices"], "list">;
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "create" | "retrieve"> };
};

export interface PaymentDeps {
  admin: Client;
  stripe: StripeApi;
  /** Origin of the site, for the addresses Stripe sends the organiser back to. */
  siteUrl: string;
}

let stripeClient: Stripe | null = null;

/** The Stripe client, or null when no key is configured (payment is then unavailable). */
export function getStripe(): Stripe | null {
  const key = getServerEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  return stripeClient;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; code: ApiErrorCode };

const PRICE_CACHE_MS = 5 * 60 * 1000;
const priceCache = new Map<CheckoutProduct, { id: string; at: number }>();

/** For tests: forget the prices found so far. */
export function clearPriceCache() {
  priceCache.clear();
}

/**
 * The Stripe price of a product, found by its name (`pnpm stripe:setup` creates it). The amount is
 * checked against `plans.ts`: a price that disagrees means the script has to be run again, and no
 * payment page is opened with a wrong amount.
 */
async function findPriceId(stripe: StripeApi, product: CheckoutProduct): Promise<string | null> {
  const cached = priceCache.get(product);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.id;

  const { data } = await stripe.prices.list({
    lookup_keys: [STRIPE_LOOKUP_KEYS[product]],
    active: true,
    limit: 1,
  });
  const price = data[0];
  const expected = productDetails(product).priceCents;
  if (!price || price.unit_amount !== expected || price.currency !== "eur") return null;
  priceCache.set(product, { id: price.id, at: Date.now() });
  return price.id;
}

const REFUSALS = {
  not_active: "event_suspended",
  already_upgraded: "already_upgraded",
  plan_not_sold: "forbidden",
} as const satisfies Record<string, ApiErrorCode>;

/**
 * Opens a payment page for an event of the signed-in organiser (R2, R4). The event, its owner, its
 * plan and the amount are read here, never taken from the request; the event and the buyer travel
 * in the session's metadata so the webhook can apply the payment.
 */
export async function startCheckout(
  deps: PaymentDeps,
  user: { id: string; email: string | undefined },
  input: CheckoutRequest,
  locale: string,
): Promise<CheckoutResult> {
  const { data: event, error } = await deps.admin
    .from("events")
    .select("id, owner_id, title, plan, status, deletion_reason")
    .eq("id", input.eventId)
    .maybeSingle();
  if (error) throw error;
  // Someone else's event looks like a missing one.
  if (!event || event.owner_id !== user.id) return { ok: false, code: "not_found" };

  const decision = canBuy({
    product: input.product,
    plan: event.plan as PlanId,
    status: event.status,
    deletionReason: event.deletion_reason,
  });
  if (!decision.ok) return { ok: false, code: REFUSALS[decision.reason] };

  const priceId = await findPriceId(deps.stripe, input.product);
  if (!priceId) return { ok: false, code: "payment_unavailable" };

  const metadata = { event_id: event.id, user_id: user.id, product: input.product };
  const back = `${deps.siteUrl}${localePrefix(locale)}/events/${event.id}`;
  const description = `${event.title}`;
  const session = await deps.stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: event.id,
    metadata,
    payment_intent_data: { metadata, description },
    // Stripe makes the invoice (SPEC 13).
    invoice_creation: { enabled: true, invoice_data: { description, metadata } },
    locale: locale === "en" ? "en" : "fr",
    // The placeholder is filled in by Stripe: it must not be encoded.
    success_url: `${back}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?payment=cancelled`,
  });
  if (!session.url) return { ok: false, code: "payment_unavailable" };
  return { ok: true, url: session.url };
}

/** What `apply_purchase` answers (see the migration). */
interface PurchaseAnswer {
  ok: boolean;
  result?: "applied" | "already_applied" | "duplicate_event";
  reason?: string;
  purchase_id?: string;
}

export type ApplyResult =
  | { ok: true; result: "applied" | "already_applied" | "duplicate_event"; purchaseId?: string }
  | { ok: true; result: "not_paid" | "ignored" }
  | { ok: false; reason: string };

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Turns a paid checkout session into a plan and an expiry. Safe to call twice, from the webhook
 * and from the return page, in any order: the database applies a session once.
 */
export async function applyPaidSession(
  admin: Client,
  session: Stripe.Checkout.Session,
  stripeEvent?: { id: string; type: string },
): Promise<ApplyResult> {
  // A card payment is paid at once; a delayed method is paid later, and Stripe says so again.
  if (session.payment_status !== "paid") return { ok: true, result: "not_paid" };
  const metadata = checkoutMetadataSchema.safeParse(session.metadata);
  // Not one of ours (another product on the same Stripe account).
  if (!metadata.success) return { ok: true, result: "ignored" };

  const { months } = productDetails(metadata.data.product);
  const { data, error } = await admin.rpc("apply_purchase", {
    p_event_id: metadata.data.event_id,
    p_user_id: metadata.data.user_id,
    p_session_id: session.id,
    p_payment_intent: idOf(session.payment_intent) as string,
    p_amount_cents: session.amount_total ?? 0,
    p_currency: (session.currency ?? "eur").toLowerCase(),
    p_product: metadata.data.product,
    p_months: months,
    p_stripe_event_id: (stripeEvent?.id ?? null) as string,
    p_stripe_event_type: (stripeEvent?.type ?? null) as string,
  });
  if (error) throw error;

  const answer = data as unknown as PurchaseAnswer;
  if (!answer.ok) return { ok: false, reason: answer.reason ?? "unknown" };
  return {
    ok: true,
    result: answer.result ?? "applied",
    purchaseId: answer.purchase_id,
  };
}

/** What `apply_refund` answers. */
interface RefundAnswer {
  ok: boolean;
  result?: string;
  purchase_id?: string;
  event_id?: string | null;
}

/** A full refund takes the purchase's effects back (R6). A partial refund changes nothing. */
async function applyRefund(
  admin: Client,
  charge: Stripe.Charge,
  stripeEvent: { id: string; type: string },
): Promise<void> {
  if (!charge.refunded) return;
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent) return;

  // Where the expiry goes back to depends on the event date, which only the purchase can tell.
  const { data: purchase, error: purchaseError } = await admin
    .from("purchases")
    .select("event_id, product")
    .eq("stripe_payment_intent_id", paymentIntent)
    .maybeSingle();
  if (purchaseError) throw purchaseError;
  let freeExpiry = new Date();
  if (purchase?.event_id) {
    const { data: event, error } = await admin
      .from("events")
      .select("event_date")
      .eq("id", purchase.event_id)
      .maybeSingle();
    if (error) throw error;
    if (event) freeExpiry = expiryAfterRefund(event.event_date);
  }

  const { months } = productDetails(purchase?.product === "extension" ? "extension" : "event");
  const { data, error } = await admin.rpc("apply_refund", {
    p_payment_intent: paymentIntent,
    p_months: months,
    p_free_expires_at: freeExpiry.toISOString(),
    p_stripe_event_id: stripeEvent.id,
    p_stripe_event_type: stripeEvent.type,
  });
  if (error) throw error;
  const answer = data as unknown as RefundAnswer;
  if (!answer.ok) throw new Error(`apply_refund refused: ${JSON.stringify(answer)}`);
}

export type StripeEventOutcome = "applied" | "ignored";

/**
 * What the application does with a verified Stripe event (SPEC 13): a paid checkout session sets
 * the plan, a full refund takes it back, everything else is ignored. A failure is thrown, so the
 * webhook answers with an error and Stripe sends the event again.
 */
export async function handleStripeEvent(
  admin: Client,
  event: Stripe.Event,
  onApplied?: (purchaseId: string) => Promise<void>,
): Promise<StripeEventOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const result = await applyPaidSession(admin, event.data.object, {
        id: event.id,
        type: event.type,
      });
      if (!result.ok) throw new Error(`apply_purchase refused: ${result.reason}`);
      if (result.ok && result.result === "applied" && result.purchaseId) {
        await onApplied?.(result.purchaseId);
      }
      return result.result === "applied" ? "applied" : "ignored";
    }
    case "charge.refunded":
      await applyRefund(admin, event.data.object, { id: event.id, type: event.type });
      return "applied";
    default:
      return "ignored";
  }
}

export type ConfirmResult = { status: "applied" | "pending" } | { status: "error" };

/**
 * The organiser comes back from the payment page. If the webhook already applied the session, that
 * is the answer. Otherwise the session is read from Stripe itself and, if paid, applied here: the
 * organiser sees the new plan at once even when the webhook is late, or cannot reach a developer's
 * computer. Anything uncertain (Stripe unreachable, a delayed payment method) is "pending", never
 * a failure: the page asks again. Only the buyer of this very session, for this very event, can ask.
 */
export async function confirmCheckoutSession(
  deps: { admin: Client; stripe: StripeApi | null },
  user: { id: string },
  eventId: string,
  sessionId: string,
  onApplied?: (purchaseId: string) => void,
): Promise<ConfirmResult> {
  const { data: known, error } = await deps.admin
    .from("purchases")
    .select("user_id, event_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (known) {
    return known.user_id === user.id && known.event_id === eventId
      ? { status: "applied" }
      : { status: "error" };
  }
  if (!deps.stripe) return { status: "pending" };

  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe.checkout.sessions.retrieve(sessionId);
  } catch (failure) {
    console.error("[payments] could not read the session from Stripe", failure);
    return { status: "pending" };
  }
  const metadata = checkoutMetadataSchema.safeParse(session.metadata);
  if (
    !metadata.success ||
    metadata.data.user_id !== user.id ||
    metadata.data.event_id !== eventId
  ) {
    return { status: "error" };
  }
  const result = await applyPaidSession(deps.admin, session);
  if (!result.ok) return { status: "error" };
  if (result.result === "applied" && result.purchaseId) onApplied?.(result.purchaseId);
  return { status: result.result === "not_paid" ? "pending" : "applied" };
}

export interface PurchaseRow {
  id: string;
  eventId: string | null;
  eventTitle: string;
  product: CheckoutProduct;
  amountCents: number;
  currency: string;
  status: "paid" | "refunded";
  createdAt: string;
}

/** The organiser's payments, newest first. Pass the USER client: RLS shows only their own. */
export async function listPurchases(client: Client): Promise<PurchaseRow[]> {
  const { data, error } = await client
    .from("purchases")
    .select("id, event_id, event_title, product, amount_cents, currency, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    product: row.product === "extension" ? "extension" : "event",
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status === "refunded" ? "refunded" : "paid",
    createdAt: row.created_at,
  }));
}
