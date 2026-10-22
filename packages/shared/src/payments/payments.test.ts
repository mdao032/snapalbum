import { describe, expect, it } from "vitest";
import { EXTENSION, PLANS, STRIPE_LOOKUP_KEYS } from "../plans";
import {
  canBuy,
  checkoutMetadataSchema,
  checkoutRequestSchema,
  expiryAfterRefund,
  paymentReturnSchema,
  productDetails,
} from "./index";

const UUID = "a1b2c3d4-0000-4000-8000-123456789abc";

describe("SPEC 13: ce qui s'achète vient de plans.ts", () => {
  it("l'offre Événement : prix et durée de conservation de plans.ts", () => {
    expect(productDetails("event")).toEqual({
      priceCents: PLANS.event.priceCents,
      months: 12,
    });
  });

  it("R4: la prolongation : prix et mois de plans.ts", () => {
    expect(productDetails("extension")).toEqual({
      priceCents: EXTENSION.priceCents,
      months: EXTENSION.months,
    });
  });

  it("chaque produit a un nom Stripe stable et distinct", () => {
    expect(new Set(Object.values(STRIPE_LOOKUP_KEYS)).size).toBe(2);
  });
});

describe("R2, R4: qui peut acheter quoi", () => {
  it("un événement gratuit actif peut passer à l'offre Événement, avant, pendant ou après la fête", () => {
    expect(canBuy({ product: "event", plan: "free", status: "active" })).toEqual({ ok: true });
  });

  it("un événement déjà payant ne se rachète pas, mais se prolonge", () => {
    expect(canBuy({ product: "event", plan: "event", status: "active" })).toEqual({
      ok: false,
      reason: "already_upgraded",
    });
    expect(canBuy({ product: "extension", plan: "event", status: "active" })).toEqual({ ok: true });
    expect(canBuy({ product: "extension", plan: "free", status: "active" })).toEqual({ ok: true });
  });

  it("un événement suspendu ou en suppression ne vend rien, l'offre Pro non plus", () => {
    expect(canBuy({ product: "event", plan: "free", status: "suspended" })).toMatchObject({
      reason: "not_active",
    });
    expect(
      canBuy({ product: "extension", plan: "event", status: "pending_deletion" }),
    ).toMatchObject({ reason: "not_active" });
    expect(canBuy({ product: "extension", plan: "pro", status: "active" })).toMatchObject({
      reason: "plan_not_sold",
    });
  });
});

describe("NF-043: ce qui entre par le paiement est validé", () => {
  it("la demande de paiement exige un identifiant d'événement et un produit connu", () => {
    expect(checkoutRequestSchema.safeParse({ eventId: UUID, product: "event" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ eventId: "x", product: "event" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ eventId: UUID, product: "pro" }).success).toBe(false);
  });

  it("les métadonnées d'une session doivent être complètes", () => {
    expect(
      checkoutMetadataSchema.safeParse({ event_id: UUID, user_id: UUID, product: "extension" })
        .success,
    ).toBe(true);
    expect(checkoutMetadataSchema.safeParse({ event_id: UUID, product: "event" }).success).toBe(
      false,
    );
  });

  it("l'adresse de retour : succès avec une session Stripe valide, ou annulation", () => {
    expect(
      paymentReturnSchema.safeParse({ payment: "success", session_id: "cs_test_a1B2c3D4e5F6g7" })
        .success,
    ).toBe(true);
    expect(paymentReturnSchema.safeParse({ payment: "cancelled" }).success).toBe(true);
    expect(paymentReturnSchema.safeParse({ payment: "success", session_id: "../x" }).success).toBe(
      false,
    );
    expect(paymentReturnSchema.safeParse({ payment: "other" }).success).toBe(false);
  });
});

describe("R6: après un remboursement, la conservation gratuite revient", () => {
  it("30 jours après la date de l'événement, comme à la création", () => {
    expect(expiryAfterRefund("2026-09-12").toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });
});
