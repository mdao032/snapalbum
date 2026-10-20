import { describe, expect, it } from "vitest";
import {
  PUBLIC_CODE_ALPHABET,
  PUBLIC_CODE_LENGTH,
  createEventSchema,
  publicCodeSchema,
  reserveUploadRequestSchema,
} from "./index";

describe("F-012: code public", () => {
  it("F-012: l'alphabet exclut les caractères ambigus", () => {
    for (const ambiguous of ["0", "o", "1", "l", "i"]) {
      expect(PUBLIC_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("F-012: exige au moins 10 caractères valides", () => {
    expect(publicCodeSchema.safeParse("k7m2x9qvbr").success).toBe(true);
    expect("k7m2x9qvbr".length).toBe(PUBLIC_CODE_LENGTH);
    expect(publicCodeSchema.safeParse("k7m2x9qvb").success).toBe(false);
    expect(publicCodeSchema.safeParse("k7m2x9qvb0").success).toBe(false);
  });
});

describe("F-010: création d'événement", () => {
  const valid = {
    title: "Mariage de Léa et Tom",
    eventDate: "2026-09-12",
    type: "wedding",
    locale: "fr",
  };

  it("F-010: accepte un événement valide", () => {
    expect(createEventSchema.safeParse(valid).success).toBe(true);
  });

  it("F-010: refuse un nom vide et une date invalide", () => {
    expect(createEventSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...valid, eventDate: "demain" }).success).toBe(false);
  });

  it("F-011: limite le message d'accueil à 500 caractères", () => {
    expect(createEventSchema.safeParse({ ...valid, welcomeMessage: "a".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("S-002: réservation d'envoi", () => {
  it("S-002: refuse une empreinte qui n'est pas un SHA-256", () => {
    const result = reserveUploadRequestSchema.safeParse({
      eventCode: "k7m2x9qvbr",
      kind: "photo",
      sha256: "abc",
      mimeType: "image/jpeg",
      bytes: 10,
    });
    expect(result.success).toBe(false);
  });
});
