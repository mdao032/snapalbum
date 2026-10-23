// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUser = vi.fn();
vi.mock("@/server/request-user", () => ({ getRequestUser }));

const checkRateLimit = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  FEEDBACK_RATE_LIMIT: { name: "feedback", limit: 5, windowSeconds: 3600 },
}));

const submitFeedback = vi.fn();
vi.mock("@/server/feedback", () => ({ submitFeedback }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));

const { POST } = await import("@/app/api/feedback/route");

const valid = { audience: "guest", eventCode: "abcdefghjk", rating: 5, locale: "fr" };
const post = (body: unknown) =>
  POST(
    new Request("https://app.example.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  getRequestUser.mockResolvedValue({ id: "u1", isAnonymous: true });
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 60 });
  submitFeedback.mockResolvedValue({ ok: true });
});

describe("6.2: POST /api/feedback", () => {
  it("6.2: sans session, 401 et rien n'est enregistré", async () => {
    getRequestUser.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(401);
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("6.2: une requête mal formée est refusée avant tout (note hors limites, public inconnu)", async () => {
    for (const bad of [{ ...valid, rating: 9 }, { ...valid, audience: "x" }, {}]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("6.2: au-delà de la limite, 429 avec le délai", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120 });
    const response = await post(valid);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(checkRateLimit).toHaveBeenCalledWith(
      { name: "feedback", limit: 5, windowSeconds: 3600 },
      "u1",
    );
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("6.2: un auteur qui n'est pas de l'événement reçoit « introuvable »", async () => {
    submitFeedback.mockResolvedValue({ ok: false, status: 404, code: "not_found" });
    const response = await post(valid);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });

  it("6.2: un avis valide est enregistré pour la personne connectée", async () => {
    const response = await post({ ...valid, message: " Merci " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(submitFeedback).toHaveBeenCalledWith(
      { admin: true },
      { id: "u1", isAnonymous: true },
      expect.objectContaining({ audience: "guest", rating: 5, message: "Merci", locale: "fr" }),
    );
  });
});
