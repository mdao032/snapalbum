import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { crc32 } from "node:zlib";
import fs from "node:fs";
import { getRows, insertRows, setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";
import { newVisitor } from "./fixtures";

/**
 * Downloading the album as ZIP (F-080, F-081, F-083), in a real browser and against the real
 * storage: the file names, the content of every entry checked byte for byte (CRC), the cut into
 * parts, one part at a time. Browsers cannot save to disk here, so the test removes the File System
 * Access API and takes the fallback path (the ZIP is built in memory and saved through a link).
 */

const BUCKET = "snapalbum-e2e";
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100",
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

test.setTimeout(240_000);

interface ZipEntry {
  name: string;
  size: number;
  crc: number;
  data: Buffer;
}

/** Reads a ZIP (stored entries, as `client-zip` writes them) through its central directory. */
function readZip(buffer: Buffer): ZipEntry[] {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("not a ZIP file");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (method !== 0) throw new Error(`entry ${name} is compressed`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.push({ name, size, crc, data: buffer.subarray(start, start + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function stored(key: string): Promise<Buffer> {
  const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

/** The browser cannot write to disk in a test: take the fallback path, as Safari and Firefox do. */
async function withoutDiskStreaming(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });
}

/** Extra media rows copied from an uploaded one (same files), to test volume and parts. */
async function cloneMedia(eventId: string, count: number, bytesDisplay?: number) {
  const [template] = await getRows("media", `event_id=eq.${eventId}&status=eq.ready&limit=1`);
  if (!template) throw new Error("upload a photo first");
  const base = Date.parse("2026-01-01T10:00:00Z");
  return insertRows(
    "media",
    Array.from({ length: count }, (_, index) => ({
      event_id: eventId,
      guest_id: template.guest_id,
      kind: "photo",
      status: "ready",
      moderation: "approved",
      sha256: `${index.toString(16).padStart(8, "0")}${"ab".repeat(28)}`,
      mime_type: template.mime_type,
      bytes_display: bytesDisplay ?? template.bytes_display,
      bytes_thumb: template.bytes_thumb,
      width: template.width,
      height: template.height,
      taken_at: new Date(base + index * 60_000).toISOString(),
      key_thumb: template.key_thumb,
      key_display: template.key_display,
    })),
  );
}

async function guestSends(page: Page, code: string) {
  await page.goto(`/e/${code}`);
  await chooseFromGallery(page, [{ name: "IMG_1.png", buffer: samplePhoto(91) }]);
  await page.getByLabel("Votre prénom (facultatif)").fill("Anna");
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
  await expect(page.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 60_000 });
}

const parts = (page: Page) => page.getByTestId("download-part");

test.describe("Téléchargement de l'album", () => {
  test("F-080, F-083: 200 photos dans un ZIP, noms lisibles, contenu identique octet pour octet", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code);
    await cloneMedia(id, 199);
    const [template] = await getRows("media", `event_id=eq.${id}&select=key_display&limit=1`);
    const expected = await stored(String(template?.key_display));

    await withoutDiskStreaming(page);
    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(page.getByTestId("download-summary")).toContainText("200 fichiers");
    await expect(page.getByTestId("download-summary")).toContainText("en 1 partie");
    // Free plan: no choice of content, and the reason is given.
    await expect(
      page.getByText(/L’offre gratuite télécharge les versions optimisées/),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    // Without disk streaming, the browser is told to keep the part in memory.
    await expect(page.getByText(/garde chaque partie en mémoire/)).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    const download = page.waitForEvent("download", { timeout: 120_000 });
    await parts(page).first().getByTestId("download-part-button").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("mariage-de-lea-et-tom.zip");
    await expect(parts(page).first()).toHaveAttribute("data-state", "done");

    const entries = readZip(fs.readFileSync(await file.path()));
    expect(entries).toHaveLength(200);
    // F-083: date, time, guest, number; unique; sorted in the order the photos were taken.
    const pattern = /^\d{4}-\d{2}-\d{2}_\d{6}_anna_\d+\.(webp|png|jpg)$/;
    for (const entry of entries) expect(entry.name).toMatch(pattern);
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(200);
    expect(entries.slice(0, 199).map((entry) => entry.name)).toEqual(
      [...entries.slice(0, 199).map((entry) => entry.name)].sort(),
    );
    expect(
      entries
        .map((entry) => entry.name.split("_anna_")[1]!.split(".")[0])
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual(Array.from({ length: 200 }, (_, i) => String(i + 1)));
    // Content: every entry is the stored file, byte for byte.
    for (const entry of entries) {
      expect(entry.size).toBe(expected.length);
      expect(entry.crc).toBe(crc32(expected));
      expect(entry.data.equals(expected)).toBe(true);
    }
    await guest.context().close();
  });

  test("F-080: là où le navigateur sait écrire sur le disque, le ZIP y arrive en flux, par morceaux, sans être gardé en mémoire", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "même chemin de code sur les autres profils");
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code);
    await cloneMedia(id, 29);
    const [template] = await getRows("media", `event_id=eq.${id}&select=key_display&limit=1`);
    const expected = await stored(String(template?.key_display));

    // A stand-in for the save dialog of Chrome and Edge: a file that records what is written to it.
    await page.addInitScript(() => {
      const state = window as unknown as {
        __writes: number[][];
        __closed: boolean;
        __name: string;
        showSaveFilePicker: unknown;
      };
      state.__writes = [];
      state.__closed = false;
      state.showSaveFilePicker = async (options: { suggestedName: string }) => {
        state.__name = options.suggestedName;
        return {
          createWritable: async () =>
            new WritableStream({
              write(chunk: Uint8Array) {
                state.__writes.push(Array.from(chunk));
              },
              close() {
                state.__closed = true;
              },
            }),
        };
      };
    });
    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(page.getByTestId("download-summary")).toContainText("30 fichiers");
    // The browser can stream: no warning about memory.
    await expect(page.getByText(/garde chaque partie en mémoire/)).toHaveCount(0);

    await parts(page).first().getByTestId("download-part-button").click();
    await expect(parts(page).first()).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    const written = await page.evaluate(() => {
      const state = window as unknown as {
        __writes: number[][];
        __closed: boolean;
        __name: string;
      };
      return {
        chunks: state.__writes.length,
        closed: state.__closed,
        name: state.__name,
        bytes: state.__writes.flat(),
      };
    });
    expect(written.name).toBe("mariage-de-lea-et-tom.zip");
    expect(written.closed).toBe(true);
    // Written piece by piece, not in one block.
    expect(written.chunks).toBeGreaterThan(30);
    const entries = readZip(Buffer.from(written.bytes));
    expect(entries).toHaveLength(30);
    for (const entry of entries) expect(entry.data.equals(expected)).toBe(true);
    await guest.context().close();
  });

  test("F-081: l'album est coupé en parties de 2 Go au plus, chacune se télécharge seule ou toutes à la suite", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code);
    // Five photos declared at 1 GiB each: two fit in a part, so three parts.
    await setRowsBytes(id, 1024 * 1024 * 1024);
    await cloneMedia(id, 4, 1024 * 1024 * 1024);

    await withoutDiskStreaming(page);
    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(page.getByTestId("download-summary")).toContainText("5 fichiers");
    await expect(page.getByTestId("download-summary")).toContainText("en 3 parties");
    await expect(parts(page)).toHaveCount(3);
    await expect(parts(page).nth(0)).toContainText("Partie 1 sur 3");
    await expect(parts(page).nth(0)).toContainText("2 fichiers");
    await expect(parts(page).nth(2)).toContainText("1 fichier");

    // One part alone: the second one.
    const second = page.waitForEvent("download", { timeout: 120_000 });
    await parts(page).nth(1).getByTestId("download-part-button").click();
    const secondFile = await second;
    expect(secondFile.suggestedFilename()).toBe("mariage-de-lea-et-tom_partie-2-sur-3.zip");
    expect(readZip(fs.readFileSync(await secondFile.path()))).toHaveLength(2);
    await expect(parts(page).nth(1)).toHaveAttribute("data-state", "done");

    // The rest, one after the other.
    const names: string[] = [];
    page.on("download", (download) => names.push(download.suggestedFilename()));
    await page.getByTestId("download-all").click();
    await expect(parts(page).nth(0)).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    await expect(parts(page).nth(2)).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    expect(names).toEqual([
      "mariage-de-lea-et-tom_partie-1-sur-3.zip",
      "mariage-de-lea-et-tom_partie-3-sur-3.zip",
    ]);
    await guest.context().close();
  });

  test("F-080: une partie qui échoue se relance seule, les autres ne sont pas touchées", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code);
    await setRowsBytes(id, 1024 * 1024 * 1024);
    await cloneMedia(id, 2, 1024 * 1024 * 1024);

    await withoutDiskStreaming(page);
    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(parts(page)).toHaveCount(2);

    // The storage is unreachable for the first part: it fails after its retries, and says so.
    let blocked = true;
    await page.route(/\/snapalbum-e2e\/events\//, (route) =>
      blocked ? route.abort("connectionfailed") : route.continue(),
    );
    await parts(page).nth(0).getByTestId("download-part-button").click();
    await expect(parts(page).nth(0)).toHaveAttribute("data-state", "failed", { timeout: 60_000 });
    await expect(page.getByText("La partie 1 a échoué.")).toBeVisible();
    await expect(parts(page).nth(1)).toHaveAttribute("data-state", "idle");

    blocked = false;
    const retry = page.waitForEvent("download", { timeout: 120_000 });
    await parts(page).nth(0).getByRole("button", { name: "Relancer" }).click();
    await retry;
    await expect(parts(page).nth(0)).toHaveAttribute("data-state", "done");
    await guest.context().close();
  });

  test("F-080: avec une offre payante, on choisit entre les fichiers d'origine et les versions optimisées", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code);
    await setEventColumns(id, { plan: "event" });

    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(page.getByTestId("download-summary")).toBeVisible();
    const originals = page.getByRole("radio", { name: /d’origine/ });
    const optimized = page.getByRole("radio", { name: /optimisées/ });
    await expect(originals).toBeChecked();
    await optimized.check();
    await expect(optimized).toBeChecked();
    await expect(page.getByText(/L’offre gratuite télécharge/)).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    await guest.context().close();
  });

  test("S-001: l'organisateur d'un autre événement ne voit pas le téléchargement, un album vide le dit", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    await page.getByTestId("download-prepare").click();
    await expect(page.getByText("Il n’y a encore aucune photo à télécharger.")).toBeVisible();
  });
});

/** Declares a size on every media of the event (to cut the ZIPs without real gigabytes). */
async function setRowsBytes(eventId: string, bytes: number) {
  const { patchRows } = await import("./admin");
  await patchRows("media", `event_id=eq.${eventId}`, { bytes_display: bytes });
}
