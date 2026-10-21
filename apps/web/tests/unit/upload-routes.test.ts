// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUser = vi.fn();
vi.mock("@/server/request-user", () => ({ getRequestUser }));

const checkRateLimit = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  GUEST_RESERVE_RATE_LIMIT: { name: "guest", limit: 60, windowSeconds: 60 },
  EVENT_RESERVE_RATE_LIMIT: { name: "event", limit: 1000, windowSeconds: 60 },
}));

const reserveUpload = vi.fn();
const completeUpload = vi.fn();
const multipartAction = vi.fn();
vi.mock("@/server/uploads", () => ({ reserveUpload, completeUpload, multipartAction }));

vi.mock("@/server/storage", () => ({ getStorage: () => ({ storage: true }) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));

const { POST: reserve } = await import("@/app/api/uploads/reserve/route");
const { POST: complete } = await import("@/app/api/uploads/complete/route");
const { POST: multipart } = await import("@/app/api/uploads/multipart/route");

const MEDIA = "a1b2c3d4-0000-4000-8000-123456789abc";
const reserveBody = {
  eventCode: "k7m2x9qvbr",
  kind: "photo",
  sha256: "a".repeat(64),
  mimeType: "image/jpeg",
  extension: "jpg",
  bytes: 3_000_000,
  displayBytes: 400_000,
  thumbBytes: 20_000,
};

const post = (body: unknown) =>
  new Request("https://app.example.test/api/uploads/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  vi.clearAllMocks();
  getRequestUser.mockResolvedValue({ id: "user-1", isAnonymous: true });
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 60 });
  reserveUpload.mockResolvedValue({
    ok: true,
    body: { status: "already_received", mediaId: MEDIA },
  });
  completeUpload.mockResolvedValue({ ok: true, body: { mediaId: MEDIA, status: "ready" } });
  multipartAction.mockResolvedValue({ ok: true, body: { action: "abort" } });
});

describe("S-001: les routes d'envoi demandent une session", () => {
  it.each([
    ["reserve", reserve, reserveBody],
    ["complete", complete, { mediaId: MEDIA }],
    ["multipart", multipart, { action: "abort", mediaId: MEDIA }],
  ] as const)(
    "S-001: %s refuse sans session (401) et n'appelle rien",
    async (_name, route, body) => {
      getRequestUser.mockResolvedValue(null);
      const response = await route(post(body));
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("unauthorized");
      expect(reserveUpload).not.toHaveBeenCalled();
      expect(completeUpload).not.toHaveBeenCalled();
      expect(multipartAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["reserve", reserve],
    ["complete", complete],
    ["multipart", multipart],
  ] as const)(
    "NF-043: %s refuse un corps qui n'est pas du JSON valide (400)",
    async (_name, route) => {
      for (const body of ["pas du json", "null", "[]", JSON.stringify({ mediaId: "../x" })]) {
        const response = await route(post(body));
        expect(response.status).toBe(400);
        expect(await errorCode(response)).toBe("validation_failed");
      }
    },
  );
});

describe("SPEC 8.1: POST /api/uploads/reserve", () => {
  it("transmet la demande validée avec l'identité vérifiée de l'invité", async () => {
    const response = await reserve(post(reserveBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_received", mediaId: MEDIA });
    expect(reserveUpload).toHaveBeenCalledWith(
      { admin: { admin: true }, storage: { storage: true } },
      { id: "user-1", isAnonymous: true },
      expect.objectContaining({ eventCode: "k7m2x9qvbr", previewFormat: "webp" }),
    );
  });

  it("S-003: limite à 60 réservations par minute et par invité, 1 000 par événement", async () => {
    await reserve(post(reserveBody));
    expect(checkRateLimit.mock.calls.map((call) => [call[0].name, call[1]])).toEqual([
      ["guest", "user-1"],
      ["event", "k7m2x9qvbr"],
    ]);
  });

  it("S-003: répond 429 avec le délai d'attente quand l'une des limites est atteinte", async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const response = await reserve(post(reserveBody));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await errorCode(response)).toBe("rate_limited");
    expect(reserveUpload).not.toHaveBeenCalled();

    checkRateLimit.mockResolvedValueOnce({ allowed: true, remaining: 1, retryAfterSeconds: 60 });
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 7 });
    expect((await reserve(post(reserveBody))).status).toBe(429);
  });

  it("R1: renvoie le refus de la logique d'envoi avec son code HTTP et son code d'erreur", async () => {
    reserveUpload.mockResolvedValue({ ok: false, status: 409, code: "album_full" });
    const response = await reserve(post(reserveBody));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("album_full");
  });

  it("une panne imprévue donne une erreur générique sans détail technique", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reserveUpload.mockRejectedValue(new Error("password=hunter2 at db.internal:5432"));
    const response = await reserve(post(reserveBody));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("internal_error");
    expect(text).not.toContain("hunter2");
  });

  it("les réponses ne sont jamais mises en cache", async () => {
    expect((await reserve(post(reserveBody))).headers.get("cache-control")).toBe("no-store");
  });
});

describe("SPEC 8.1: POST /api/uploads/complete et /multipart", () => {
  it("confirme un envoi pour l'invité connecté", async () => {
    const response = await complete(post({ mediaId: MEDIA }));
    expect(await response.json()).toEqual({ mediaId: MEDIA, status: "ready" });
    expect(completeUpload).toHaveBeenCalledWith(
      expect.anything(),
      { id: "user-1", isAnonymous: true },
      MEDIA,
    );
  });

  it("renvoie l'échec de la confirmation (fichier invalide, pas terminé)", async () => {
    completeUpload.mockResolvedValue({ ok: false, status: 422, code: "invalid_file" });
    const response = await complete(post({ mediaId: MEDIA }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("invalid_file");
  });

  it("NF-013: transmet l'action d'envoi en morceaux", async () => {
    const response = await multipart(post({ action: "part", mediaId: MEDIA, partNumber: 2 }));
    expect(response.status).toBe(200);
    expect(multipartAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "user-1" }),
      { action: "part", mediaId: MEDIA, partNumber: 2 },
    );
  });

  it("NF-013: refuse une action inconnue sans appeler la logique", async () => {
    expect((await multipart(post({ action: "delete-everything", mediaId: MEDIA }))).status).toBe(
      400,
    );
    expect(multipartAction).not.toHaveBeenCalled();
  });
});
