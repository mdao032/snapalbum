import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows, insertRows, patchRows, setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * The album (F-039, F-050 to F-054, F-056) against the real database and the storage emulator:
 * the "Gallery" tab, the virtualised grid, the viewer, sort and filters, share links.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: ENDPOINT,
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

async function join(page: Page, name?: string) {
  if (name) await page.getByLabel("Votre prénom (facultatif)").fill(name);
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
}

/** A guest arrives, sends the given photos and joins (with a first name if given). */
async function guestSends(page: Page, code: string, seeds: number[], name?: string): Promise<void> {
  await page.goto(`/e/${code}`);
  await chooseFromGallery(
    page,
    seeds.map((seed) => ({ name: `IMG_${seed}.png`, buffer: samplePhoto(seed) })),
  );
  await join(page, name);
  await expect(page.locator("li[data-status='sent']")).toHaveCount(seeds.length, {
    timeout: 30_000,
  });
}

const openGallery = (page: Page) => page.getByTestId("tab-gallery").click();
const tiles = (page: Page) => page.getByTestId("gallery-tile");

/** Every picture of the grid has really been decoded by the browser (naturalWidth > 0). */
async function expectPicturesLoaded(page: Page) {
  await expect
    .poll(() =>
      page
        .getByTestId("gallery-tile")
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
}

/** Extra media rows copied from an uploaded one (same files), to test volume, sort and filters. */
async function cloneMedia(
  eventId: string,
  count: number,
  options: { kind?: "photo" | "video"; guestId?: string; firstTaken?: number } = {},
) {
  const [template] = await getRows("media", `event_id=eq.${eventId}&status=eq.ready&limit=1`);
  if (!template) throw new Error("upload a photo first");
  const kind = options.kind ?? "photo";
  const base = options.firstTaken ?? Date.parse("2026-01-01T10:00:00Z");
  const rows = Array.from({ length: count }, (_, index) => ({
    event_id: eventId,
    guest_id: options.guestId ?? template.guest_id,
    kind,
    status: "ready",
    moderation: "approved",
    sha256:
      `${index.toString(16).padStart(8, "0")}${Math.random().toString(16).slice(2).padEnd(56, "0")}`
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, "0"),
    mime_type: kind === "photo" ? template.mime_type : "video/mp4",
    bytes_display: kind === "photo" ? 1000 : null,
    bytes_original: kind === "video" ? 1000 : null,
    bytes_thumb: 500,
    width: 96,
    height: 64,
    blurhash: template.blurhash,
    taken_at: new Date(base + index * 60_000).toISOString(),
    key_thumb: template.key_thumb,
    key_display: kind === "photo" ? template.key_display : null,
    key_original: kind === "video" ? template.key_display : null,
  }));
  return insertRows("media", rows);
}

test.describe("Galerie", () => {
  test("F-039: l'onglet Galerie n'existe que si l'organisateur a ouvert la galerie aux invités", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByTestId("tab-gallery")).toBeVisible();
    await expect(guest.getByTestId("tab-upload")).toHaveAttribute("aria-selected", "true");

    const [event] = await getRows("events", `id=eq.${id}&select=settings`);
    await setEventColumns(id, {
      settings: { ...(event?.settings as object), gallery_visible: false },
    });
    await guest.reload();
    await expect(guest.getByText("Choisir dans la galerie")).toBeVisible();
    await expect(guest.getByTestId("tab-gallery")).toHaveCount(0);
    await guest.context().close();
  });

  test("F-039, F-053: la galerie montre les médias approuvés, miniatures décodées et blurhash dessiné", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [1, 2, 3]);
    const rows = await getRows("media", `event_id=eq.${id}&select=id&order=created_at.asc`);
    await patchRows("media", `id=eq.${String(rows[2]?.id)}`, { moderation: "pending" });

    await openGallery(guest);
    await expect(tiles(guest)).toHaveCount(2);
    await expect(guest.getByText("2 photos et vidéos")).toBeVisible();
    await expectPicturesLoaded(guest);
    await expect(guest.getByTestId("gallery-tile").first().locator("canvas")).toHaveCount(1);

    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);
    await guest.context().close();
  });

  test("F-039: un visiteur qui n'a pas encore participé doit d'abord participer, puis voit l'album", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const author = await newVisitor(browser);
    await guestSends(author, code, [4]);

    const visitor = await newVisitor(browser);
    await visitor.goto(`/e/${code}`);
    await visitor.waitForLoadState("networkidle");
    await openGallery(visitor);
    await expect(
      visitor.getByText("Participez à l’album pour voir les photos des autres invités."),
    ).toBeVisible();
    await join(visitor);
    await expect(tiles(visitor)).toHaveCount(1);
    await expectPicturesLoaded(visitor);
    await author.context().close();
    await visitor.context().close();
  });

  test("F-056: la même photo envoyée par deux invités n'apparaît qu'une fois", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const alice = await newVisitor(browser);
    await guestSends(alice, code, [5]);
    const bob = await newVisitor(browser);
    await guestSends(bob, code, [5]);

    await openGallery(bob);
    await expect(tiles(bob)).toHaveCount(1);
    await expect(bob.getByText("1 photo ou vidéo")).toBeVisible();
    await alice.context().close();
    await bob.context().close();
  });
});

test.describe("Visionneuse", () => {
  test("F-051: la visionneuse s'ouvre sur la photo, se parcourt au clavier et se ferme avec Échap", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [6, 7]);
    await openGallery(guest);
    await expect(tiles(guest)).toHaveCount(2);

    await tiles(guest).first().click();
    const viewer = guest.getByTestId("gallery-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("1 sur 2")).toBeVisible();
    await expect
      .poll(() =>
        viewer
          .getByTestId("viewer-photo")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    await expectNoAccessibilityViolations(guest);

    await guest.keyboard.press("ArrowRight");
    await expect(viewer.getByText("2 sur 2")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Photo suivante" })).toHaveCount(0);
    await guest.keyboard.press("ArrowLeft");
    await expect(viewer.getByText("1 sur 2")).toBeVisible();

    // The download address forces a download, named after the event.
    const download = viewer.getByTestId("viewer-download");
    await expect(download).toHaveAttribute("href", /response-content-disposition=attachment/);
    await expect(download).toHaveAttribute("href", /mariage-de-lea-et-tom/);

    await guest.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(tiles(guest)).toHaveCount(2);
    await guest.context().close();
  });

  test("F-051: le zoom se fait au clavier, au double geste et se remet à zéro en changeant de photo", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [8, 9]);
    await openGallery(guest);
    await tiles(guest).first().click();
    const viewer = guest.getByTestId("gallery-viewer");
    const photo = viewer.getByTestId("viewer-photo");
    const scaleOf = async () =>
      photo.evaluate((image) => {
        const match = /scale\(([\d.]+)\)/.exec(image.parentElement?.style.transform ?? "");
        return match ? Number(match[1]) : 1;
      });
    await expect(photo).toBeVisible();

    expect(await scaleOf()).toBe(1);
    await guest.keyboard.press("+");
    await expect.poll(scaleOf).toBeGreaterThan(1);
    await guest.keyboard.press("0");
    await expect.poll(scaleOf).toBe(1);

    const box = (await viewer.boundingBox())!;
    await guest.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(scaleOf).toBeGreaterThan(2);
    await guest.keyboard.press("ArrowRight");
    await expect(viewer.getByText("2 sur 2")).toBeVisible();
    await expect.poll(scaleOf).toBe(1);
    await guest.context().close();
  });

  test("F-051: un balayage vers la gauche passe à la photo suivante", async ({ page, browser }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [10, 11]);
    await openGallery(guest);
    await tiles(guest).first().click();
    const viewer = guest.getByTestId("gallery-viewer");
    await expect(viewer.getByText("1 sur 2")).toBeVisible();

    const box = (await viewer.boundingBox())!;
    const y = box.y + box.height / 2;
    await guest.mouse.move(box.x + box.width * 0.8, y);
    await guest.mouse.down();
    await guest.mouse.move(box.x + box.width * 0.3, y, { steps: 6 });
    await guest.mouse.up();
    await expect(viewer.getByText("2 sur 2")).toBeVisible();
    await guest.context().close();
  });
});

test.describe("Tri, filtres et volume", () => {
  test("F-052: tri par date de prise de vue ou d'envoi, filtre photos, vidéos et par invité", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const anna = await newVisitor(browser);
    await guestSends(anna, code, [12], "Anna");
    const bob = await newVisitor(browser);
    await guestSends(bob, code, [13]);
    const rows = await getRows(
      "media",
      `event_id=eq.${id}&select=id,guest_id&order=created_at.asc`,
    );
    const [annaPhoto, bobPhoto] = rows as { id: string; guest_id: string }[];
    // Anna's photo was taken last but sent first; two videos of Anna's complete the album.
    await patchRows("media", `id=eq.${annaPhoto!.id}`, { taken_at: "2026-09-12T20:00:00Z" });
    await patchRows("media", `id=eq.${bobPhoto!.id}`, { taken_at: "2026-09-12T10:00:00Z" });
    await cloneMedia(id, 2, {
      kind: "video",
      guestId: annaPhoto!.guest_id,
      firstTaken: Date.parse("2026-12-01T00:00:00Z"),
    });

    await openGallery(anna);
    await expect(tiles(anna)).toHaveCount(4);
    const firstId = () => tiles(anna).first().getAttribute("data-media-id");
    const sort = anna.getByLabel("Trier par");

    // Taken, oldest first: Bob's photo (10:00) leads, the videos (December) come last.
    await sort.selectOption({ label: "Prise de vue, anciennes d’abord" });
    await expect.poll(firstId).toBe(bobPhoto!.id);
    await sort.selectOption({ label: "Envoi, anciens d’abord" });
    await expect.poll(firstId).toBe(annaPhoto!.id);

    await anna.getByRole("button", { name: "Vidéos", exact: true }).click();
    await expect(anna.getByText("2 photos et vidéos")).toBeVisible();
    await expect(tiles(anna)).toHaveCount(2);
    await anna.getByRole("button", { name: "Photos", exact: true }).click();
    await expect(tiles(anna)).toHaveCount(2);
    await anna.getByRole("button", { name: "Tout", exact: true }).click();
    await expect(tiles(anna)).toHaveCount(4);

    // Filter by guest: Bob sent one photo.
    await anna.getByLabel("Envoyé par").selectOption({ label: "Invité sans prénom (1)" });
    await expect(tiles(anna)).toHaveCount(1);
    await expect(tiles(anna).first()).toHaveAttribute("data-media-id", bobPhoto!.id);

    // A filter with nothing to show says so and offers a way back.
    await anna.getByRole("button", { name: "Vidéos", exact: true }).click();
    await expect(anna.getByText("Aucune photo ne correspond à ce choix.")).toBeVisible();
    await anna.getByRole("button", { name: "Tout afficher" }).click();
    await expect(tiles(anna)).toHaveCount(4);
    await anna.context().close();
    await bob.context().close();
  });

  test("F-050: 1 500 médias sont parcourus sans jamais dessiner plus de quelques lignes", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [14]);
    const clones = await cloneMedia(id, 1500, { firstTaken: Date.parse("2020-01-01T00:00:00Z") });
    const oldest = String(clones[0]?.id);

    await openGallery(guest);
    await expect(guest.getByText(/1\D?501 photos et vidéos/)).toBeVisible();
    await expect(tiles(guest).first()).toBeVisible();
    const drawn = () => tiles(guest).count();
    expect(await drawn()).toBeLessThan(150);

    // Scroll until the oldest photo (the very last) has been reached, page after page.
    const last = guest.locator(`[data-media-id="${oldest}"]`);
    for (let step = 0; step < 250 && (await last.count()) === 0; step += 1) {
      await guest.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await guest.waitForTimeout(150);
    }
    await expect(last).toHaveCount(1);
    expect(await drawn()).toBeLessThan(150);
    await expectPicturesLoaded(guest);
    await expectNoHorizontalScroll(guest);
    await guest.context().close();
  });

  test("SPEC 9.1: les adresses des miniatures sont renouvelées avant d'expirer", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.clock.install();
    await guestSends(guest, code, [15]);
    await openGallery(guest);
    await expect(tiles(guest)).toHaveCount(1);
    await expectPicturesLoaded(guest);
    const before = await tiles(guest).locator("img").getAttribute("src");
    const asked: string[] = [];
    guest.on("request", (request) => {
      if (request.url().includes("/api/gallery")) {
        asked.push((request.postDataJSON() as { action?: string }).action ?? "");
      }
    });
    // The signed addresses carry the second they were made: let one pass so a new one differs.
    await guest.waitForTimeout(1100);
    expect(asked).not.toContain("thumbs");

    const renewal = guest.waitForRequest(
      (request) =>
        request.url().includes("/api/gallery") &&
        (request.postDataJSON() as { action?: string }).action === "thumbs",
    );
    // 56 minutes later the hour-long addresses are about to expire.
    await guest.clock.fastForward("56:00");
    await renewal;
    await expect.poll(() => tiles(guest).locator("img").getAttribute("src")).not.toBe(before);
    await expectPicturesLoaded(guest);
    await guest.context().close();
  });
});

test.describe("Lien de partage", () => {
  test("F-054: l'organisateur crée un lien, un visiteur sans compte voit l'album en lecture seule, la révocation le coupe", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [16, 17], "Anna");

    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "Créer un lien de partage" }).click();
    const field = page.getByLabel("Lien de partage");
    await expect(field).toBeVisible();
    const link = new URL(await field.inputValue());
    expect(link.pathname).toMatch(/^\/g\/[A-Za-z0-9_-]{32}$/);

    const visitor = await newVisitor(browser);
    await visitor.goto(link.pathname);
    await expect(visitor.getByRole("heading", { name: "Mariage de Léa et Tom" })).toBeVisible();
    await expect(visitor.getByText("Cet album est en lecture seule.")).toBeVisible();
    await expect(tiles(visitor)).toHaveCount(2);
    await expectPicturesLoaded(visitor);
    // No upload, no guest names, nothing that identifies who sent what.
    await expect(visitor.getByText("Choisir dans la galerie")).toHaveCount(0);
    await expect(visitor.getByLabel("Envoyé par")).toHaveCount(0);
    await expect(visitor.getByText("Anna")).toHaveCount(0);
    await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(visitor.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
    await expectNoAccessibilityViolations(visitor);
    await expectNoHorizontalScroll(visitor);

    // The viewer works on a share link too.
    await tiles(visitor).first().click();
    await expect(visitor.getByTestId("gallery-viewer").getByText("1 sur 2")).toBeVisible();
    await visitor.keyboard.press("Escape");

    await page.getByRole("button", { name: "Révoquer le lien" }).click();
    await expect(page.getByText(/cessera de fonctionner/)).toBeVisible();
    await page.getByRole("button", { name: "Oui, révoquer" }).click();
    await expect(page.getByText("Lien révoqué : il ne fonctionne plus.")).toBeVisible();
    await expect(page.getByLabel("Lien de partage")).toHaveCount(0);

    await visitor.reload();
    await expect(visitor.getByText("Cette page est introuvable")).toBeVisible();
    await guest.context().close();
    await visitor.context().close();
  });

  test("F-054: un lien inventé ou mal formé est une page introuvable", async ({ browser }) => {
    const visitor = await newVisitor(browser);
    await visitor.goto(`/g/${"a".repeat(32)}`);
    await expect(visitor.getByText("Cette page est introuvable")).toBeVisible();
    await visitor.goto("/g/trop-court");
    await expect(visitor.getByText("Cette page est introuvable")).toBeVisible();
    await visitor.context().close();
  });
});

test.describe("API de la galerie", () => {
  test("S-001, NF-043: refuse l'absence de session, un corps invalide, un lien inconnu", async ({
    request,
  }) => {
    const call = (data: unknown) => request.post("/api/gallery", { data });
    const event = { type: "event", eventCode: "k7m2x9qvbr" };

    expect((await call({ action: "list", access: event })).status()).toBe(401);
    expect((await call({ action: "list" })).status()).toBe(400);
    expect((await call({ action: "files", access: event, mediaIds: [] })).status()).toBe(400);
    const unknown = await call({
      action: "list",
      access: { type: "share", token: "z".repeat(32) },
    });
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: "not_found" } });
  });
});
