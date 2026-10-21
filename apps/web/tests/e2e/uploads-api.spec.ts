import { expect, test } from "./fixtures";

test.describe("API d'envoi", () => {
  for (const path of ["reserve", "complete", "multipart"]) {
    test(`S-001: POST /api/uploads/${path} refuse un appel sans session (401, JSON)`, async ({
      page,
    }) => {
      const response = await page.request.post(`/api/uploads/${path}`, { data: {} });
      expect(response.status()).toBe(401);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
    });
  }

  test("S-001: un jeton Bearer falsifié est refusé comme une absence de session", async ({
    page,
  }) => {
    const response = await page.request.post("/api/uploads/reserve", {
      data: {},
      headers: { Authorization: "Bearer forged.token.value" },
    });
    expect(response.status()).toBe(401);
  });
});
