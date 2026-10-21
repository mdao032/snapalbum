import type { Page } from "@playwright/test";
import { setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  signIn,
  test,
} from "./fixtures";

async function createEvent(page: Page, title = "Mariage de Léa et Tom"): Promise<string> {
  await page.goto("/events/new");
  await page.getByLabel("Nom de l’événement").fill(title);
  await page.getByRole("button", { name: "Créer mon événement" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() ?? "";
}

/** The save button of the settings form (the page has one per form). */
function saveSettings(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByLabel("Début des envois") })
    .getByRole("button", { name: "Enregistrer" });
}

test.describe("tableau de bord", () => {
  test("F-018: affiche les compteurs et le quota d'un nouvel événement", async ({ page }) => {
    await signIn(page);
    await createEvent(page);

    const stats = page.getByRole("heading", { name: "En un coup d’œil" });
    await expect(stats).toBeVisible();
    const expected: Record<string, RegExp> = {
      Photos: /^0$/,
      Vidéos: /^0$/,
      Invités: /^0$/,
      "Espace utilisé": /^0\s+o$/,
    };
    for (const [label, value] of Object.entries(expected)) {
      await expect(
        page.getByText(label, { exact: true }).locator("xpath=following-sibling::dd"),
      ).toHaveText(value);
    }
    const bar = page.getByRole("progressbar", { name: "Place utilisée dans l’album" });
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByText("0 sur 200 fichiers")).toBeVisible();
    await expect(page.getByText("Encore 200 places")).toBeVisible();
    await expect(page.getByText("jusqu’à 10 vidéos")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("F-018: prévient quand l'album approche de sa limite puis quand il est plein", async ({
    page,
  }) => {
    await signIn(page);
    const id = await createEvent(page);

    await setEventColumns(id, { media_count: 170, bytes_used: 1_610_612_736 });
    await page.reload();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
    await expect(page.getByText("Encore 30 places")).toBeVisible();
    await expect(page.getByText("1,5 Go")).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "approche de sa limite" }),
    ).toBeVisible();

    await setEventColumns(id, { media_count: 200 });
    await page.reload();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByText("Plus aucune place")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "L’album est plein" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoAccessibilityViolations(page);
  });
});

test.describe("paramètres de l'album", () => {
  test("F-015, F-016: enregistre la visibilité, la validation et la période d'envoi", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page);

    const gallery = page.getByLabel("Les invités peuvent voir la galerie");
    const approval = page.getByLabel("Valider les photos avant leur affichage");
    await expect(gallery).toBeChecked();
    await expect(approval).not.toBeChecked();
    await expect(page.getByLabel("Début des envois")).toBeVisible();

    await gallery.uncheck();
    await approval.check();
    await page.getByLabel("Début des envois").fill("2026-12-01T09:00");
    await page.getByLabel("Fin des envois").fill("2026-12-20T18:30");
    await saveSettings(page).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Paramètres enregistrés" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Les invités peuvent voir la galerie")).not.toBeChecked();
    await expect(page.getByLabel("Valider les photos avant leur affichage")).toBeChecked();
    await expect(page.getByLabel("Début des envois")).toHaveValue("2026-12-01T09:00");
    await expect(page.getByLabel("Fin des envois")).toHaveValue("2026-12-20T18:30");
  });

  test("F-016: refuse une fin d'envoi avant le début, avec une explication", async ({ page }) => {
    await signIn(page);
    await createEvent(page);
    await page.getByLabel("Début des envois").fill("2026-12-20T09:00");
    await page.getByLabel("Fin des envois").fill("2026-12-01T09:00");
    await saveSettings(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "après leur début" })).toBeVisible();
  });
});

test.describe("suppression d'un événement", () => {
  test("R5: demande de confirmation, suppression différée, puis annulation", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await createEvent(page, "Fête à supprimer");
    const code = (await page.getByLabel("Lien de l’événement").inputValue()).split("/").pop();

    // First step only opens the confirmation; nothing is deleted yet.
    await page.getByRole("button", { name: "Supprimer l’événement" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Supprimer « Fête à supprimer » ?");
    await expect(dialog).toContainText("Tout sera supprimé définitivement le");
    await page.getByRole("button", { name: "Non, garder l’événement" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Suppression prévue/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Supprimer l’événement" }).click();
    await page.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByRole("heading", { name: /Suppression prévue le/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Partager l’album" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paramètres de l’album" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Annuler la suppression" })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    // Guests can no longer reach the event; the organiser's list says so.
    const guest = await newVisitor(browser);
    expect((await guest.goto(`/e/${code}`))?.status()).toBe(404);
    await guest.context().close();
    await page.goto("/events");
    await expect(page.getByRole("listitem").filter({ hasText: "Fête à supprimer" })).toContainText(
      "Suppression prévue",
    );

    // Changing one's mind is possible during the 7 days.
    await page.getByRole("link", { name: "Fête à supprimer" }).click();
    await page.getByRole("button", { name: "Annuler la suppression" }).click();
    await expect(page.getByRole("heading", { name: /Suppression prévue/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Partager l’album" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fête à supprimer");

    const guestAgain = await newVisitor(browser);
    expect((await guestAgain.goto(`/e/${code}`))?.status()).toBe(200);
    await guestAgain.context().close();
  });

  test("R5: une fois les 7 jours écoulés, l'annulation n'est plus proposée", async ({ page }) => {
    await signIn(page);
    const id = await createEvent(page, "Trop tard");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await setEventColumns(id, { status: "pending_deletion", deleted_at: tenDaysAgo });

    await page.reload();
    await expect(page.getByRole("heading", { name: /Suppression prévue le/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Annuler la suppression" })).toHaveCount(0);
  });

  test("R5: les zones tactiles des boutons de suppression font au moins 44 px", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page);
    await page.getByRole("button", { name: "Supprimer l’événement" }).click();
    for (const name of ["Non, garder l’événement", "Oui, supprimer"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
    }
  });
});
