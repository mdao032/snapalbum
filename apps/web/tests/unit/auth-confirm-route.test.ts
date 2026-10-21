// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
};
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));

const { GET } = await import("@/app/auth/confirm/route");

function call(query: string) {
  return GET(new NextRequest(`https://app.example.test/auth/confirm?${query}`));
}

function location(response: Response): URL {
  return new URL(response.headers.get("location") ?? "", "https://app.example.test");
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("F-001: retour du lien magique", () => {
  it("F-001: ouvre la session puis continue vers la page demandée", async () => {
    const response = await call("token_hash=abc&type=email&next=%2Faccount%3Ftab%3D1&locale=fr");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(location(response).pathname + location(response).search).toBe("/account?tab=1");
  });

  it("F-001: sans page demandée, va à Mes événements dans la langue de la demande", async () => {
    const response = await call("token_hash=abc&type=email&locale=en");
    expect(location(response).pathname).toBe("/en/events");
  });

  it("F-001: un lien expiré ou déjà utilisé ramène à la connexion avec un message", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const response = await call("token_hash=old&type=email&next=%2Faccount&locale=en");
    const target = location(response);
    expect(target.pathname).toBe("/en/login");
    expect(target.searchParams.get("error")).toBe("link_expired");
    expect(target.searchParams.get("next")).toBe("/account");
  });

  it("F-001: n'envoie jamais le visiteur vers un autre site", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const response = await call(
        `token_hash=abc&type=email&locale=fr&next=${encodeURIComponent(next)}`,
      );
      expect(location(response).origin).toBe("https://app.example.test");
      expect(location(response).pathname).toBe("/events");
    }
  });

  it("F-001: une adresse sans jeton ni code ramène à la connexion", async () => {
    const response = await call("locale=fr");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("link_expired");
  });

  it("F-001: ignore une langue inconnue et un type de jeton inattendu", async () => {
    const response = await call("token_hash=abc&type=recovery&locale=de");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/login");
  });
});

describe("F-002: retour de Google", () => {
  it("F-002: échange le code contre une session puis continue", async () => {
    const response = await call("code=xyz&next=%2Fen%2Faccount&locale=en");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(location(response).pathname).toBe("/en/account");
  });

  it("F-002: un échec ramène à la connexion avec le message dédié", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const response = await call("code=xyz&locale=fr");
    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("oauth_failed");
  });
});
