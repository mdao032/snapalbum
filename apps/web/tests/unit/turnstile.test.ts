import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("@/server/turnstile");
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("S-012: vérification anti-robots Turnstile", () => {
  it("S-012: ne bloque rien tant que Turnstile n'est pas configuré (développement local)", async () => {
    const { verifyTurnstileToken } = await load();
    const fetcher = vi.fn();
    expect(await verifyTurnstileToken(undefined, undefined, fetcher)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe("une fois configuré", () => {
    beforeEach(() => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    });

    it("S-012: refuse l'absence de jeton sans appeler Cloudflare", async () => {
      const { verifyTurnstileToken } = await load();
      const fetcher = vi.fn();
      expect(await verifyTurnstileToken(undefined, "203.0.113.7", fetcher)).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("S-012: envoie le secret, le jeton et l'adresse IP, et accepte un succès", async () => {
      const { verifyTurnstileToken } = await load();
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
      expect(await verifyTurnstileToken("token-1", "203.0.113.7", fetcher)).toBe(true);

      const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = init.body as URLSearchParams;
      expect(body.get("secret")).toBe("secret");
      expect(body.get("response")).toBe("token-1");
      expect(body.get("remoteip")).toBe("203.0.113.7");
    });

    it("S-012: refuse un jeton rejeté par Cloudflare", async () => {
      const { verifyTurnstileToken } = await load();
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false })));
      expect(await verifyTurnstileToken("bad", undefined, fetcher)).toBe(false);
    });

    it("S-012: refuse quand Cloudflare répond en erreur ou est injoignable", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { verifyTurnstileToken } = await load();
      const failing = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
      expect(await verifyTurnstileToken("t", undefined, failing)).toBe(false);
      const unreachable = vi.fn().mockRejectedValue(new Error("offline"));
      expect(await verifyTurnstileToken("t", undefined, unreachable)).toBe(false);
    });
  });
});
