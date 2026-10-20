import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index";

const MEDIA_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const request = {
  eventCode: "k7m2x9qvbr",
  kind: "photo" as const,
  sha256: "a".repeat(64),
  mimeType: "image/jpeg",
  bytes: 1234,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("client d'API partagé", () => {
  it("envoie le jeton Bearer des applis mobiles et valide la réponse", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "already_received", mediaId: MEDIA_ID }));
    const client = createApiClient({
      baseUrl: "https://example.test",
      getAccessToken: () => "token-123",
      fetch: fetchMock,
    });

    const result = await client.reserveUpload(request);

    expect(result).toEqual({ status: "already_received", mediaId: MEDIA_ID });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/api/uploads/reserve");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("transforme une erreur de l'API en ApiError avec son code stable", async () => {
    const client = createApiClient({
      baseUrl: "",
      fetch: vi.fn().mockResolvedValue(jsonResponse({ error: { code: "album_full" } }, 409)),
    });
    await expect(client.reserveUpload(request)).rejects.toMatchObject({
      status: 409,
      code: "album_full",
    });
  });

  it("NF-011: signale une coupure réseau par network_error", async () => {
    const client = createApiClient({
      baseUrl: "",
      fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const error = await client.completeUpload({ mediaId: MEDIA_ID }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "network_error" });
  });

  it("refuse une réponse qui ne respecte pas le schéma", async () => {
    const client = createApiClient({
      baseUrl: "",
      fetch: vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })),
    });
    await expect(client.completeUpload({ mediaId: MEDIA_ID })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
