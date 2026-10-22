import type { APIRequestContext, Page } from "@playwright/test";
import { getRows, patchRows } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { createEvent } from "./guest-helpers";

/**
 * "My account" (step 5.2, F-004, G-004, R5): the copy of the data and the deletion of the account
 * with its 7 days to change one's mind, against the real server and database. The purge is run
 * by the scheduled task, with the dates moved in the database rather than by waiting.
 */

const CRON = "cron-secret-for-e2e-tests-only-1234";
const DAY = 24 * 60 * 60 * 1000;

test.setTimeout(150_000);

const task = (request: APIRequestContext, name: string) =>
  request.get(`/api/cron/${name}`, {
    headers: { authorization: `Bearer ${CRON}` },
    timeout: 140_000,
  });

async function ownerOf(eventId: string): Promise<string> {
  const [row] = await getRows("events", `id=eq.${eventId}&select=owner_id`);
  return String(row?.owner_id);
}

const deleteCard = (page: Page) => page.getByTestId("delete-account");

async function requestDeletion(page: Page) {
  await page.goto("/account");
  await deleteCard(page)
    .getByLabel(/Je comprends que la suppression sera définitive/)
    .check();
  await deleteCard(page).getByRole("button", { name: "Supprimer mon compte" }).click();
  await expect(deleteCard(page)).toHaveAttribute("data-pending", "yes");
}

test.describe("G-004: copie des données", () => {
  test("le fichier contient les données de la personne, sans secret, en téléchargement", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    const response = await page.request.get("/api/account/export");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="snapalbum-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers()["cache-control"]).toContain("no-store");
    const data = await response.json();
    expect(data.format).toBe(1);
    expect(data.account.id).toBe(await ownerOf(id));
    expect(data.events.map((event: { id: string }) => event.id)).toEqual([id]);
    expect(data.events[0]).toMatchObject({ title: "Mariage de Léa et Tom", plan: "free" });
    const text = JSON.stringify(data);
    expect(text).not.toContain("access_code_hash");
    expect(text).not.toContain("notify_email");
  });

  test("S-001: sans session, c'est refusé ; une autre personne ne voit jamais ces événements", async ({
    page,
    browser,
    request,
  }) => {
    const { id } = await createEvent(page);
    expect((await request.get("/api/account/export")).status()).toBe(401);

    const other = await newVisitor(browser);
    await createEvent(other);
    const data = await (await other.request.get("/api/account/export")).json();
    expect(JSON.stringify(data)).not.toContain(id);
    await other.context().close();
  });

  test("la carte « Vos données » propose le téléchargement", async ({ page }) => {
    await createEvent(page);
    await page.goto("/account");
    const card = page.getByTestId("account-data");
    await expect(card.getByRole("link", { name: "Télécharger mes données" })).toHaveAttribute(
      "href",
      "/api/account/export",
    );
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("F-004, R5: suppression du compte", () => {
  test("la case est obligatoire, puis la demande ferme les albums, annonce la date et se voit partout", async ({
    page,
    browser,
  }) => {
    const { id, code } = await createEvent(page);
    await page.goto("/account");
    const submit = deleteCard(page).getByRole("button", { name: "Supprimer mon compte" });
    await expect(submit).toBeDisabled();
    await expect(deleteCard(page)).toContainText("La suppression prend effet dans 7 jours");
    await expectNoAccessibilityViolations(page);

    await deleteCard(page)
      .getByLabel(/Je comprends que la suppression sera définitive/)
      .check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(deleteCard(page)).toHaveAttribute("data-pending", "yes");
    await expect(deleteCard(page).getByRole("heading")).toContainText(
      /Suppression du compte prévue le \d{1,2}(er)? [\p{L}éû]+ \d{4}/u,
    );
    await expect(page.getByTestId("account-deletion-banner")).toContainText(
      "Suppression de votre compte prévue le",
    );
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    // The album is closed to guests at once.
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByText("Cette page est introuvable")).toBeVisible();
    await guest.context().close();

    // The event page says why, with no cancel button of its own.
    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("account-pending-card")).toContainText(
      "Le compte de cet événement est en cours de suppression",
    );
    await expect(page.getByRole("button", { name: "Annuler la suppression" })).toHaveCount(0);
    await expect(page.getByTestId("account-deletion-banner")).toBeVisible();

    const [profile] = await getRows(
      "profiles",
      `user_id=eq.${await ownerOf(id)}&select=deleted_at`,
    );
    expect(profile?.deleted_at).toBeTruthy();
  });

  test("un compte en cours de suppression ne crée pas d'événement", async ({ page }) => {
    await createEvent(page);
    await requestDeletion(page);

    await page.goto("/events/new");
    await page.getByLabel("Nom de l’événement").fill("Autre fête");
    await page.getByRole("button", { name: "Créer mon événement" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "compte" })).toContainText(
      "Votre compte est en cours de suppression",
    );
    await expect(page).toHaveURL(/\/events\/new$/);
  });

  test("annuler pendant les 7 jours remet le compte et l'album en service", async ({
    page,
    browser,
  }) => {
    const { id, code } = await createEvent(page);
    await requestDeletion(page);

    await deleteCard(page).getByRole("button", { name: "Annuler la suppression" }).click();
    await expect(deleteCard(page)).toHaveAttribute("data-pending", "no");
    await expect(deleteCard(page)).toContainText("La suppression est annulée");
    await expect(page.getByTestId("account-deletion-banner")).toHaveCount(0);

    const [event] = await getRows("events", `id=eq.${id}&select=status,deletion_reason`);
    expect(event).toEqual({ status: "active", deletion_reason: null });
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByRole("heading", { level: 1 })).toContainText("Mariage de Léa et Tom");
    await guest.context().close();
  });

  test("F-004: la tâche planifiée supprime le compte après 7 jours : événements, profil, connexion", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const owner = await ownerOf(id);
    await requestDeletion(page);

    // Six days: still there. Eight days: gone.
    await patchRows("profiles", `user_id=eq.${owner}`, {
      deleted_at: new Date(Date.now() - 6 * DAY).toISOString(),
    });
    expect((await task(request, "expire-events")).status()).toBe(200);
    expect(await getRows("profiles", `user_id=eq.${owner}&select=user_id`)).toHaveLength(1);

    await patchRows("profiles", `user_id=eq.${owner}`, {
      deleted_at: new Date(Date.now() - 8 * DAY).toISOString(),
    });
    const answer = await (await task(request, "expire-events")).json();
    expect(answer.accounts.purged).toContain(owner);

    expect(await getRows("profiles", `user_id=eq.${owner}&select=user_id`)).toEqual([]);
    expect(await getRows("events", `owner_id=eq.${owner}&select=id`)).toEqual([]);
    const audit = await getRows(
      "audit_log",
      `target_type=eq.user&target_id=eq.${owner}&select=action`,
    );
    expect(audit.map((line) => line.action).sort()).toEqual([
      "account_deletion_requested",
      "account_purged",
    ]);

    // The session of the deleted account no longer opens anything.
    await page.goto("/events");
    await expect(page).toHaveURL(/\/login/);
  });

  test("section 12: la carte est complète en anglais", async ({ page }) => {
    await createEvent(page);
    await page.goto("/en/account");
    await expect(page.getByTestId("account-data")).toContainText("Download my data");
    await expect(deleteCard(page)).toContainText("The deletion takes effect in 7 days");
    await expectNoAccessibilityViolations(page);
  });
});
