import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyTurnstileToken = vi.fn();
const checkRateLimit = vi.fn();
vi.mock("@/server/turnstile", () => ({ verifyTurnstileToken }));
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  LOGIN_RATE_LIMIT: { name: "login", limit: 5, windowSeconds: 900 },
}));

const redirect = vi.fn((_target: unknown): never => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("@/i18n/navigation", () => ({ redirect }));

const serverClient = { auth: { getUser: vi.fn() } };
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => serverClient,
}));

const {
  buildConfirmUrl,
  getOrganiser,
  getProfile,
  requestMagicLink,
  requireOrganiser,
  startGoogleSignIn,
  updateProfile,
} = await import("@/server/auth");

const SITE = "https://app.example.test";
const context = { ip: "203.0.113.7", siteUrl: SITE };

function fakeClient(overrides: Record<string, unknown> = {}) {
  return { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: null }), ...overrides } };
}
const asClient = (client: object) => client as unknown as SupabaseClient<never>;

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 900 });
  verifyTurnstileToken.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F-001: lien de retour de connexion", () => {
  it("F-001: encode la page demandée et la langue", () => {
    const url = new URL(buildConfirmUrl(SITE, "en", "/en/account?tab=1"));
    expect(url.origin + url.pathname).toBe("https://app.example.test/auth/confirm");
    expect(url.searchParams.get("next")).toBe("/en/account?tab=1");
    expect(url.searchParams.get("locale")).toBe("en");
  });

  it("F-001: n'accepte jamais une redirection vers un autre site", () => {
    const url = new URL(buildConfirmUrl(SITE, "fr", "https://evil.example"));
    expect(url.searchParams.get("next")).toBe("/events");
    const english = new URL(buildConfirmUrl(SITE, "en", "//evil.example"));
    expect(english.searchParams.get("next")).toBe("/en/events");
  });
});

describe("F-001: demande de lien magique", () => {
  const input = { email: " Lea@Example.com ", locale: "fr", next: "/account" };

  it("F-001: envoie le lien à l'adresse normalisée, avec la langue pour le modèle d'e-mail", async () => {
    const client = fakeClient();
    const result = await requestMagicLink(asClient(client), input, context);

    expect(result).toEqual({ ok: true, email: "lea@example.com" });
    const options = client.auth.signInWithOtp.mock.calls[0]?.[0];
    expect(options.email).toBe("lea@example.com");
    expect(options.options.data).toEqual({ locale: "fr" });
    expect(options.options.emailRedirectTo).toContain("/auth/confirm?next=%2Faccount&locale=fr");
  });

  it("F-001: refuse une adresse invalide avant toute autre vérification", async () => {
    const client = fakeClient();
    const result = await requestMagicLink(
      asClient(client),
      { ...input, email: "pas-un-mail" },
      context,
    );
    expect(result).toEqual({ ok: false, error: "invalid_email" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("S-003: refuse quand la limite de débit est atteinte, sans envoyer d'e-mail", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 600 });
    const client = fakeClient();
    const result = await requestMagicLink(asClient(client), input, context);
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "login" }),
      "203.0.113.7",
    );
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("S-003: compte les tentatives sans adresse IP sous une même clé", async () => {
    await requestMagicLink(asClient(fakeClient()), input, { ...context, ip: undefined });
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "unknown");
  });

  it("S-012: refuse quand la vérification anti-robots échoue, sans envoyer d'e-mail", async () => {
    verifyTurnstileToken.mockResolvedValue(false);
    const client = fakeClient();
    const result = await requestMagicLink(
      asClient(client),
      { ...input, turnstileToken: "bad" },
      context,
    );
    expect(result).toEqual({ ok: false, error: "captcha_failed" });
    expect(verifyTurnstileToken).toHaveBeenCalledWith("bad", "203.0.113.7");
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("S-003: traduit la limite d'envoi de Supabase en erreur de débit", async () => {
    const client = fakeClient({
      signInWithOtp: vi
        .fn()
        .mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } }),
    });
    expect(await requestMagicLink(asClient(client), input, context)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("F-001: signale un échec d'envoi sans détail technique", async () => {
    const client = fakeClient({
      signInWithOtp: vi.fn().mockResolvedValue({ error: { status: 500, message: "smtp down" } }),
    });
    expect(await requestMagicLink(asClient(client), input, context)).toEqual({
      ok: false,
      error: "send_failed",
    });
  });
});

describe("F-002: connexion avec Google", () => {
  it("F-002: renvoie l'adresse de l'écran de consentement Google", async () => {
    const signInWithOAuth = vi
      .fn()
      .mockResolvedValue({ data: { url: "https://accounts.google.test/x" }, error: null });
    const result = await startGoogleSignIn(asClient({ auth: { signInWithOAuth } }), {
      locale: "fr",
      next: undefined,
      siteUrl: SITE,
    });
    expect(result).toEqual({ ok: true, url: "https://accounts.google.test/x" });
    const options = signInWithOAuth.mock.calls[0]?.[0];
    expect(options.provider).toBe("google");
    expect(options.options.skipBrowserRedirect).toBe(true);
    expect(options.options.redirectTo).toContain("/auth/confirm");
  });

  it("F-002: échoue proprement quand le fournisseur n'est pas activé", async () => {
    const signInWithOAuth = vi
      .fn()
      .mockResolvedValue({ data: { url: null }, error: { message: "provider is not enabled" } });
    const result = await startGoogleSignIn(asClient({ auth: { signInWithOAuth } }), {
      locale: "en",
      next: "/en/account",
      siteUrl: SITE,
    });
    expect(result).toEqual({ ok: false });
  });
});

describe("F-001: organisateur connecté", () => {
  const getUserResult = (value: unknown) =>
    asClient({ auth: { getUser: vi.fn().mockResolvedValue(value) } });

  it("F-001: renvoie l'utilisateur d'une vraie session", async () => {
    const user = { id: "u1", is_anonymous: false };
    expect(await getOrganiser(getUserResult({ data: { user }, error: null }))).toEqual(user);
  });

  it("F-035: une session d'invité anonyme n'est jamais un organisateur", async () => {
    const user = { id: "g1", is_anonymous: true };
    expect(await getOrganiser(getUserResult({ data: { user }, error: null }))).toBeNull();
  });

  it("F-001: renvoie null sans session ou avec un jeton refusé", async () => {
    expect(await getOrganiser(getUserResult({ data: { user: null }, error: null }))).toBeNull();
    expect(
      await getOrganiser(
        getUserResult({ data: { user: null }, error: { message: "jwt expired" } }),
      ),
    ).toBeNull();
  });

  it("F-001: renvoie l'organisateur et son client aux pages protégées", async () => {
    const user = { id: "u1", is_anonymous: false };
    serverClient.auth.getUser.mockResolvedValue({ data: { user }, error: null });
    const result = await requireOrganiser("fr");
    expect(result.user).toBe(user);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("F-001: renvoie un visiteur sans session vers la connexion dans sa langue", async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireOrganiser("en")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith({ href: "/login", locale: "en" });
  });
});

describe("F-003: profil", () => {
  function profilesClient(result: unknown) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    // `update(...).eq(...).select(...)` is awaited directly.
    chain.then = (resolve: (value: unknown) => void) => resolve(result);
    return { from: vi.fn(() => chain), chain };
  }

  it("F-003: lit le profil de l'organisateur", async () => {
    const row = { user_id: "u1", display_name: "Léa", locale: "fr" };
    const { from } = profilesClient({ data: row, error: null });
    expect(await getProfile(asClient({ from }), "u1")).toEqual(row);
  });

  it("F-003: enregistre le nom et la langue", async () => {
    const { from, chain } = profilesClient({ data: [{ user_id: "u1" }], error: null });
    const result = await updateProfile(asClient({ from }), "u1", {
      displayName: " Léa ",
      locale: "en",
    });
    expect(result).toEqual({ ok: true, locale: "en" });
    expect(chain.update).toHaveBeenCalledWith({ display_name: "Léa", locale: "en" });
  });

  it("F-003: refuse des valeurs invalides sans toucher à la base", async () => {
    const { from } = profilesClient({ data: [], error: null });
    const result = await updateProfile(asClient({ from }), "u1", {
      displayName: "x",
      locale: "de",
    });
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(from).not.toHaveBeenCalled();
  });

  it("F-003: signale un refus de la base (aucune ligne modifiée par la RLS)", async () => {
    const { from } = profilesClient({ data: [], error: null });
    expect(
      await updateProfile(asClient({ from }), "u1", { displayName: "", locale: "fr" }),
    ).toEqual({
      ok: false,
      error: "failed",
    });
  });
});
