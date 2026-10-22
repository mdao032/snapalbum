// @vitest-environment node
import { describe, expect, it } from "vitest";
import { localePrefix, pageUrl, siteOrigin } from "@/server/urls";

describe("SPEC 12: les adresses écrites dans les e-mails suivent la langue", () => {
  it("le français n'a pas de préfixe, l'anglais a /en", () => {
    expect(localePrefix("fr")).toBe("");
    expect(localePrefix("en")).toBe("/en");
  });

  it("l'adresse d'une page part du site, sans double barre", () => {
    expect(siteOrigin()).toBe("http://localhost:3000");
    expect(pageUrl("fr", "/events/abc")).toBe("http://localhost:3000/events/abc");
    expect(pageUrl("en", "/events/abc")).toBe("http://localhost:3000/en/events/abc");
  });
});
