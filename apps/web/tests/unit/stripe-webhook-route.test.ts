// @vitest-environment node
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "whsec_unit_test_secret";
const serverEnv: { STRIPE_WEBHOOK_SECRET?: string } = { STRIPE_WEBHOOK_SECRET: SECRET };
vi.mock("@/config/env.server", () => ({ getServerEnv: () => serverEnv }));

const handleStripeEvent = vi.fn();
vi.mock("@/server/payments", () => ({ handleStripeEvent }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));

const { POST } = await import("@/app/api/stripe/webhook/route");

const payload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_x" } },
});

function signed(body: string, secret = SECRET, timestamp?: number) {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp });
}

const call = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.example.test/api/stripe/webhook", {
      method: "POST",
      headers,
      body,
    }),
  );

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.STRIPE_WEBHOOK_SECRET = SECRET;
  handleStripeEvent.mockResolvedValue("applied");
});

describe("SPEC 13: le webhook Stripe est signé", () => {
  it("NF-043: un appel correctement signé est traité et reçoit 200", async () => {
    const response = await call(payload, { "stripe-signature": signed(payload) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "applied" });
    expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    expect(handleStripeEvent.mock.calls[0]?.[1]).toMatchObject({ id: "evt_test_1" });
  });

  it("S-001: sans signature, avec une mauvaise signature ou un corps modifié : 400, rien n'est traité", async () => {
    expect((await call(payload)).status).toBe(400);
    expect(
      (await call(payload, { "stripe-signature": signed(payload, "whsec_autre_secret") })).status,
    ).toBe(400);
    const altered = payload.replace("cs_test_x", "cs_test_y");
    const response = await call(altered, { "stripe-signature": signed(payload) });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("validation_failed");
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("S-001: une signature trop ancienne (rejeu d'un appel capté) est refusée", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const response = await call(payload, { "stripe-signature": signed(payload, SECRET, old) });
    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("sans secret configuré, le webhook est indisponible (503) et ne traite rien", async () => {
    serverEnv.STRIPE_WEBHOOK_SECRET = undefined;
    const response = await call(payload, { "stripe-signature": signed(payload) });
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("payment_unavailable");
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("NF-012: un échec du traitement répond 500, pour que Stripe renvoie l'événement", async () => {
    handleStripeEvent.mockRejectedValue(new Error("database down"));
    const response = await call(payload, { "stripe-signature": signed(payload) });
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("internal_error");
  });
});
