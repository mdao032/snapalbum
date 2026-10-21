import { expect, signIn, test } from "./fixtures";

const COMMON = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

test.describe("en-têtes de sécurité", () => {
  test("S-004: les pages publiques et privées portent les en-têtes de base, sans caméra", async ({
    page,
  }) => {
    for (const path of [
      "/",
      "/login",
      "/en/login",
      "/account",
      "/api/events/3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11/qr",
    ]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      for (const [name, value] of Object.entries(COMMON))
        expect(headers[name], `${path} ${name}`).toBe(value);
      expect(headers["strict-transport-security"], path).toMatch(/max-age=\d+/);
      expect(headers["permissions-policy"], path).toContain("camera=()");
    }
  });

  test("S-004: seules les pages invité autorisent la caméra", async ({ page }) => {
    await signIn(page);
    await page.goto("/events/new");
    await page.getByLabel("Nom de l’événement").fill("Fête");
    await page.getByRole("button", { name: "Créer mon événement" }).click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const code = (await page.getByLabel("Lien de l’événement").inputValue()).split("/").pop();

    for (const path of [`/e/${code}`, `/en/e/${code}`]) {
      const headers = (await page.request.get(path)).headers();
      expect(headers["permissions-policy"], path).toContain("camera=(self)");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
    }
    // The organiser's own pages stay without camera.
    const own = (await page.request.get(page.url())).headers();
    expect(own["permissions-policy"]).toContain("camera=()");
  });
});
