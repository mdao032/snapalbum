// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUser = vi.fn();
vi.mock("@/server/request-user", () => ({ getRequestUser }));

const checkRateLimit = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  GUEST_JOIN_RATE_LIMIT: { name: "guest-join", limit: 20, windowSeconds: 3600 },
  ACCESS_CODE_RATE_LIMIT: { name: "access-code", limit: 5, windowSeconds: 600 },
}));

const joinEvent = vi.fn();
vi.mock("@/server/guests", () => ({ joinEvent }));

const verifyTurnstileToken = vi.fn();
vi.mock("@/server/turnstile", () => ({ verifyTurnstileToken }));

const signInAnonymously = vi.fn();
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInAnonymously } }),
}));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));

const { POST } = await import("@/app/api/guests/join/route");

const body = { eventCode: "k7m2x9qvbr", acceptTerms: true, displayName: "  Élodie " };
const post = (payload: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.example.test/api/guests/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  vi.clearAllMocks();
  getRequestUser.mockResolvedValue(null);
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 3600 });
  joinEvent.mockResolvedValue({
    ok: true,
    body: { guestId: "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11", displayName: "Élodie", session: null },
  });
});

describe("F-035: POST /api/guests/join", () => {
  it("transmet la demande validée, avec l'adresse du visiteur et son éventuelle session", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1", isAnonymous: true });
    const response = await post(body, { "x-forwarded-for": "203.0.113.7" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Élodie" });
    expect(joinEvent).toHaveBeenCalledWith(
      expect.objectContaining({ admin: { admin: true } }),
      { userId: "user-1", ip: "203.0.113.7" },
      expect.objectContaining({ eventCode: "k7m2x9qvbr", displayName: "Élodie" }),
    );
  });

  it("F-034: refuse sans acceptation des conditions, sans appeler la logique (400)", async () => {
    const response = await post({ ...body, acceptTerms: false });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("validation_failed");
    expect(joinEvent).not.toHaveBeenCalled();
  });

  it.each(["pas du json", "null", JSON.stringify({ eventCode: "../x", acceptTerms: true })])(
    "NF-043: refuse un corps invalide : %s",
    async (payload) => {
      expect((await post(payload)).status).toBe(400);
    },
  );

  it("S-003: limite à 20 adhésions par heure et par adresse (429)", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 99 });
    const response = await post(body, { "x-forwarded-for": "203.0.113.7" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("99");
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "guest-join" }),
      "203.0.113.7",
    );
    expect(joinEvent).not.toHaveBeenCalled();
  });

  it("renvoie les refus de la logique avec leur code (code d'accès, anti-robots)", async () => {
    joinEvent.mockResolvedValue({ ok: false, status: 403, code: "access_code_invalid" });
    const response = await post(body);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("access_code_invalid");
  });

  it("S-006: les tentatives de code passent par la limite dédiée (par adresse et événement)", async () => {
    await post(body);
    const deps = joinEvent.mock.calls[0]?.[0] as {
      allowCodeAttempt: (key: string) => Promise<boolean>;
    };
    checkRateLimit.mockClear();
    await deps.allowCodeAttempt("203.0.113.7:event-1");
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "access-code" }),
      "203.0.113.7:event-1",
    );
  });

  it("S-012: la vérification anti-robots utilise Turnstile avec l'adresse du visiteur", async () => {
    verifyTurnstileToken.mockResolvedValue(true);
    await post(body, { "x-forwarded-for": "203.0.113.7" });
    const deps = joinEvent.mock.calls[0]?.[0] as {
      verifyHuman: (token?: string) => Promise<boolean>;
    };
    expect(await deps.verifyHuman("tok")).toBe(true);
    expect(verifyTurnstileToken).toHaveBeenCalledWith("tok", "203.0.113.7");
  });

  it("F-035: la session anonyme est ouverte côté serveur et ses jetons rendus aux applis", async () => {
    signInAnonymously.mockResolvedValue({
      data: {
        user: { id: "new-user" },
        session: { access_token: "a", refresh_token: "r", expires_at: 1_800_000_000 },
      },
      error: null,
    });
    await post(body);
    const deps = joinEvent.mock.calls[0]?.[0] as {
      signInAnonymously: () => Promise<unknown>;
    };
    expect(await deps.signInAnonymously()).toEqual({
      userId: "new-user",
      session: { accessToken: "a", refreshToken: "r", expiresAt: 1_800_000_000 },
    });
    signInAnonymously.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "disabled" },
    });
    expect(await deps.signInAnonymously()).toBeNull();
  });

  it("une panne imprévue donne une erreur générique", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    joinEvent.mockRejectedValue(new Error("db password leaked"));
    const response = await post(body);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("leaked");
  });
});
