import { describe, expect, it } from "vitest";
import { accessCodeSchema, joinEventRequestSchema, TERMS_VERSION } from "./guest";
import { updateEventSettingsSchema } from "../events/settings";

const join = { eventCode: "k7m2x9qvbr", acceptTerms: true };

describe("F-034: adhésion d'un invité", () => {
  it("F-034: accepte la demande minimale : un code d'événement et les conditions acceptées", () => {
    expect(joinEventRequestSchema.safeParse(join).success).toBe(true);
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });

  it("F-034: refuse sans acceptation explicite des conditions, quelle que soit la forme", () => {
    for (const acceptTerms of [false, undefined, "true", 1, null]) {
      expect(joinEventRequestSchema.safeParse({ ...join, acceptTerms }).success).toBe(false);
    }
  });

  it("F-033: le prénom est facultatif, nettoyé, et un prénom vide vaut « pas de prénom »", () => {
    expect(joinEventRequestSchema.parse({ ...join, displayName: "  Élodie  " }).displayName).toBe(
      "Élodie",
    );
    expect(
      joinEventRequestSchema.parse({ ...join, displayName: "   " }).displayName,
    ).toBeUndefined();
    expect(joinEventRequestSchema.parse(join).displayName).toBeUndefined();
  });

  it("F-033: refuse un prénom de plus de 60 caractères", () => {
    expect(joinEventRequestSchema.safeParse({ ...join, displayName: "a".repeat(61) }).success).toBe(
      false,
    );
  });

  it("S-002: refuse un code d'événement mal formé", () => {
    expect(joinEventRequestSchema.safeParse({ ...join, eventCode: "../x" }).success).toBe(false);
  });
});

describe("F-017: code d'accès", () => {
  it.each(["1234", "12345", "123456", "0000"])("accepte %s", (code) => {
    expect(accessCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(["123", "1234567", "12a4", "", " 1234", "1234 ", "١٢٣٤"])("refuse %j", (code) => {
    expect(accessCodeSchema.safeParse(code).success).toBe(false);
  });

  it("F-017: l'organisateur peut définir, laisser ou retirer le code dans les réglages", () => {
    const base = {
      gallery_visible: true,
      require_approval: false,
      upload_opens_at: "2026-09-05T00:00:00.000Z",
      upload_closes_at: "2026-10-12T00:00:00.000Z",
    };
    expect(updateEventSettingsSchema.parse({ ...base, access_code: "4821" }).access_code).toBe(
      "4821",
    );
    expect(updateEventSettingsSchema.parse({ ...base, access_code: "" }).access_code).toBe("");
    expect(updateEventSettingsSchema.parse(base).access_code).toBeUndefined();
    expect(updateEventSettingsSchema.safeParse({ ...base, access_code: "12" }).success).toBe(false);
  });
});
