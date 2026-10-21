import type { Browser, Page } from "@playwright/test";
import { getRows } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/** The organiser sets (or removes) the access code from the dashboard. */
async function setAccessCode(page: Page, id: string, code: string | null) {
  await page.goto(`/events/${id}`);
  const form = page.locator("form").filter({ has: page.getByLabel("Début des envois") });
  await expect(page.getByLabel("Début des envois")).toBeVisible();
  if (code === null) await form.getByLabel("Retirer le code d’accès").check();
  else await form.getByLabel("Code d’accès (facultatif)").fill(code);
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Paramètres enregistrés" }),
  ).toBeVisible();
}

/** Opens the event page and chooses a photo: the join step appears with the first choice. */
async function visit(browser: Browser, path: string): Promise<Page> {
  const page = await newVisitor(browser);
  await page.goto(path);
  await chooseFromGallery(page, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
  return page;
}

test.describe("participer à un événement", () => {
  test("F-035: un invité sans compte rejoint l'événement en une étape légère, et reste reconnu", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await visit(browser, `/${code}`);
    await expect(guest).toHaveURL(new RegExp(`/e/${code}$`));

    await expect(guest.getByRole("heading", { name: "Participez à l’album" })).toBeVisible();
    await expect(guest.getByLabel("Code d’accès")).toHaveCount(0);
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);

    await guest.getByLabel("Votre prénom (facultatif)").fill("Élodie");
    await guest.getByLabel(/J’accepte que mes photos/).check();
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(
      guest.getByRole("status").filter({ hasText: "Vous participez en tant que Élodie" }),
    ).toBeVisible();

    // The anonymous session is a cookie: a reload keeps the guest.
    await guest.reload();
    await expect(guest.getByText("Vous participez en tant que Élodie")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Participer" })).toHaveCount(0);

    // F-034: the terms are recorded with their date and version.
    const rows = await getRows(
      "guests",
      `event_id=eq.${id}&select=display_name,terms_accepted_at,terms_version`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ display_name: "Élodie", terms_version: "2026-10" });
    expect(Date.now() - Date.parse(String(rows[0]?.terms_accepted_at))).toBeLessThan(60_000);
    await guest.context().close();
  });

  test("F-034: sans la case des conditions, rien n'est envoyé et le message explique pourquoi", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await visit(browser, `/e/${code}`);
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "Cochez la case" })).toBeVisible();
    await expect(guest.getByLabel(/J’accepte que mes photos/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await getRows("guests", `event_id=eq.${id}&select=id`)).toHaveLength(0);
    await guest.context().close();
  });

  test("F-033: le prénom est facultatif et mémorisé sur l'appareil", async ({ page, browser }) => {
    const { code, id } = await createEvent(page);
    const guest = await visit(browser, `/e/${code}`);
    await guest.getByLabel(/J’accepte que mes photos/).check();
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByText("Vous participez à l’album.")).toBeVisible();

    // Another event on the same device: the form is prefilled with the name given before.
    await guest.evaluate(() => window.localStorage.setItem("snapalbum:guest-name", "Tom"));
    await guest.context().clearCookies();
    await guest.reload();
    await chooseFromGallery(guest, [{ name: "IMG_0002.png", buffer: samplePhoto(2) }]);
    await expect(guest.getByLabel("Votre prénom (facultatif)")).toHaveValue("Tom");
    expect((await getRows("guests", `event_id=eq.${id}&select=display_name`))[0]).toEqual({
      display_name: null,
    });
    await guest.context().close();
  });

  test("F-035: l'anglais suit la langue de l'événement et de la page", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await visit(browser, `/en/e/${code}`);
    await expect(guest.getByRole("heading", { name: "Join the album" })).toBeVisible();
    await guest.getByLabel(/I agree that my photos/).check();
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest.getByText("You are taking part in the album.")).toBeVisible();
    await guest.context().close();
  });

  test("NF-031: les champs et le bouton de participation ont une zone tactile d'au moins 44 px", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await visit(browser, `/e/${code}`);
    for (const locator of [
      guest.getByLabel("Votre prénom (facultatif)"),
      guest.getByRole("button", { name: "Participer" }),
    ]) {
      expect((await locator.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await guest.context().close();
  });
});

test.describe("code d'accès", () => {
  test("F-017, S-006: le code est demandé, vérifié, jamais stocké en clair, et l'organisateur peut le retirer", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setAccessCode(page, id, "4821");
    await expect(page.getByText("Un code d’accès est défini")).toBeVisible();

    const settings = await getRows("events", `id=eq.${id}&select=settings`);
    expect(JSON.stringify(settings)).not.toContain("4821");
    expect(JSON.stringify(settings)).toContain("scrypt$");

    const guest = await visit(browser, `/e/${code}`);
    await expect(guest.getByLabel("Code d’accès")).toBeVisible();
    await guest.getByLabel(/J’accepte que mes photos/).check();

    await guest.getByLabel("Code d’accès").fill("0000");
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(
      guest.getByRole("alert").filter({ hasText: "Ce code n’est pas le bon" }),
    ).toBeVisible();
    expect(await getRows("guests", `event_id=eq.${id}&select=id`)).toHaveLength(0);

    await guest.getByLabel("Code d’accès").fill("4821");
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByText("Vous participez à l’album.")).toBeVisible();
    await guest.context().close();

    // The organiser removes the code: a new guest is no longer asked for it.
    await setAccessCode(page, id, null);
    const another = await visit(browser, `/e/${code}`);
    await expect(another.getByRole("heading", { name: "Participez à l’album" })).toBeVisible();
    await expect(another.getByLabel("Code d’accès")).toHaveCount(0);
    await another.context().close();
  });

  test("S-006: les essais de code sont limités : le sixième est refusé avec une explication", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setAccessCode(page, id, "4821");
    const guest = await visit(browser, `/e/${code}`);
    await guest.getByLabel(/J’accepte que mes photos/).check();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await guest.getByLabel("Code d’accès").fill("0000");
      await guest.getByRole("button", { name: "Participer" }).click();
      await expect(
        guest.getByRole("alert").filter({ hasText: "Ce code n’est pas le bon" }),
      ).toBeVisible();
    }
    // Even the right code is refused once the limit is reached.
    await guest.getByLabel("Code d’accès").fill("4821");
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "Trop de demandes" })).toBeVisible();
    expect(await getRows("guests", `event_id=eq.${id}&select=id`)).toHaveLength(0);
    await guest.context().close();
  });

  test("F-017: un code qui n'a pas 4 à 6 chiffres est refusé dans les réglages, avec une explication", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Début des envois") });
    await expect(page.getByLabel("Début des envois")).toBeVisible();
    // The browser's own check would stop most typos: bypass it to reach the server rule.
    await form.getByLabel("Code d’accès (facultatif)").evaluate((input: HTMLInputElement) => {
      input.removeAttribute("pattern");
      input.value = "12";
    });
    await form.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "4 à 6 chiffres" })).toBeVisible();
  });
});
