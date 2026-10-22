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
    const cta = page.getByRole("main").getByRole("link", { name: "Créer mon album" }).first();
    const box = await cta.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  });

  test("section 12: le sélecteur de langue change la langue sans quitter la page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("finally together");
    await page.getByRole("button", { name: "Français" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("enfin réunies");
  });

  test("NF-031: les boutons de langue ont une zone tactile d'au moins 44 px", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Français", "English"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("NF-031: expose les repères de la page et un lien d'évitement au clavier", async ({
    page,
    isMobile,
    browserName,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    test.skip(isMobile || browserName === "webkit", "Tab ne cible pas les liens dans WebKit");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  });

  test("affiche une page 404 traduite pour une adresse inconnue", async ({ page }) => {
    const response = await page.goto("/cette-page-n-existe-pas");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("introuvable");
    await expect(page.getByRole("link", { name: /Retour à l.accueil/ })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
