import { describe, expect, it } from "vitest";
import { buildSentryOptions } from "@/lib/sentry-options";

describe("G-002: Sentry ne collecte aucune donnée personnelle", () => {
  it("G-002: désactive l'identité, les cookies, les en-têtes, les corps et les paramètres d'URL", () => {
    const options = buildSentryOptions("https://key@sentry.test/1", "preview");
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    expect(options.environment).toBe("preview");
  });

  it("utilise « production » quand aucun environnement n'est précisé", () => {
    expect(buildSentryOptions("https://key@sentry.test/1", undefined).environment).toBe(
      "production",
    );
    expect(buildSentryOptions("https://key@sentry.test/1", "").environment).toBe("production");
  });
});
