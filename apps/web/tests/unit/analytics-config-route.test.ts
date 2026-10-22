// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/analytics-config/route";

const saved = { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST };

afterEach(() => {
  for (const [name, value] of [
    ["POSTHOG_KEY", saved.key],
    ["POSTHOG_HOST", saved.host],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("G-003: la page demande si une mesure est configurée", () => {
  it("sans clé : 204, rien à gérer, pas de cache", async () => {
    delete process.env.POSTHOG_KEY;
    const response = GET();
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("avec une clé : la clé et l'adresse européenne, mises en cache quelques minutes", async () => {
    process.env.POSTHOG_KEY = "phc_x";
    delete process.env.POSTHOG_HOST;
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: "phc_x", host: "https://eu.i.posthog.com" });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
