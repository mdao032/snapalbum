import { describe, expect, it } from "vitest";
import {
  BETA_GATE,
  conversionRate,
  sendSuccessRate,
  estimateStorageCostCents,
  shouldAlertStorage,
  storageThresholdBytes,
  stripePaymentUrl,
} from "./index";

const GB = 1024 ** 3;
const NOW = new Date("2026-10-22T10:00:00Z");

describe("F-092: chiffres de l'espace administrateur", () => {
  it("le coût estimé suit le volume : 100 Go coûtent environ 1,40 € par mois", () => {
    expect(estimateStorageCostCents(100 * GB)).toBe(140);
    expect(estimateStorageCostCents(0)).toBe(0);
    expect(estimateStorageCostCents(-5)).toBe(0);
  });

  it("le taux de conversion est la part des événements payants, bornée, 0 sans événement", () => {
    expect(conversionRate(5, 20)).toBe(0.25);
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(30, 20)).toBe(1);
    expect(conversionRate(-1, 20)).toBe(0);
  });

  it("un paiement s'ouvre dans le tableau de bord Stripe, identifiant protégé", () => {
    expect(stripePaymentUrl("pi_123")).toBe("https://dashboard.stripe.com/test/payments/pi_123");
    expect(stripePaymentUrl("pi/../x")).not.toContain("../");
  });
});

describe("SPEC 9.3: alerte de stockage", () => {
  const over = { totalBytes: 600 * GB, thresholdBytes: 500 * GB };

  it("prévient quand le total dépasse le seuil et qu'aucune alerte n'est partie récemment", () => {
    expect(shouldAlertStorage({ ...over, lastAlertAt: null, now: NOW })).toBe(true);
    expect(
      shouldAlertStorage({ ...over, lastAlertAt: new Date("2026-10-10T10:00:00Z"), now: NOW }),
    ).toBe(true);
  });

  it("ne répète pas l'alerte avant 7 jours", () => {
    expect(
      shouldAlertStorage({ ...over, lastAlertAt: new Date("2026-10-18T10:00:00Z"), now: NOW }),
    ).toBe(false);
    expect(
      shouldAlertStorage({ ...over, lastAlertAt: new Date("2026-10-15T10:00:00Z"), now: NOW }),
    ).toBe(true);
  });

  it("jamais sous le seuil, ni sans seuil configuré", () => {
    expect(
      shouldAlertStorage({
        totalBytes: 400 * GB,
        thresholdBytes: 500 * GB,
        lastAlertAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldAlertStorage({
        totalBytes: 500 * GB,
        thresholdBytes: 500 * GB,
        lastAlertAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldAlertStorage({ totalBytes: GB, thresholdBytes: null, lastAlertAt: null, now: NOW }),
    ).toBe(false);
  });

  it("le seuil de l'environnement est en gigaoctets, vide ou absurde : pas de seuil", () => {
    expect(storageThresholdBytes(500)).toBe(500 * GB);
    expect(storageThresholdBytes(0.5)).toBe(GB / 2);
    for (const value of [undefined, null, 0, -3, Number.NaN]) {
      expect(storageThresholdBytes(value)).toBeNull();
    }
  });
});

describe("6.3: réussite des envois de la bêta", () => {
  it("6.3: part des envois arrivés au serveur qui ont été livrés ; rien à mesurer, rien", () => {
    expect(sendSuccessRate(995, 5)).toBe(0.995);
    expect(sendSuccessRate(10, 0)).toBe(1);
    expect(sendSuccessRate(0, 4)).toBe(0);
    expect(sendSuccessRate(0, 0)).toBeNull();
  });

  it("6.3: la porte de la phase 6 : trois événements, plus de 99,5 %, la moitié prête à payer", () => {
    expect(BETA_GATE).toEqual({ events: 3, sendSuccessRate: 0.995, wouldPayShare: 0.5 });
    expect(sendSuccessRate(994, 6)! >= BETA_GATE.sendSuccessRate).toBe(false);
    expect(sendSuccessRate(996, 4)! >= BETA_GATE.sendSuccessRate).toBe(true);
  });
});
