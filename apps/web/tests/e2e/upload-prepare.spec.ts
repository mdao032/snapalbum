import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BLURHASH_PATTERN } from "@snapalbum/shared/upload";
import { getRows, setEventColumns } from "./admin";
import { expect, newVisitor, test } from "./fixtures";
import { chooseFromGallery, createEvent } from "./guest-helpers";

/**
 * Preparation in the browser (SPEC 8.1, step 2; ROADMAP 2.5): each fixture of `tests/fixtures/`
 * goes through the real page, the real Web Worker (or the page itself without one) and the real
 * storage emulator, and what was STORED is inspected: sizes, orientation, colours, metadata.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const BUCKET = "snapalbum-e2e";
const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" },
});

const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

async function stored(key: string): Promise<Buffer> {
  const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(
    await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
  );
}

interface MediaRow {
  status: string;
  kind: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  taken_at: string | null;
  blurhash: string | null;
  key_display: string | null;
  key_thumb: string | null;
  key_original: string | null;
}

async function mediaOf(eventId: string): Promise<MediaRow[]> {
  return (await getRows(
    "media",
    `event_id=eq.${eventId}&select=status,kind,width,height,duration_s,taken_at,blurhash,key_display,key_thumb,key_original&order=created_at`,
  )) as unknown as MediaRow[];
}

/** The centre colour of each quarter of a picture: red, green / blue, yellow in the fixtures. */
async function quarterColours(image: Buffer) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const offset = (Math.floor(y) * info.width + Math.floor(x)) * 3;
    return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
  };
  const { width: w, height: h } = info;
  return {
    topLeft: at(w * 0.25, h * 0.25),
    topRight: at(w * 0.75, h * 0.25),
    bottomLeft: at(w * 0.25, h * 0.75),
    bottomRight: at(w * 0.75, h * 0.75),
  };
}

function expectClose(actual: number[], expected: number[]) {
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] ?? 0))).toBeLessThan(70);
  });
}

async function expectUprightQuarters(image: Buffer) {
  const colours = await quarterColours(image);
  expectClose(colours.topLeft, [224, 48, 48]);
  expectClose(colours.topRight, [48, 192, 48]);
  expectClose(colours.bottomLeft, [48, 80, 224]);
  expectClose(colours.bottomRight, [224, 208, 48]);
}

/** What a stored preview must be: an image the right size, upright, with no metadata at all. */
async function expectCleanPreview(key: string, size: { width: number; height: number }) {
  const bytes = await stored(key);
  const metadata = await sharp(bytes).metadata();
  expect(["webp", "jpeg"]).toContain(metadata.format);
  expect(key.endsWith(metadata.format === "webp" ? ".webp" : ".jpg")).toBe(true);
  expect({ width: metadata.width, height: metadata.height }).toEqual(size);
  // S-008: a re-encoded picture carries no EXIF block, so no position, no date, no camera.
  expect(metadata.exif).toBeUndefined();
  expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
  expect(bytes.includes(Buffer.from("GPS"))).toBe(false);
  return bytes;
}

test.beforeAll(async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
    // Without the emulator these tests cannot run: fail loudly in CI, skip on a bare machine.
    if (process.env.CI) throw error;
    test.skip(true, "S3 emulator not running (pnpm storage:start)");
  }
});

async function join(page: Page) {
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
}

/** A guest in Paris sends the files and waits for them to be stored. */
async function sendAsGuest(
  page: Page,
  browser: Parameters<typeof newVisitor>[0],
  files: { name: string; buffer: Buffer; mimeType: string }[],
  expectation: { sent: number; rejected?: number },
  setup?: (guest: Page) => Promise<void>,
  planOf?: (eventId: string) => Promise<void>,
) {
  const { code, id } = await createEvent(page);
  await planOf?.(id);
  const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
  await setup?.(guest);
  await guest.goto(`/e/${code}`);
  await chooseFromGallery(guest, files);
  await join(guest);
  await expect(guest.locator("li[data-status='sent']")).toHaveCount(expectation.sent, {
    timeout: 60_000,
  });
  if (expectation.rejected !== undefined) {
    await expect(guest.locator("li[data-status='rejected']")).toHaveCount(expectation.rejected);
  }
  return { guest, id, code };
}

test.describe("préparation des photos dans le navigateur", () => {
  test("S-008, SPEC 8.1: une photo avec position GPS ressort sans aucune métadonnée, avec sa date et son blurhash", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [{ name: "IMG_GPS.jpg", buffer: fixture("jpeg-gps.jpg"), mimeType: "image/jpeg" }],
      { sent: 1 },
    );
    const [media] = await mediaOf(id);
    expect(media).toMatchObject({ status: "ready", kind: "photo", width: 128, height: 96 });
    // 09:15:30 on 2 August 2025 in Paris (UTC+2), a camera that recorded no zone.
    expect(media?.taken_at).toMatch(/^2025-08-02T07:15:30/);
    expect(media?.blurhash).toMatch(BLURHASH_PATTERN);
    // The original (with its position) is not kept on the free plan; the previews hold none.
    expect(media?.key_original).toBeNull();
    const display = await expectCleanPreview(media?.key_display ?? "", { width: 128, height: 96 });
    await expectCleanPreview(media?.key_thumb ?? "", { width: 128, height: 96 });
    await expectUprightQuarters(display);
    await guest.context().close();
  });

  test("SPEC 8.1: une photo prise en travers (EXIF 6) est redressée dans les deux versions, avec la date et le fuseau de l'EXIF", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [
        {
          name: "IMG_PORTRAIT.jpg",
          buffer: fixture("jpeg-orientation-6.jpg"),
          mimeType: "image/jpeg",
        },
      ],
      { sent: 1 },
    );
    const [media] = await mediaOf(id);
    // Stored as 96 x 64: upright, it is 64 x 96.
    expect(media).toMatchObject({ width: 64, height: 96 });
    expect(media?.taken_at).toMatch(/^2026-06-14T14:45:10/);
    for (const key of [media?.key_display, media?.key_thumb]) {
      const bytes = await expectCleanPreview(key ?? "", { width: 64, height: 96 });
      await expectUprightQuarters(bytes);
    }
    await guest.context().close();
  });

  test("SPEC 8.1: sans OffscreenCanvas (ni Worker), la préparation se fait sur la page et donne les mêmes versions", async ({
    page,
    browser,
  }) => {
    let workers = 0;
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [
        {
          name: "IMG_PORTRAIT.jpg",
          buffer: fixture("jpeg-orientation-6.jpg"),
          mimeType: "image/jpeg",
        },
      ],
      { sent: 1 },
      async (visitor) => {
        await visitor.addInitScript(() => {
          // @ts-expect-error simulating an older browser
          delete window.OffscreenCanvas;
        });
        visitor.on("worker", () => {
          workers += 1;
        });
      },
    );
    expect(workers).toBe(0);
    const [media] = await mediaOf(id);
    expect(media).toMatchObject({ width: 64, height: 96 });
    const display = await expectCleanPreview(media?.key_display ?? "", { width: 64, height: 96 });
    await expectUprightQuarters(display);
    await guest.context().close();
  });

  test("SPEC 8.1: la préparation passe par un Web Worker là où le navigateur le permet", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "l'événement « worker » est fiable sous Chromium",
    );
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    let workers = 0;
    guest.on("worker", () => {
      workers += 1;
    });
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [
      {
        name: "IMG_PORTRAIT.jpg",
        buffer: fixture("jpeg-orientation-6.jpg"),
        mimeType: "image/jpeg",
      },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 60_000 });
    expect(workers).toBe(1);
    await guest.context().close();
  });

  test("SPEC 8.1: une grande photo est ramenée à 2 048 px (affichage) et 400 px (miniature)", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [{ name: "IMG_LARGE.jpg", buffer: fixture("jpeg-large.jpg"), mimeType: "image/jpeg" }],
      { sent: 1 },
    );
    const [media] = await mediaOf(id);
    expect(media).toMatchObject({ width: 3000, height: 2000 });
    await expectCleanPreview(media?.key_display ?? "", { width: 2048, height: 1365 });
    await expectCleanPreview(media?.key_thumb ?? "", { width: 400, height: 267 });
    await guest.context().close();
  });

  test("SPEC 8.1: PNG et WebP sont acceptés et ressortent en images propres", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [
        { name: "a.png", buffer: fixture("png-photo.png"), mimeType: "image/png" },
        { name: "b.webp", buffer: fixture("webp-photo.webp"), mimeType: "image/webp" },
      ],
      { sent: 2 },
    );
    const rows = await mediaOf(id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "ready", width: 96, height: 64 });
      expect(row.blurhash).toMatch(BLURHASH_PATTERN);
      const display = await expectCleanPreview(row.key_display ?? "", { width: 96, height: 64 });
      await expectUprightQuarters(display);
    }
    await guest.context().close();
  });

  test("SPEC 8.1: HEIC est lu (par le navigateur ou par le décodeur chargé à la demande), sans position ensuite", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [
        { name: "IMG_1.HEIC", buffer: fixture("photo.heic"), mimeType: "image/heic" },
        { name: "IMG_2.heic", buffer: fixture("photo-gps.heic"), mimeType: "image/heic" },
      ],
      { sent: 2 },
    );
    const rows = await mediaOf(id);
    const sizes = rows.map((row) => `${row.width}x${row.height}`).sort();
    expect(sizes).toEqual(["128x96", "96x64"]);
    for (const row of rows) {
      const size = { width: row.width ?? 0, height: row.height ?? 0 };
      const display = await expectCleanPreview(row.key_display ?? "", size);
      await expectCleanPreview(row.key_thumb ?? "", size);
      await expectUprightQuarters(display);
    }
    await guest.context().close();
  });

  test("SPEC 8.1: le décodeur HEIC n'est pas téléchargé pour un JPEG", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    const scripts: string[] = [];
    guest.on("response", async (response) => {
      if (!response.url().includes("/_next/static/") || !response.url().endsWith(".js")) return;
      const body = await response.body().catch(() => null);
      if (body && body.includes("HeifDecoder")) scripts.push(response.url());
    });
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [
      { name: "IMG.jpg", buffer: fixture("jpeg-plain.jpg"), mimeType: "image/jpeg" },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 60_000 });
    expect(scripts).toEqual([]);
    await guest.context().close();
  });

  test("F-036: la miniature locale de chaque photo s'affiche dans la liste", async ({
    page,
    browser,
  }) => {
    const { guest } = await sendAsGuest(
      page,
      browser,
      [
        { name: "a.jpg", buffer: fixture("jpeg-gps.jpg"), mimeType: "image/jpeg" },
        { name: "b.png", buffer: fixture("png-photo.png"), mimeType: "image/png" },
      ],
      { sent: 2 },
    );
    const previews = guest.getByTestId("upload-preview");
    await expect(previews).toHaveCount(2);
    for (const preview of await previews.all()) {
      await expect(preview).toBeVisible();
      expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(
        0,
      );
    }
    await guest.context().close();
  });

  test("SPEC 8.1, S-002: fichiers abîmés ou faux : refus ciblé, les bons fichiers partent", async ({
    page,
    browser,
  }) => {
    const { guest, id } = await sendAsGuest(
      page,
      browser,
      [
        { name: "ok.jpg", buffer: fixture("jpeg-plain.jpg"), mimeType: "image/jpeg" },
        { name: "abime.jpg", buffer: fixture("corrupted.jpg"), mimeType: "image/jpeg" },
        { name: "abime.png", buffer: fixture("corrupted.png"), mimeType: "image/png" },
        { name: "page.jpg", buffer: fixture("not-an-image.jpg"), mimeType: "image/jpeg" },
        { name: "abime.mp4", buffer: fixture("corrupted.mp4"), mimeType: "video/mp4" },
      ],
      { sent: 1, rejected: 4 },
    );
    expect(await mediaOf(id)).toHaveLength(1);
    // A web page renamed .jpg is recognised by its bytes, not by its name.
    await expect(
      guest.locator("li", { hasText: "page.jpg" }).getByText("Ce fichier semble abîmé."),
    ).toBeVisible();
    await guest.context().close();
  });
});

test.describe("vidéos : aperçu et durée selon l'offre", () => {
  /** Playwright's WebKit and Chromium builds differ in the codecs they carry: try the real clip. */
  async function canPlayWebm(page: Page): Promise<boolean> {
    return page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
      try {
        return await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 5000);
          video.onloadeddata = () => {
            clearTimeout(timer);
            resolve(video.videoWidth > 0);
          };
          video.onerror = () => {
            clearTimeout(timer);
            resolve(false);
          };
          video.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }, fixture("video-2s.webm").toString("base64"));
  }

  test("SPEC 8.2: une vidéo courte donne une image d'aperçu, sa durée, sa taille et un blurhash", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    await guest.goto(`/e/${code}`);
    test.skip(!(await canPlayWebm(guest)), "ce navigateur de test ne lit pas le WebM");
    await chooseFromGallery(guest, [
      { name: "clip.webm", buffer: fixture("video-2s.webm"), mimeType: "video/webm" },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 60_000 });
    const [media] = await mediaOf(id);
    expect(media).toMatchObject({ kind: "video", status: "ready", width: 160, height: 120 });
    expect(media?.duration_s).toBeGreaterThan(1.5);
    expect(media?.duration_s).toBeLessThan(2.6);
    expect(media?.blurhash).toMatch(BLURHASH_PATTERN);
    // The video itself is kept as it is; its still frame is a clean image.
    expect(media?.key_original).toMatch(/\.webm$/);
    await expectCleanPreview(media?.key_thumb ?? "", { width: 160, height: 120 });
    await guest.context().close();
  });

  test("SPEC 8.2: une vidéo de 45 s est refusée avant tout envoi sur l'offre gratuite (30 s), avec la durée maximale", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    await guest.goto(`/e/${code}`);
    test.skip(!(await canPlayWebm(guest)), "ce navigateur de test ne lit pas le WebM");
    let reservations = 0;
    // A first attempt before the guest has joined is answered 401 and not counted.
    guest.on("response", (response) => {
      if (response.url().includes("/api/uploads/reserve") && response.ok()) reservations += 1;
    });
    await chooseFromGallery(guest, [
      { name: "long.webm", buffer: fixture("video-45s.webm"), mimeType: "video/webm" },
      { name: "ok.jpg", buffer: fixture("jpeg-plain.jpg"), mimeType: "image/jpeg" },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='rejected']")).toHaveCount(1, { timeout: 60_000 });
    await expect(
      guest.getByText("Cette vidéo est trop longue : 30 secondes au maximum."),
    ).toBeVisible();
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1);
    // Only the photo reached the server.
    expect(reservations).toBe(1);
    expect(await mediaOf(id)).toHaveLength(1);
    await guest.context().close();
  });

  test("SPEC 8.2: la même vidéo de 45 s passe sur une offre payante (180 s)", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setEventColumns(id, { plan: "event" });
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    await guest.goto(`/e/${code}`);
    test.skip(!(await canPlayWebm(guest)), "ce navigateur de test ne lit pas le WebM");
    await chooseFromGallery(guest, [
      { name: "long.webm", buffer: fixture("video-45s.webm"), mimeType: "video/webm" },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 60_000 });
    const [media] = await mediaOf(id);
    expect(media?.duration_s).toBeGreaterThan(40);
    await guest.context().close();
  });
});
