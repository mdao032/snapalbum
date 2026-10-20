import { expect, test } from "@playwright/test";
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from "./fixtures";

test.describe("page d'accueil", () => {
  test("NF-032: s'affiche en français par défaut", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("enfin réunies");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test.describe("avec un navigateur en anglais", () => {
    test.use({ locale: "en-GB" });

    test("section 12: détecte la langue du navigateur et redirige vers /en", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/en$/);
    });
  });

  test("section 12: s'affiche en anglais sous /en", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("finally together");
    await expectNoAccessibilityViolations(page);
  });

  test("NF-031: le bouton principal a une zone tactile d'au moins 44 px", async ({ page }) => {
    await page.goto("/");
    const box = await page.getByRole("button", { name: "Créer mon album" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  });

  test("affiche une page 404 traduite pour une adresse inconnue", async ({ page }) => {
    const response = await page.goto("/cette-page-n-existe-pas");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("introuvable");
  });
});
