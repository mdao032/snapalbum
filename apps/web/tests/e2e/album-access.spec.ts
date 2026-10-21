import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows, setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * Album access after the event (F-043) and the e-mail for the album link (F-044): what the event
 * page offers at each moment, the guest's separate consent, the organiser's "the album is ready".
 */

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100",
  forcePathStyle: true,
  credentials: { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" },
});

test.beforeAll(async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: "snapalbum-e2e" }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
    if (process.env.CI) throw error;
    test.skip(true, "S3 emulator not running (pnpm storage:start)");
  }
});

const DAY = 24 * 60 * 60 * 1000;
const dayOffset = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** Changes keys of the event settings (jsonb), keeping the others. */
async function setSettings(eventId: string, change: Record<string, unknown>) {
  const [event] = await getRows("events", `id=eq.${eventId}&select=settings`);
  await setEventColumns(eventId, { settings: { ...(event?.settings as object), ...change } });
}

async function join(page: Page) {
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
}

/** A guest sends one photo and joins, while the event is live. */
async function guestSends(page: Page, code: string, seed: number) {
  await page.goto(`/e/${code}`);
  await chooseFromGallery(page, [{ name: `IMG_${seed}.png`, buffer: samplePhoto(seed) }]);
  await join(page);
  await expect(page.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
}

const albumButton = (page: Page) => page.getByRole("button", { name: "Voir l’album" });

test.describe("La page de l'événement selon le moment", () => {
  test("F-043: pendant l'événement, l'envoi est l'action principale et rien ne propose « Voir l'album »", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByTestId("gallery-input")).toHaveCount(1);
    await expect(albumButton(guest)).toHaveCount(0);
    await expect(guest.getByText("Il vous reste des photos à partager ?")).toHaveCount(0);
    await guest.context().close();
  });

  test("F-043: après la fête, « Voir l'album » passe devant et l'envoi reste possible en second", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, 51);
    await setEventColumns(id, { event_date: dayOffset(-5).slice(0, 10) });

    await guest.reload();
    await expect(albumButton(guest)).toBeVisible();
    await expect(
      guest.getByText("Il vous reste des photos à partager ? Vous pouvez encore les ajouter."),
    ).toBeVisible();
    await expect(guest.getByTestId("gallery-input")).toHaveCount(1);
    // The album is the primary button: it comes before the upload buttons on the page.
    const order = await guest.evaluate(() => {
      const all = [...document.querySelectorAll("button, label")];
      const album = all.findIndex((node) => node.textContent?.includes("Voir l’album"));
      const upload = all.findIndex((node) => node.textContent?.includes("Choisir dans la galerie"));
      return album < upload;
    });
    expect(order).toBe(true);
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);

    await albumButton(guest).click();
    await expect(guest.getByTestId("tab-gallery")).toHaveAttribute("aria-selected", "true");
    await expect(guest.getByTestId("gallery-tile")).toHaveCount(1);
    await guest.context().close();
  });

  test("F-043: une fois la fenêtre d'envoi terminée, plus d'envoi, seulement l'album", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setEventColumns(id, { event_date: dayOffset(-40).slice(0, 10) });
    await setSettings(id, {
      upload_opens_at: dayOffset(-47),
      upload_closes_at: dayOffset(-10),
    });

    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(
      guest.getByText("L’envoi de photos est terminé pour cet événement."),
    ).toBeVisible();
    await expect(guest.getByTestId("gallery-input")).toHaveCount(0);
    await expect(guest.getByTestId("camera-input")).toHaveCount(0);
    await expect(albumButton(guest)).toBeVisible();
    await expectNoAccessibilityViolations(guest);

    // Not joined yet: the album asks to take part first.
    await albumButton(guest).click();
    await expect(
      guest.getByText("Participez à l’album pour voir les photos des autres invités."),
    ).toBeVisible();
    await guest.context().close();
  });

  test("F-043: envois terminés et galerie fermée : le dit sans proposer d'album", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setSettings(id, { upload_closes_at: dayOffset(-1), gallery_visible: false });

    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(
      guest.getByText("L’envoi de photos est terminé pour cet événement."),
    ).toBeVisible();
    await expect(
      guest.getByText("L’organisateur n’a pas ouvert l’album aux invités."),
    ).toBeVisible();
    await expect(albumButton(guest)).toHaveCount(0);
    await expect(guest.getByTestId("tab-gallery")).toHaveCount(0);
    await guest.context().close();
  });

  test("F-043: avant l'ouverture des envois, la page l'annonce sans boutons d'envoi", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setSettings(id, { upload_opens_at: dayOffset(3), upload_closes_at: dayOffset(30) });

    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByText("L’envoi de photos ouvre bientôt")).toBeVisible();
    await expect(guest.getByTestId("gallery-input")).toHaveCount(0);
    await expect(guest.getByTestId("tab-gallery")).toHaveCount(0);
    await expectNoAccessibilityViolations(guest);
    await guest.context().close();
  });
});

test.describe("Prévenez-moi quand l'album est prêt", () => {
  const openForm = async (guest: Page) => {
    await guest.getByRole("button", { name: "Prévenez-moi quand l’album est prêt" }).click();
    return guest.getByTestId("notify-email");
  };

  test("F-044: l'adresse n'est enregistrée qu'avec son consentement, se retrouve, et se retire", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    // Not joined: the button does not exist yet.
    await expect(
      guest.getByRole("button", { name: "Prévenez-moi quand l’album est prêt" }),
    ).toHaveCount(0);
    await guestSends(guest, code, 52);

    const form = await openForm(guest);
    await expectNoAccessibilityViolations(guest);
    await form.getByRole("button", { name: "Me prévenir" }).click();
    await expect(form.getByText("Cette adresse ne semble pas valide.")).toBeVisible();
    await expect(form.getByText("Cochez la case pour continuer.")).toBeVisible();

    // A valid address without the consent is still refused, and nothing is stored.
    await form.getByLabel("Votre adresse e-mail").fill("Anna@Example.com");
    await form.getByRole("button", { name: "Me prévenir" }).click();
    await expect(form.getByText("Cochez la case pour continuer.")).toBeVisible();
    expect(
      await getRows("guests", `event_id=eq.${id}&select=notify_email,notify_consent_at`),
    ).toEqual([{ notify_email: null, notify_consent_at: null }]);

    await form.getByLabel(/J’accepte de recevoir un e-mail à cette adresse/).check();
    await form.getByRole("button", { name: "Me prévenir" }).click();
    await expect(
      form.getByText("C’est noté. Nous écrirons à anna@example.com quand l’album sera prêt."),
    ).toBeVisible();
    const [stored] = await getRows(
      "guests",
      `event_id=eq.${id}&select=notify_email,notify_consent_at`,
    );
    expect(stored?.notify_email).toBe("anna@example.com");
    expect(typeof stored?.notify_consent_at).toBe("string");

    // Back later: the address is shown again, and can be withdrawn.
    await guest.reload();
    const again = await openForm(guest);
    await expect(again.getByText(/Nous écrirons à anna@example.com/)).toBeVisible();
    await again.getByRole("button", { name: "Ne plus me prévenir" }).click();
    await expect(
      again.getByText("C’est fait : nous n’écrirons pas à cette adresse."),
    ).toBeVisible();
    expect(
      await getRows("guests", `event_id=eq.${id}&select=notify_email,notify_consent_at`),
    ).toEqual([{ notify_email: null, notify_consent_at: null }]);
    await expectNoHorizontalScroll(guest);
    await guest.context().close();
  });

  test("F-044: le tableau de bord compte les invités en attente, et « L'album est prêt » ne se déclare qu'une fois", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, 53);
    const form = await openForm(guest);
    await form.getByLabel("Votre adresse e-mail").fill("anna@example.com");
    await form.getByLabel(/J’accepte de recevoir un e-mail à cette adresse/).check();
    await form.getByRole("button", { name: "Me prévenir" }).click();
    await expect(form.getByText(/C’est noté/)).toBeVisible();

    await page.goto(`/events/${id}`);
    await expect(page.getByText("1 invité a laissé son e-mail.")).toBeVisible();
    await expect(page.getByTestId("album-ready-done")).toHaveCount(0);

    await page.getByRole("button", { name: "L’album est prêt" }).click();
    await expect(page.getByText(/Cela ne se fait qu’une fois/)).toBeVisible();
    await page.getByRole("button", { name: "Pas encore" }).click();
    expect(
      (await getRows("events", `id=eq.${id}&select=settings`))[0]?.settings,
    ).not.toHaveProperty("album_ready_at");

    await page.getByRole("button", { name: "L’album est prêt" }).click();
    await page.getByRole("button", { name: "Oui, l’album est prêt" }).click();
    await expect(page.getByTestId("album-ready-done")).toContainText("Album déclaré prêt le");
    const [event] = await getRows("events", `id=eq.${id}&select=settings`);
    const readyAt = (event?.settings as { album_ready_at?: string }).album_ready_at;
    expect(typeof readyAt).toBe("string");

    // Reloading shows it as done, with the same moment, and no way to declare it again.
    await page.reload();
    await expect(page.getByTestId("album-ready-done")).toBeVisible();
    await expect(page.getByRole("button", { name: "L’album est prêt" })).toHaveCount(0);
    expect(
      (
        (await getRows("events", `id=eq.${id}&select=settings`))[0]?.settings as {
          album_ready_at?: string;
        }
      ).album_ready_at,
    ).toBe(readyAt);
    await expectNoAccessibilityViolations(page);
    await guest.context().close();
  });

  test("S-001: l'API refuse une demande sans session", async ({ request }) => {
    const call = (data: unknown) => request.post("/api/guests/notify", { data });
    const set = { action: "set", eventCode: "k7m2x9qvbr", email: "a@example.com", consent: true };
    expect((await call(set)).status()).toBe(401);
    expect((await call({ action: "clear", eventCode: "k7m2x9qvbr" })).status()).toBe(401);
  });
});
