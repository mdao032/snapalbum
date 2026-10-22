import { EXTENSION, PLANS } from "@snapalbum/shared";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPaidSession,
  clearPriceCache,
  confirmCheckoutSession,
  handleStripeEvent,
  startCheckout,
  type StripeApi,
} from "@/server/payments";
import { fakeAdmin, type Row } from "./fake-admin";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const SESSION = "cs_test_a1B2c3D4e5F6g7H8";

function stripeWith(options: { unitAmount?: number; url?: string | null } = {}) {
  const create = vi.fn(async (_params: unknown) => ({
    url: options.url === undefined ? "https://checkout.stripe.test/pay/cs_test_x" : options.url,
  }));
  const list = vi.fn(async () => ({
    data: [{ id: "price_event", unit_amount: options.unitAmount ?? 4900, currency: "eur" }],
  }));
  const retrieve = vi.fn();
  const stripe = {
    prices: { list },
    checkout: { sessions: { create, retrieve } },
  } as unknown as StripeApi;
  return { stripe, create, list, retrieve };
}

function admin(event: Row = {}, rpc: Record<string, (args: Row) => unknown> = {}) {
  return fakeAdmin(
    {
      events: [
        {
          id: EVENT,
          owner_id: OWNER,
          title: "Mariage de Léa et Tom",
          plan: "free",
          status: "active",
          ...event,
        },
      ],
      purchases: [],
    },
    rpc,
  );
}

const input = { eventId: EVENT, product: "event" } as const;
const owner = { id: OWNER, email: "lea@example.test" };
const SITE = "https://snapalbum.test";

beforeEach(() => clearPriceCache());

describe("SPEC 13: ouvrir la page de paiement", () => {
  it("R2: crée une session de paiement unique, liée à l'événement et à l'acheteur", async () => {
    const { stripe, create } = stripeWith();
    const result = await startCheckout(
      { admin: admin(), stripe, siteUrl: SITE },
      owner,
      input,
      "fr",
    );
    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/pay/cs_test_x" });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]?.[0] as unknown as Stripe.Checkout.SessionCreateParams;
    expect(params).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_event", quantity: 1 }],
      customer_email: "lea@example.test",
      client_reference_id: EVENT,
      metadata: { event_id: EVENT, user_id: OWNER, product: "event" },
      payment_intent_data: { metadata: { event_id: EVENT, user_id: OWNER, product: "event" } },
      invoice_creation: { enabled: true },
      locale: "fr",
    });
    // The placeholder is left for Stripe to fill in, not encoded.
    expect(params.success_url).toBe(
      `${SITE}/events/${EVENT}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(params.cancel_url).toBe(`${SITE}/events/${EVENT}?payment=cancelled`);
  });

  it("l'adresse de retour garde la langue de l'organisateur", async () => {
    const { stripe, create } = stripeWith();
    await startCheckout({ admin: admin(), stripe, siteUrl: SITE }, owner, input, "en");
    const params = create.mock.calls[0]?.[0] as unknown as Stripe.Checkout.SessionCreateParams;
    expect(params.success_url).toContain(`${SITE}/en/events/${EVENT}?payment=success`);
    expect(params.locale).toBe("en");
  });

  it("S-001: l'événement d'un autre ou inconnu est introuvable, rien n'est demandé à Stripe", async () => {
    const { stripe, create } = stripeWith();
    expect(
      await startCheckout(
        { admin: admin(), stripe, siteUrl: SITE },
        { id: STRANGER, email: "x@example.test" },
        input,
        "fr",
      ),
    ).toEqual({ ok: false, code: "not_found" });
    expect(create).not.toHaveBeenCalled();
  });

  it("un événement déjà payant ne se rachète pas, une prolongation est possible", async () => {
    const { stripe, create } = stripeWith();
    const paid = admin({ plan: "event" });
    expect(await startCheckout({ admin: paid, stripe, siteUrl: SITE }, owner, input, "fr")).toEqual(
      {
        ok: false,
        code: "already_upgraded",
      },
    );
    const extension = stripeWith({ unitAmount: EXTENSION.priceCents });
    const result = await startCheckout(
      { admin: paid, stripe: extension.stripe, siteUrl: SITE },
      owner,
      { eventId: EVENT, product: "extension" },
      "fr",
    );
    expect(result.ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("un événement suspendu ou en suppression n'ouvre aucun paiement", async () => {
    const { stripe } = stripeWith();
    for (const status of ["suspended", "pending_deletion"]) {
      expect(
        await startCheckout(
          { admin: admin({ status }), stripe, siteUrl: SITE },
          owner,
          input,
          "fr",
        ),
      ).toEqual({ ok: false, code: "event_suspended" });
    }
  });

  it("le montant du prix Stripe est contrôlé : un prix périmé n'ouvre pas de paiement", async () => {
    const { stripe, create } = stripeWith({ unitAmount: PLANS.event.priceCents! - 100 });
    expect(
      await startCheckout({ admin: admin(), stripe, siteUrl: SITE }, owner, input, "fr"),
    ).toEqual({ ok: false, code: "payment_unavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  it("une session sans adresse n'est pas envoyée à l'organisateur", async () => {
    const { stripe } = stripeWith({ url: null });
    expect(
      await startCheckout({ admin: admin(), stripe, siteUrl: SITE }, owner, input, "fr"),
    ).toEqual({ ok: false, code: "payment_unavailable" });
  });

  it("les prix trouvés sont gardés quelques minutes", async () => {
    const { stripe, list } = stripeWith();
    await startCheckout({ admin: admin(), stripe, siteUrl: SITE }, owner, input, "fr");
    await startCheckout({ admin: admin(), stripe, siteUrl: SITE }, owner, input, "fr");
    expect(list).toHaveBeenCalledTimes(1);
  });
});

const session = (change: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session =>
  ({
    id: SESSION,
    payment_status: "paid",
    amount_total: 4900,
    currency: "eur",
    payment_intent: "pi_123",
    metadata: { event_id: EVENT, user_id: OWNER, product: "event" },
    ...change,
  }) as unknown as Stripe.Checkout.Session;

describe("SPEC 13: appliquer un paiement confirmé par Stripe", () => {
  it("passe les valeurs de plans.ts et de la session à la base, en minuscules", async () => {
    const apply = vi.fn(() => ({ ok: true, result: "applied", purchase_id: "p1" }));
    const result = await applyPaidSession(
      admin({}, { apply_purchase: apply }),
      session({ currency: "EUR" } as never),
      { id: "evt_1", type: "checkout.session.completed" },
    );
    expect(result).toEqual({ ok: true, result: "applied", purchaseId: "p1" });
    expect(apply).toHaveBeenCalledWith({
      p_event_id: EVENT,
      p_user_id: OWNER,
      p_session_id: SESSION,
      p_payment_intent: "pi_123",
      p_amount_cents: 4900,
      p_currency: "eur",
      p_product: "event",
      p_months: 12,
      p_stripe_event_id: "evt_1",
      p_stripe_event_type: "checkout.session.completed",
    });
  });

  it("une prolongation donne les mois de plans.ts", async () => {
    const apply = vi.fn(() => ({ ok: true, result: "applied", purchase_id: "p2" }));
    await applyPaidSession(
      admin({}, { apply_purchase: apply }),
      session({ metadata: { event_id: EVENT, user_id: OWNER, product: "extension" } }),
    );
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ p_months: EXTENSION.months }));
  });

  it("un paiement pas encore encaissé (moyen différé) n'applique rien", async () => {
    const apply = vi.fn();
    expect(
      await applyPaidSession(
        admin({}, { apply_purchase: apply }),
        session({ payment_status: "unpaid" }),
      ),
    ).toEqual({ ok: true, result: "not_paid" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("une session qui n'est pas la nôtre (métadonnées absentes ou fausses) est ignorée", async () => {
    const apply = vi.fn();
    const db = admin({}, { apply_purchase: apply });
    expect(await applyPaidSession(db, session({ metadata: {} }))).toEqual({
      ok: true,
      result: "ignored",
    });
    expect(
      await applyPaidSession(
        db,
        session({ metadata: { event_id: "x", user_id: OWNER, product: "event" } }),
      ),
    ).toEqual({ ok: true, result: "ignored" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("un refus de la base (événement disparu) est remonté", async () => {
    const result = await applyPaidSession(
      admin({}, { apply_purchase: () => ({ ok: false, reason: "event_not_found" }) }),
      session(),
    );
    expect(result).toEqual({ ok: false, reason: "event_not_found" });
  });
});

const stripeEvent = (type: string, object: unknown): Stripe.Event =>
  ({ id: "evt_9", type, data: { object } }) as unknown as Stripe.Event;

describe("SPEC 13: le webhook", () => {
  it("checkout.session.completed applique le paiement et prévient le code appelant", async () => {
    const apply = vi.fn(() => ({ ok: true, result: "applied", purchase_id: "p1" }));
    const onApplied = vi.fn(async () => undefined);
    const outcome = await handleStripeEvent(
      admin({}, { apply_purchase: apply }),
      stripeEvent("checkout.session.completed", session()),
      onApplied,
    );
    expect(outcome).toBe("applied");
    expect(onApplied).toHaveBeenCalledWith("p1");
  });

  it("NF-012: un événement rejoué ne déclenche rien de plus", async () => {
    const onApplied = vi.fn(async () => undefined);
    const outcome = await handleStripeEvent(
      admin({}, { apply_purchase: () => ({ ok: true, result: "duplicate_event" }) }),
      stripeEvent("checkout.session.completed", session()),
      onApplied,
    );
    expect(outcome).toBe("ignored");
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("un échec de la base est une erreur : le webhook répond 500 et Stripe réessaie", async () => {
    await expect(
      handleStripeEvent(
        admin({}, { apply_purchase: () => ({ ok: false, reason: "event_not_found" }) }),
        stripeEvent("checkout.session.completed", session()),
      ),
    ).rejects.toThrow(/refused/);
  });

  it("charge.refunded : un remboursement complet est transmis avec la conservation gratuite", async () => {
    const refund = vi.fn(() => ({ ok: true, result: "refunded" }));
    const db = fakeAdmin(
      {
        purchases: [{ stripe_payment_intent_id: "pi_123", event_id: EVENT, product: "event" }],
        events: [{ id: EVENT, event_date: "2026-09-12" }],
      },
      { apply_refund: refund },
    );
    await handleStripeEvent(
      db,
      stripeEvent("charge.refunded", { refunded: true, payment_intent: "pi_123" }),
    );
    expect(refund).toHaveBeenCalledWith({
      p_payment_intent: "pi_123",
      p_months: 12,
      p_free_expires_at: "2026-10-13T00:00:00.000Z",
      p_stripe_event_id: "evt_9",
      p_stripe_event_type: "charge.refunded",
    });
  });

  it("un remboursement partiel ne change rien, un autre type d'événement est ignoré", async () => {
    const refund = vi.fn();
    const db = admin({}, { apply_refund: refund, apply_purchase: refund });
    await handleStripeEvent(
      db,
      stripeEvent("charge.refunded", { refunded: false, payment_intent: "pi_123" }),
    );
    expect(await handleStripeEvent(db, stripeEvent("customer.created", {}))).toBe("ignored");
    expect(refund).not.toHaveBeenCalled();
  });
});

describe("SPEC 13: retour de la page de paiement", () => {
  it("S-001: seul l'acheteur de cette session, pour cet événement, peut la confirmer", async () => {
    const { stripe, retrieve } = stripeWith();
    retrieve.mockResolvedValue(session());
    const apply = vi.fn(() => ({ ok: true, result: "already_applied" }));
    const deps = { admin: admin({}, { apply_purchase: apply }), stripe, siteUrl: SITE };

    expect(await confirmCheckoutSession(deps, { id: STRANGER }, EVENT, SESSION)).toEqual({
      status: "error",
    });
    expect(
      await confirmCheckoutSession(
        deps,
        { id: OWNER },
        "4a2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d99",
        SESSION,
      ),
    ).toEqual({ status: "error" });
    expect(apply).not.toHaveBeenCalled();

    expect(await confirmCheckoutSession(deps, { id: OWNER }, EVENT, SESSION)).toEqual({
      status: "applied",
    });
  });

  it("un paiement pas encore confirmé par Stripe reste « en attente »", async () => {
    const { stripe, retrieve } = stripeWith();
    retrieve.mockResolvedValue(session({ payment_status: "unpaid" }));
    const deps = { admin: admin(), stripe, siteUrl: SITE };
    expect(await confirmCheckoutSession(deps, { id: OWNER }, EVENT, SESSION)).toEqual({
      status: "pending",
    });
  });

  it("si le webhook est déjà passé, la réponse vient de la base, sans appeler Stripe", async () => {
    const { stripe, retrieve } = stripeWith();
    const db = fakeAdmin({
      purchases: [{ stripe_checkout_session_id: SESSION, user_id: OWNER, event_id: EVENT }],
    });
    const deps = { admin: db, stripe };
    expect(await confirmCheckoutSession(deps, { id: OWNER }, EVENT, SESSION)).toEqual({
      status: "applied",
    });
    expect(retrieve).not.toHaveBeenCalled();
    // Someone else's purchase is not confirmed to anyone.
    expect(await confirmCheckoutSession(deps, { id: STRANGER }, EVENT, SESSION)).toEqual({
      status: "error",
    });
  });

  it("Stripe injoignable, ou pas configuré : « en attente », jamais un échec définitif", async () => {
    const { stripe, retrieve } = stripeWith();
    retrieve.mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await confirmCheckoutSession({ admin: admin(), stripe }, { id: OWNER }, EVENT, SESSION),
    ).toEqual({ status: "pending" });
    expect(
      await confirmCheckoutSession({ admin: admin(), stripe: null }, { id: OWNER }, EVENT, SESSION),
    ).toEqual({ status: "pending" });
  });
});
