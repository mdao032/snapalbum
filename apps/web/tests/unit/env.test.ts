import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseClientEnv } from "@/config/env";

const valid = {
  NEXT_PUBLIC_SITE_URL: "https://example.test",
  NEXT_PUBLIC_SHORT_LINK_BASE: "https://s.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
  NEXT_PUBLIC_SENTRY_DSN: "",
  NEXT_PUBLIC_POSTHOG_KEY: undefined,
};

describe("NF-043: variables d'environnement publiques", () => {
  it("NF-043: accepte une configuration valide et traite les chaînes vides comme absentes", () => {
    const env = parseClientEnv(valid);
    expect(env.NEXT_PUBLIC_SHORT_LINK_BASE).toBe("https://s.example.test");
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("S-007: échoue au démarrage quand une variable obligatoire manque", () => {
    expect(() => parseClientEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("NF-043: refuse une URL invalide", () => {
    expect(() => parseClientEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "pas-une-url" })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });
});

describe("S-007: variables d'environnement serveur", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S-007: exige la clé de service Supabase", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getServerEnv } = await import("@/config/env.server");
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("Stripe: refuse une clé qui n'est pas une clé de test", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    const { getServerEnv } = await import("@/config/env.server");
    expect(() => getServerEnv()).toThrow(/test keys/);
  });

  it("lit les variables une seule fois et les met en cache", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    const { getServerEnv } = await import("@/config/env.server");
    const first = getServerEnv();
    expect(first.STRIPE_SECRET_KEY).toBe("sk_test_abc");
    expect(getServerEnv()).toBe(first);
  });
});
