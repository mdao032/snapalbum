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

/** The save button of the personalisation form (the page has one per form). */
function savePersonalization(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByLabel("Message d’accueil") })
    .getByRole("button", { name: "Enregistrer" });
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

    await savePersonalization(page).click();
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
    await savePersonalization(page).click();
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
    await savePersonalization(page).click();
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
      savePersonalization(page),
    ]) {
      const box = await locator.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("partage de l'événement", () => {
  async function shortCode(page: Page): Promise<string> {
    const link = await page.getByLabel("Lien de l’événement").inputValue();
    return link.split("/").pop() ?? "";
  }

  test("F-013: affiche le QR code et le lien court construit sur la base configurée", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page, "Mariage de Léa et Tom");

    const qr = page.getByRole("img", { name: /QR code de l’événement Mariage de Léa et Tom/ });
    await expect(qr).toBeVisible();
    await expect
      .poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    const link = await page.getByLabel("Lien de l’événement").inputValue();
    expect(link).toMatch(/^https?:\/\/[^/]+\/[23456789abcdefghjkmnpqrstuvwxyz]{10,}$/);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("F-013: le QR code peut prendre les couleurs de l'événement", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Fête");
    const qr = page.getByRole("img", { name: /QR code/ });
    await expect(qr).toHaveAttribute("src", /format=svg$/);
    await page.getByLabel("QR code aux couleurs de l’événement").check();
    await expect(qr).toHaveAttribute("src", /color=accent/);
  });

  test("F-013: copie le lien", async ({ page, browserName, context }) => {
    test.skip(browserName !== "chromium", "Le presse-papiers n'est testable que dans Chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);
    await createEvent(page, "Fête");
    await page.getByRole("button", { name: "Copier le lien" }).click();
    await expect(page.getByRole("button", { name: "Lien copié" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await page.getByLabel("Lien de l’événement").inputValue());
  });

  test("F-013, F-014: les fichiers se téléchargent pour l'organisateur et seulement pour lui", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await createEvent(page, "Mariage de Léa et Tom");
    const id = page.url().split("/").pop();

    const png = await page.request.get(`/api/events/${id}/qr?format=png&download=1`);
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect(png.headers()["content-disposition"]).toContain("attachment");
    expect((await png.body()).subarray(1, 4).toString()).toBe("PNG");

    const svg = await page.request.get(`/api/events/${id}/qr?format=svg`);
    expect(svg.headers()["content-type"]).toContain("image/svg+xml");

    for (const format of ["a6", "a5", "tent"]) {
      const pdf = await page.request.get(`/api/events/${id}/card?format=${format}`);
      expect(pdf.status(), format).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }

    const stranger = await newVisitor(browser);
    expect((await stranger.request.get(`/api/events/${id}/qr`)).status()).toBe(401);
    await signIn(stranger);
    expect((await stranger.request.get(`/api/events/${id}/qr`)).status()).toBe(404);
    expect((await stranger.request.get(`/api/events/${id}/card?format=a6`)).status()).toBe(404);
    await stranger.context().close();
  });

  test("F-014: les liens de téléchargement des cartes existent", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Fête");
    for (const name of [
      "QR code (SVG)",
      "QR code (PNG, 1 024 px)",
      "Carte A6 (PDF)",
      "Carte A5 (PDF)",
      "Chevalet de table (PDF, A4 à plier)",
    ]) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", /\/api\/events\//);
    }
  });

  test("F-012: scanner le lien court mène à la page de l'événement, dans sa langue", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await createEvent(page, "Mariage de Léa et Tom");
    const code = await shortCode(page);

    const guest = await newVisitor(browser);
    await guest.goto(`/${code}`);
    await expect(guest).toHaveURL(new RegExp(`/e/${code}$`));
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Mariage de Léa et Tom");
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);
    await guest.context().close();
  });

  test("F-012: un événement anglais mène à la page anglaise", async ({ page, browser }) => {
    await signIn(page, "/en/login");
    await page.goto("/en/events/new");
    await page.getByLabel("Event name").fill("Léa and Tom’s wedding");
    await page.getByRole("button", { name: "Create my event" }).click();
    await expect(page).toHaveURL(/\/en\/events\/[0-9a-f-]{36}$/);
    const code = (await page.getByLabel("Event link").inputValue()).split("/").pop();

    const guest = await newVisitor(browser);
    await guest.goto(`/${code}`);
    await expect(guest).toHaveURL(new RegExp(`/en/e/${code}$`));
    await expect(guest.getByRole("heading", { level: 2 })).toHaveText("Photo uploads open soon");
    await guest.context().close();
  });

  test("F-012: un code inconnu donne une page introuvable", async ({ page }) => {
    const response = await page.goto("/k7m2x9qvbr");
    expect(response?.status()).toBe(404);
  });
});
