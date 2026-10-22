import { apiError, apiJson, guarded } from "@/server/api-response";
import { getServerEnv } from "@/config/env.server";
import { schedulePaymentConfirmed } from "@/server/notify-after";
import { handleStripeEvent } from "@/server/payments";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import Stripe from "stripe";

/**
 * The Stripe webhook (SPEC 13). The body is read as raw text and its signature checked against the
 * signing secret before anything else is looked at: an unsigned or altered call is refused. A
 * handled event is journaled by the database, so a replay (Stripe retries until it gets a 2xx) has
 * no second effect. A failure answers 500 on purpose, so that Stripe sends the event again.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const secret = getServerEnv().STRIPE_WEBHOOK_SECRET;
    if (!secret) return apiError(503, "payment_unavailable");

    const signature = request.headers.get("stripe-signature");
    if (!signature) return apiError(400, "validation_failed");
    const body = await request.text();

    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      return apiError(400, "validation_failed");
    }

    const admin = createSupabaseAdminClient();
    const outcome = await handleStripeEvent(admin, event, async (purchaseId) => {
      // After the answer: Stripe is not kept waiting, and a mail problem never fails the webhook.
      schedulePaymentConfirmed(admin, purchaseId);
    });
    return apiJson({ received: true, outcome });
  });
}
