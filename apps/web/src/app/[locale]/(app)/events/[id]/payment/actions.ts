"use server";

import {
  checkoutProductSchema,
  checkoutSessionIdSchema,
  uuidSchema,
  type ApiErrorCode,
} from "@snapalbum/shared";
import { redirect as redirectTo } from "next/navigation";
import { getLocale } from "next-intl/server";
import { clientEnv } from "@/config/env";
import { redirect } from "@/i18n/navigation";
import { schedulePaymentConfirmed } from "@/server/notify-after";
import { getOrganiser } from "@/server/auth";
import {
  confirmCheckoutSession,
  getStripe,
  startCheckout,
  type ConfirmResult,
} from "@/server/payments";
import { checkRateLimit, CHECKOUT_RATE_LIMIT } from "@/server/rate-limit";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type CheckoutState = { status: "idle" } | { status: "error"; code: ApiErrorCode };

/**
 * Opens the payment page for an event (R2, R4). Everything is re-checked here: the signed-in
 * organiser, the owner of the event, its plan and the product. Stripe's page takes the card; this
 * only sends the organiser there.
 */
export async function checkoutAction(
  eventId: string,
  product: string,
  _previous: CheckoutState,
): Promise<CheckoutState> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return redirect({ href: "/login", locale: await getLocale() });

  const parsedProduct = checkoutProductSchema.safeParse(product);
  if (!uuidSchema.safeParse(eventId).success || !parsedProduct.success) {
    return { status: "error", code: "validation_failed" };
  }
  const stripe = getStripe();
  if (!stripe) return { status: "error", code: "payment_unavailable" };

  const limit = await checkRateLimit(CHECKOUT_RATE_LIMIT, user.id);
  if (!limit.allowed) return { status: "error", code: "rate_limited" };

  let url: string;
  try {
    const result = await startCheckout(
      {
        admin: createSupabaseAdminClient(),
        stripe,
        siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""),
      },
      { id: user.id, email: user.email },
      { eventId, product: parsedProduct.data },
      await getLocale(),
    );
    if (!result.ok) return { status: "error", code: result.code };
    url = result.url;
  } catch (error) {
    console.error("[payments] checkout failed", error);
    return { status: "error", code: "payment_unavailable" };
  }
  // Outside the try: a redirect is an exception that must not be caught.
  return redirectTo(url);
}

/**
 * Called when the organiser comes back from the payment page (and polled for a few seconds if
 * the payment is still being confirmed): reads the session from Stripe and applies it if paid.
 */
export async function confirmPaymentAction(
  eventId: string,
  sessionId: string,
): Promise<ConfirmResult> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return { status: "error" };
  if (
    !uuidSchema.safeParse(eventId).success ||
    !checkoutSessionIdSchema.safeParse(sessionId).success
  ) {
    return { status: "error" };
  }
  const admin = createSupabaseAdminClient();
  try {
    return await confirmCheckoutSession(
      { admin, stripe: getStripe() },
      { id: user.id },
      eventId,
      sessionId,
      (purchaseId) => schedulePaymentConfirmed(admin, purchaseId),
    );
  } catch (error) {
    console.error("[payments] confirmation failed", error);
    return { status: "error" };
  }
}
