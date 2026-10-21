import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN_PATH, sanitizeRedirectPath, stripLocalePrefix } from "./redirect";
import { magicLinkRequestSchema, profileUpdateSchema } from "./schemas";

describe("F-001: redirection après connexion", () => {
  it("F-001: garde un chemin du site, avec sa recherche", () => {
    expect(sanitizeRedirectPath("/account")).toBe("/account");
    expect(sanitizeRedirectPath("/en/events?tab=past")).toBe("/en/events?tab=past");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "account",
    "/ok\nSet-Cookie: a=b",
    "/\t/evil.example",
    "",
  ])("F-001: refuse la cible dangereuse %j", (raw) => {
    expect(sanitizeRedirectPath(raw)).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it("F-001: refuse une cible absente ou trop longue", () => {
    expect(sanitizeRedirectPath(undefined)).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(sanitizeRedirectPath(null)).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(sanitizeRedirectPath(`/${"a".repeat(600)}`)).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it("F-001: n'envoie jamais vers la connexion ni vers les routes d'authentification", () => {
    expect(sanitizeRedirectPath("/login")).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(sanitizeRedirectPath("/en/login/check-email")).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(sanitizeRedirectPath("/auth/confirm?token_hash=x")).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it("F-001: accepte une valeur de repli personnalisée", () => {
    expect(sanitizeRedirectPath("//x", "/")).toBe("/");
  });

  it("section 12: retire le préfixe de langue", () => {
    expect(stripLocalePrefix("/en/account")).toBe("/account");
    expect(stripLocalePrefix("/en")).toBe("/");
    expect(stripLocalePrefix("/account")).toBe("/account");
    expect(stripLocalePrefix("/english")).toBe("/english");
  });
});

describe("F-001: demande de lien magique", () => {
  it("F-001: normalise l'adresse e-mail", () => {
    const parsed = magicLinkRequestSchema.parse({ email: "  Lea@Example.COM ", locale: "fr" });
    expect(parsed.email).toBe("lea@example.com");
  });

  it("F-001: refuse une adresse invalide ou une langue inconnue", () => {
    expect(magicLinkRequestSchema.safeParse({ email: "pas-un-email", locale: "fr" }).success).toBe(
      false,
    );
    expect(magicLinkRequestSchema.safeParse({ email: "a@b.fr", locale: "de" }).success).toBe(false);
  });
});

describe("F-003: profil", () => {
  it("F-003: un nom vide devient null et les espaces sont retirés", () => {
    expect(profileUpdateSchema.parse({ displayName: "   ", locale: "en" })).toEqual({
      displayName: null,
      locale: "en",
    });
    expect(profileUpdateSchema.parse({ displayName: " Dao ", locale: "fr" }).displayName).toBe(
      "Dao",
    );
  });

  it("F-003: refuse un nom de plus de 100 caractères", () => {
    expect(
      profileUpdateSchema.safeParse({ displayName: "a".repeat(101), locale: "fr" }).success,
    ).toBe(false);
  });
});
