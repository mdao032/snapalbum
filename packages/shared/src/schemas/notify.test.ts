import { describe, expect, it } from "vitest";
import { emailSchema } from "../auth/schemas";
import { notifyRequestSchema } from "./guest";

const eventCode = "k7m2x9qvbr";

describe("F-044: l'e-mail laissé par un invité", () => {
  it("F-044: l'adresse est nettoyée : espaces retirés, minuscules", () => {
    expect(emailSchema.parse("  Elodie.Martin@Example.COM ")).toBe("elodie.martin@example.com");
  });

  it("F-044: accepte une demande avec une adresse et le consentement", () => {
    const parsed = notifyRequestSchema.parse({
      action: "set",
      eventCode,
      email: " Anna@Example.com ",
      consent: true,
    });
    expect(parsed).toEqual({ action: "set", eventCode, email: "anna@example.com", consent: true });
  });

  it.each([
    ["sans consentement", { action: "set", eventCode, email: "a@example.com", consent: false }],
    ["avec un consentement absent", { action: "set", eventCode, email: "a@example.com" }],
    [
      "avec une adresse invalide",
      { action: "set", eventCode, email: "pas-une-adresse", consent: true },
    ],
    [
      "avec une adresse trop longue",
      { action: "set", eventCode, email: `${"a".repeat(250)}@x.fr`, consent: true },
    ],
    ["sans code d'événement", { action: "set", email: "a@example.com", consent: true }],
    ["avec une action inconnue", { action: "send", eventCode }],
  ])("F-044, NF-043: refuse une demande %s", (_name, body) => {
    expect(notifyRequestSchema.safeParse(body).success).toBe(false);
  });

  it("F-044: retirer son adresse ne demande ni adresse ni consentement", () => {
    expect(notifyRequestSchema.parse({ action: "clear", eventCode })).toEqual({
      action: "clear",
      eventCode,
    });
  });
});
