import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getRows, setEventColumns } from "./admin";
import { expect, newVisitor, test } from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * Phase 2 quality gate, end to end: a mixed batch, a network cut in the middle of 30 photos, the
 * same file twice, a full album. Everything is checked in the database AND in the storage.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const BUCKET = "snapalbum-e2e";
const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" },
});

test.beforeAll(async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
    if (process.env.CI) throw error;
    test.skip(true, "S3 emulator not running (pnpm storage:start)");
  }
});

async function join(page: Page) {
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Playwright's WebKit on Windows has no usable IndexedDB: runs that need it skip there. */
async function indexedDbWorks(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        try {
          const request = indexedDB.open("snapalbum-probe", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("files");
          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const transaction = request.result.transaction("files", "readwrite");
            transaction.objectStore("files").put(new File(["x"], "a.png"), "a");
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
            transaction.onabort = () => resolve(false);
          };
        } catch {
          resolve(false);
        }
      }),
  );
}

async function canDecodeWebm(page: Page): Promise<boolean> {
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

async function jpegOf(seed: number): Promise<Buffer> {
  return sharp(samplePhoto(seed)).jpeg({ quality: 80 }).toBuffer();
}

test.describe("phase 2 : envois de bout en bout", () => {
  test("SPEC 8.1: 20 photos mixtes (HEIC, JPEG, PNG) et 2 vidéos arrivent, en base et dans le stockage", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser, { timezoneId: "Europe/Paris" });
    await guest.goto(`/e/${code}`);
    const withVideos = await canDecodeWebm(guest);

    const files: { name: string; buffer: Buffer; mimeType: string }[] = [];
    for (let seed = 1; seed <= 8; seed += 1) {
      files.push({ name: `IMG_${seed}.png`, buffer: samplePhoto(seed), mimeType: "image/png" });
    }
    for (let seed = 101; seed <= 108; seed += 1) {
      files.push({ name: `IMG_${seed}.jpg`, buffer: await jpegOf(seed), mimeType: "image/jpeg" });
    }
    files.push(
      { name: "IMG_a.jpg", buffer: fixture("jpeg-orientation-6.jpg"), mimeType: "image/jpeg" },
      { name: "IMG_b.jpg", buffer: fixture("jpeg-gps.jpg"), mimeType: "image/jpeg" },
      { name: "IMG_c.heic", buffer: fixture("photo.heic"), mimeType: "image/heic" },
      { name: "IMG_d.heic", buffer: fixture("photo-gps.heic"), mimeType: "image/heic" },
    );
    if (withVideos) {
      // Two different videos: the second one carries a few more bytes (another fingerprint).
      files.push(
        { name: "clip1.webm", buffer: fixture("video-2s.webm"), mimeType: "video/webm" },
        {
          name: "clip2.webm",
          buffer: Buffer.concat([fixture("video-2s.webm"), Buffer.from("0000")]),
          mimeType: "video/webm",
        },
      );
    }
    const photos = files.filter((file) => !file.mimeType.startsWith("video/")).length;
    const videos = files.length - photos;
    expect(photos).toBe(20);

    await chooseFromGallery(guest, files);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(files.length, {
      timeout: 120_000,
    });
    await expect(guest.locator("li[data-status='rejected']")).toHaveCount(0);

    const rows = await getRows(
      "media",
      `event_id=eq.${id}&select=kind,status,sha256,key_display,key_thumb,key_original`,
    );
    expect(rows).toHaveLength(files.length);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    expect(rows.filter((row) => row.kind === "photo")).toHaveLength(photos);
    expect(rows.filter((row) => row.kind === "video")).toHaveLength(videos);
    expect(new Set(rows.map((row) => row.sha256)).size).toBe(files.length);
    for (const row of rows) {
      for (const key of [row.key_display, row.key_thumb, row.key_original]) {
        if (key) expect(await exists(String(key)), String(key)).toBe(true);
      }
    }
    const event = await getRows("events", `id=eq.${id}&select=media_count`);
    expect(event[0]?.media_count).toBe(files.length);
    await guest.context().close();
  });

  test("NF-010, NF-011: coupure du réseau au milieu de 30 photos, rechargement, retour du réseau : 30 photos reçues, aucun doublon", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    test.skip(!(await indexedDbWorks(guest)), "IndexedDB indisponible dans ce navigateur de test");

    const files = Array.from({ length: 30 }, (_, index) => ({
      name: `IMG_${String(index + 1).padStart(3, "0")}.png`,
      buffer: samplePhoto(200 + index),
    }));
    await chooseFromGallery(guest, files);
    await join(guest);
    // Some photos are through, then the connection drops in the middle of the batch.
    await expect
      .poll(() => guest.locator("li[data-status='sent']").count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(5);
    await guest.context().setOffline(true);
    await expect(guest.getByText(/Pas de connexion/)).toBeVisible();
    await guest.waitForTimeout(1500);
    const sentBefore = await guest.locator("li[data-status='sent']").count();
    expect(sentBefore).toBeLessThan(30);

    // Back online, the page is reloaded: what was left on the device resumes by itself.
    await guest.context().setOffline(false);
    await guest.reload();
    await guest.waitForLoadState("networkidle");
    await expect
      .poll(
        async () => (await getRows("media", `event_id=eq.${id}&status=eq.ready&select=id`)).length,
        {
          timeout: 90_000,
        },
      )
      .toBe(30);

    const rows = await getRows("media", `event_id=eq.${id}&select=sha256,status`);
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((row) => row.sha256)).size).toBe(30);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    await guest.context().close();
  });

  test("NF-012: le même fichier choisi deux fois, sous deux noms, ne crée qu'un seul média", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    const photo = samplePhoto(77);
    await chooseFromGallery(guest, [
      { name: "IMG_0001.png", buffer: photo },
      { name: "copie.png", buffer: photo },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2, { timeout: 30_000 });
    // Chosen again later, once more.
    await chooseFromGallery(guest, [{ name: "encore.png", buffer: photo }]);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(3, { timeout: 30_000 });

    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(1);
    const event = await getRows("events", `id=eq.${id}&select=media_count`);
    expect(event[0]?.media_count).toBe(1);
    await guest.context().close();
  });

  test("R1: album plein : le message est clair et le fichier reste sur l'appareil, puis part dès qu'une place se libère", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setEventColumns(id, { media_count: 200 });
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    const hasStorage = await indexedDbWorks(guest);
    await chooseFromGallery(guest, [{ name: "IMG_0009.png", buffer: samplePhoto(9) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(guest.getByText("L’album est plein pour le moment.")).toBeVisible();

    if (hasStorage) {
      // The page is reloaded: the photo is still on the device, still waiting for room.
      await guest.reload();
      await expect(guest.getByText("Reprise de 1 envoi laissé en cours.")).toBeVisible({
        timeout: 30_000,
      });
      await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(1, {
        timeout: 30_000,
      });
    }

    // The organiser's album grows (a paid plan): the same photo is sent without being chosen again.
    await setEventColumns(id, { media_count: 0 });
    await guest.getByRole("button", { name: "Réessayer maintenant" }).click();
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await guest.context().close();
  });

  test("R1, R2: l'organisateur passe en payant : les fichiers restés sur l'appareil partent tout seuls, avec leur original", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setEventColumns(id, { media_count: 200 });
    const guest = await newVisitor(browser);
    await guest.clock.install();
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [
      { name: "IMG_0021.png", buffer: samplePhoto(21) },
      { name: "IMG_0022.png", buffer: samplePhoto(22) },
      { name: "IMG_0023.png", buffer: samplePhoto(23) },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(3, {
      timeout: 30_000,
    });
    await expect(guest.getByText(/reprendra tout seul si l’organisateur l’agrandit/)).toHaveCount(
      3,
    );

    // Before the minute is over, nothing is asked again.
    await guest.clock.fastForward(30_000);
    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(3);

    // The organiser pays: nobody touches the guest's phone.
    await setEventColumns(id, { plan: "event", media_count: 0 });
    await guest.clock.fastForward(40_000);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(3, { timeout: 30_000 });
    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(0);

    // The photos sent after the upgrade keep their original (R2).
    const rows = await getRows("media", `event_id=eq.${id}&select=key_original,status`);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "ready" && row.key_original !== null)).toBe(true);
    await guest.context().close();
  });
});
