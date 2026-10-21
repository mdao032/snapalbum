// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18nResponse = vi.fn<() => NextResponse>();
vi.mock("next-intl/middleware", () => ({ default: () => i18nResponse }));

const getClaims = vi.fn();
const createServerClient = vi.fn((..._args: unknown[]) => ({ auth: { getClaims } }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const { default: proxy } = await import("@/proxy");

function request(path: string, cookie?: string) {
  return new NextRequest(`https://app.example.test${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const SESSION_COOKIE = "sb-127-auth-token=abc";

beforeEach(() => {
  vi.clearAllMocks();
  i18nResponse.mockImplementation(() => NextResponse.next());
  getClaims.mockResolvedValue({ data: null, error: null });
});

const signedIn = () =>
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1", is_anonymous: false } } });

describe("F-001: garde des pages protégées", () => {
  it("F-001: renvoie un visiteur sans session vers la connexion, avec la page demandée", async () => {
    const response = await proxy(request("/account?tab=1"));
    const target = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(307);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/account?tab=1");
  });

  it("F-001: garde la langue anglaise dans la redirection", async () => {
    const response = await proxy(request("/en/account"));
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/en/login");
    expect(target.searchParams.get("next")).toBe("/en/account");
  });

  it("F-035: une session d'invité anonyme ne donne pas accès aux pages d'organisateur", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "g1", is_anonymous: true } } });
    const response = await proxy(request("/account", SESSION_COOKIE));
    expect(response.status).toBe(307);
  });

  it("F-001: un jeton invalide ou expiré ne passe pas", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("invalid jwt") });
    const response = await proxy(request("/account", SESSION_COOKIE));
    expect(response.status).toBe(307);
  });

  it("F-001: laisse passer un organisateur connecté", async () => {
    signedIn();
    const response = await proxy(request("/account", SESSION_COOKIE));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("F-001: protège aussi la zone d'administration", async () => {
    const response = await proxy(request("/admin"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("F-001: la redirection de langue passe avant la vérification de session", async () => {
    i18nResponse.mockImplementation(() =>
      NextResponse.redirect("https://app.example.test/en/account"),
    );
    const response = await proxy(request("/account"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/en/account");
    expect(getClaims).not.toHaveBeenCalled();
  });
});

describe("F-001: pages publiques", () => {
  it("F-001: n'interroge pas Supabase pour un visiteur sans session sur une page publique", async () => {
    const response = await proxy(request("/"));
    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("F-001: rafraîchit la session d'un visiteur connecté sur une page publique", async () => {
    await proxy(request("/", SESSION_COOKIE));
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("F-001: transmet la session rafraîchie au navigateur", async () => {
    const response = await proxy(request("/", SESSION_COOKIE));
    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: {
        getAll: () => unknown;
        setAll: (c: { name: string; value: string; options?: object }[]) => void;
      };
    };
    options.cookies.setAll([{ name: "sb-127-auth-token", value: "fresh", options: { path: "/" } }]);
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("fresh");
  });
});
