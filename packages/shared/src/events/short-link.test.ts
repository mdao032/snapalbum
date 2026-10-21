import { describe, expect, it } from "vitest";
import { generatePublicCode } from "./code";
import { cardQuerySchema, qrQuerySchema } from "./printables";
import { buildShortLink, shortLinkCodeOf } from "./short-link";

describe("F-012: lien court", () => {
  it("F-012: reconnaît un code d'événement seul dans le chemin", () => {
    const code = generatePublicCode();
    expect(shortLinkCodeOf(`/${code}`)).toBe(code);
  });

  it.each([
    "/",
    "/login",
    "/account",
    "/en",
    "/en/login",
    "/k7m2x9qvbr/extra",
    "/K7M2X9QVBR",
    "/k7m2x9qvb0",
    "/k7m2x9qvb",
  ])("F-012: %s n'est pas un lien court", (path) => {
    expect(shortLinkCodeOf(path)).toBeNull();
  });

  it("F-012: construit le lien à partir de la base, avec ou sans barre finale", () => {
    expect(buildShortLink("https://s.example.test", "k7m2x9qvbr")).toBe(
      "https://s.example.test/k7m2x9qvbr",
    );
    expect(buildShortLink("https://s.example.test/", "k7m2x9qvbr")).toBe(
      "https://s.example.test/k7m2x9qvbr",
    );
  });
});

describe("F-013: paramètres du QR code et des cartes", () => {
  it("F-013: valeurs par défaut quand les paramètres sont absents ou invalides", () => {
    expect(qrQuerySchema.parse({})).toEqual({ format: "svg", color: "ink", download: false });
    expect(qrQuerySchema.parse({ format: "gif", color: "red", download: "yes" })).toEqual({
      format: "svg",
      color: "ink",
      download: false,
    });
  });

  it("F-013: accepte PNG, couleur de l'événement et téléchargement", () => {
    expect(qrQuerySchema.parse({ format: "png", color: "accent", download: "1" })).toEqual({
      format: "png",
      color: "accent",
      download: true,
    });
  });

  it("F-014: le format de carte est obligatoire et limité à A6, A5 et chevalet", () => {
    expect(cardQuerySchema.safeParse({}).success).toBe(false);
    expect(cardQuerySchema.safeParse({ format: "a4" }).success).toBe(false);
    for (const format of ["a6", "a5", "tent"]) {
      expect(cardQuerySchema.parse({ format }).format).toBe(format);
    }
  });
});
