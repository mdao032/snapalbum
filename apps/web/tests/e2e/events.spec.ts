import type { Page } from "@playwright/test";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  signIn,
  test,
} from "./fixtures";

async function createEvent(page: Page, title: string) {
  await page.goto("/events/new");
  await page.getByLabel("Nom de l’événement").fill(title);
  await page.getByRole("button", { name: "Créer mon événement" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
}

test.describe("mes événements", () => {
  test("F-010: un nouvel organisateur voit un état vide et peut créer son premier événement", async ({
    page,
  }) => {
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Votre premier événement vous attend" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole("link", { name: "Créer un événement" }).click();
    await expect(page).toHaveURL(/\/events\/new$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Créer un événement");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("F-010: crée un événement en une page, puis le retrouve dans la liste", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Mariage de Léa et Tom");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mariage de Léa et Tom");
    await expect(page.getByText("Mariage ·")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole("link", { name: "Mes événements" }).first().click();
    await expect(page).toHaveURL(/\/events$/);
    const card = page.getByRole("listitem").filter({ hasText: "Mariage de Léa et Tom" });
    await expect(card).toContainText("Aucune photo");
    await expect(card).toContainText("En cours");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await card.getByRole("link", { name: "Mariage de Léa et Tom" }).click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  });

  test("F-010: signale un nom vide sans quitter la page", async ({ page }) => {
    await signIn(page);
    await page.goto("/events/new");
    await page.getByRole("button", { name: "Créer mon événement" }).click();
    await expect(page).toHaveURL(/\/events\/new$/);
    await expect(page.getByText("Ce champ est obligatoire.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Vérifiez" })).toBeVisible();
    await expect(page.getByLabel("Nom de l’événement")).toHaveAttribute("aria-invalid", "true");
    await expectNoAccessibilityViolations(page);
  });

  test("F-012: un second événement gratuit est refusé avec une explication", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Premier événement");

    await page.goto("/events/new");
    await page.getByLabel("Nom de l’événement").fill("Deuxième événement");
    await page.getByRole("button", { name: "Créer mon événement" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "gratuit" })).toBeVisible();
    await expect(page).toHaveURL(/\/events\/new$/);
  });

  test("F-010: la création suit la langue de l'interface en anglais", async ({ page }) => {
    await signIn(page, "/en/login");
    await page.goto("/en/events/new");
    await expect(page.getByLabel("Guest page language")).toHaveValue("en");
    await page.getByLabel("Event name").fill("Léa and Tom’s wedding");
    await page.getByRole("button", { name: "Create my event" }).click();
    await expect(page).toHaveURL(/\/en\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Léa and Tom’s wedding");
  });

  test("S-001: l'événement d'un autre organisateur est introuvable", async ({ page, browser }) => {
    await signIn(page);
    await createEvent(page, "Événement privé");
    const url = page.url();

    const other = await newVisitor(browser);
    await signIn(other);
    const response = await other.goto(url);
    expect(response?.status()).toBe(404);
    await expect(other.getByText("Événement privé")).toHaveCount(0);
    await other.goto("/events");
    await expect(other.getByText("Événement privé")).toHaveCount(0);
    await other.context().close();
  });

  test("F-001: la liste et la création demandent d'être connecté", async ({ page }) => {
    await page.goto("/events/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fevents%2Fnew$/);
  });
});

test.describe("personnalisation", () => {
  test("F-011: enregistre le message d'accueil et la couleur, et assombrit une couleur trop claire", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page, "Anniversaire de Tom");

    await page.getByLabel("Message d’accueil").fill("Bienvenue à la fête !");
    await expect(page.getByText("21 / 500")).toBeVisible();

    await page.getByRole("button", { name: "Couleur #1d4ed8" }).click();
    await expect(page.getByRole("button", { name: "Couleur #1d4ed8" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A pale yellow cannot carry white text: the page says it will be darkened.
    await page.locator('input[type="color"]').fill("#ffd400");
    await expect(page.getByRole("status").filter({ hasText: "assombrie" })).toBeVisible();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Modifications enregistrées" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Message d’accueil")).toHaveValue("Bienvenue à la fête !");
    // The browser restores the scroll position: axe flags anything the sticky header covers.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoAccessibilityViolations(page);
  });

  test("F-011: on peut revenir à la couleur par défaut", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Soirée d’entreprise");
    await page.getByRole("button", { name: "Couleur #be185d" }).click();
    await page.getByRole("button", { name: "Couleur par défaut" }).click();
    await expect(page.getByRole("button", { name: "Couleur par défaut" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Modifications enregistrées" }),
    ).toBeVisible();
  });

  test("F-011: refuse un message de plus de 500 caractères avec une explication", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page, "Fête");
    await page.getByLabel("Message d’accueil").fill("a".repeat(501));
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByText("Ce texte est trop long (500 caractères au maximum)."),
    ).toBeVisible();
  });

  test("NF-031: les choix de couleur et les boutons ont une zone tactile d'au moins 44 px", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page, "Fête");
    for (const locator of [
      page.getByRole("button", { name: "Couleur par défaut" }),
      page.getByRole("button", { name: "Couleur #be185d" }),
      page.getByRole("button", { name: "Enregistrer" }),
    ]) {
      const box = await locator.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });
});
