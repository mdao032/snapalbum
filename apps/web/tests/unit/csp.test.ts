import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/config/csp";

const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ") ?? [];

const production = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.de.sentry.io/42",
};

describe("S-004: Content-Security-Policy", () => {
  it("S-004: ferme ce qui n'a pas de raison d'être ouvert", () => {
    const policy = buildContentSecurityPolicy(production);
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
  });

  it("S-004: seul Turnstile est un hôte de script autorisé, sans eval en production", () => {
    const scripts = directive(buildContentSecurityPolicy(production), "script-src");
    expect(scripts).toContain("https://challenges.cloudflare.com");
    expect(scripts).toContain("'wasm-unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.filter((source) => source.startsWith("https://"))).toEqual([
      "https://challenges.cloudflare.com",
    ]);
  });

  it("S-004: le développement ajoute eval et le rechargement à chaud, rien de plus", () => {
    const policy = buildContentSecurityPolicy({ ...production, NODE_ENV: "development" });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toContain("ws:");
  });

  it("S-004: les connexions vont au stockage, à Supabase, à Sentry et à la mesure d'audience", () => {
    const connect = directive(buildContentSecurityPolicy(production), "connect-src");
    expect(connect).toEqual([
      "'self'",
      "https://*.r2.cloudflarestorage.com",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
      "https://o1.ingest.de.sentry.io",
      "https://eu.i.posthog.com",
    ]);
  });

  it("S-004: une adresse de mesure ou de stockage propre au déploiement remplace la valeur par défaut", () => {
    const policy = buildContentSecurityPolicy({
      ...production,
      POSTHOG_HOST: "https://stats.example.org/path",
      R2_ENDPOINT: "http://127.0.0.1:9101",
    });
    const connect = directive(policy, "connect-src");
    expect(connect).toContain("https://stats.example.org");
    expect(connect).not.toContain("https://eu.i.posthog.com");
    expect(connect).toContain("http://127.0.0.1:9101");
    expect(directive(policy, "img-src")).toContain("http://127.0.0.1:9101");
    expect(directive(policy, "media-src")).toContain("http://127.0.0.1:9101");
  });

  it("S-004: une adresse mal formée est ignorée sans casser la politique", () => {
    const policy = buildContentSecurityPolicy({
      NODE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: "pas une adresse",
      R2_ENDPOINT: "",
    });
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://*.r2.cloudflarestorage.com",
      "https://eu.i.posthog.com",
    ]);
  });

  it("S-004: les formulaires ne partent que vers le site et le paiement Stripe", () => {
    expect(directive(buildContentSecurityPolicy(production), "form-action")).toEqual([
      "'self'",
      "https://checkout.stripe.com",
    ]);
  });
});
