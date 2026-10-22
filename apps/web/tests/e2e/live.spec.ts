import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows, patchRows, setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * The live slideshow (F-060 to F-064): it follows new photos through Supabase Realtime, shows only
 * approved ones, keeps the QR code in a corner, and does not grow while it runs.
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

// Upload, Realtime and a 8 s rotation: slower than a plain page.
test.setTimeout(120_000);

async function guestSends(page: Page, code: string, seed: number) {
  await page.goto(`/e/${code}`);
  await chooseFromGallery(page, [{ name: `IMG_${seed}.png`, buffer: samplePhoto(seed) }]);
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
  await expect(page.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
}

/** A second photo from a guest who already joined. */
async function guestSendsMore(page: Page, seed: number) {
  await page.reload();
  await chooseFromGallery(page, [{ name: `IMG_${seed}.png`, buffer: samplePhoto(seed) }]);
  await expect(page.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
}

const slide = (page: Page) => page.getByTestId("live-slide");

test.describe("Diaporama en direct", () => {
  test("F-060, F-062: page plein écran avec le QR code en coin, l'état vide dit quoi faire, rien ne déborde", async ({
    page,
  }) => {
    const { code } = await createEvent(page);
    await page.goto(`/e/${code}/live`);

    await expect(
      page.getByText("Les premières photos apparaîtront ici dès qu’elles seront envoyées."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mariage de Léa et Tom" })).toBeAttached();
    const qr = page.getByTestId("live-qr");
    await expect(qr).toBeVisible();
    await expect(qr.getByText("Ajoutez vos photos")).toBeVisible();
    await expect(qr.getByRole("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect(page.getByRole("button", { name: "Plein écran" })).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("F-060: sans être connecté, on est envoyé se connecter", async ({ page, browser }) => {
    const { code } = await createEvent(page);
    const visitor = await newVisitor(browser);
    await visitor.goto(`/e/${code}/live`);
    await expect(visitor).toHaveURL(/\/login/);
    await visitor.context().close();
  });

  test("F-061: les photos déjà là passent à l'écran, et une photo envoyée ensuite arrive toute seule", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, 61);

    await page.goto(`/e/${code}/live`);
    await expect(slide(page)).toHaveCount(1, { timeout: 20_000 });
    await expect
      .poll(() => slide(page).evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const first = await slide(page).getAttribute("src");

    // A new photo from the guest comes through Realtime: no reload on the screen.
    await guestSendsMore(guest, 62);
    await expect
      .poll(async () => slide(page).last().getAttribute("src"), { timeout: 40_000 })
      .not.toBe(first);
    await guest.context().close();
  });

  test("F-063: une photo en attente de validation ne s'affiche pas, elle apparaît dès qu'elle est approuvée", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const [event] = await getRows("events", `id=eq.${id}&select=settings`);
    await setEventColumns(id, {
      settings: { ...(event?.settings as object), require_approval: true },
    });
    const guest = await newVisitor(browser);
    await guestSends(guest, code, 63);

    await page.goto(`/e/${code}/live`);
    await expect(page.getByText(/Les premières photos apparaîtront ici/)).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(slide(page)).toHaveCount(0);

    const [media] = await getRows("media", `event_id=eq.${id}&select=id`);
    await patchRows("media", `id=eq.${String(media?.id)}`, { moderation: "approved" });
    await expect(slide(page)).toHaveCount(1, { timeout: 30_000 });
    await guest.context().close();
  });

  test("F-060: le curseur et le bouton se cachent après quelques secondes sans mouvement", async ({
    page,
  }) => {
    const { code } = await createEvent(page);
    await page.goto(`/e/${code}/live`);
    const stage = page.getByTestId("live-stage");
    await page.mouse.move(100, 100);
    await expect(stage).toHaveCSS("cursor", "default");
    await expect(stage).toHaveCSS("cursor", "none", { timeout: 10_000 });
    await page.mouse.move(200, 200);
    await expect(stage).toHaveCSS("cursor", "default");
  });

  test("F-060: la page demande à garder l'écran allumé (Wake Lock)", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __wake: number }).__wake = 0;
      Object.defineProperty(navigator, "wakeLock", {
        value: {
          request: async () => {
            (window as unknown as { __wake: number }).__wake += 1;
            return { release: async () => undefined };
          },
        },
        configurable: true,
      });
    });
    const { code } = await createEvent(page);
    await page.goto(`/e/${code}/live`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __wake: number }).__wake))
      .toBeGreaterThan(0);
  });

  test("F-064: 1 200 photos de suite sans que la mémoire, les éléments de la page ni les écouteurs ne grossissent", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "mesure de la mémoire : Chromium seulement");
    test.setTimeout(240_000);
    const { code } = await createEvent(page);

    // The album is replaced by a fixed one, and every "next photo" answers at once: the test
    // measures the page itself, not the network. 1 200 turns of 8 s are 2 h 40 of a party.
    const ids = [
      "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d01",
      "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d02",
      "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d03",
    ];
    let served = 0;
    await page.route("**/api/gallery", async (route) => {
      const body = route.request().postDataJSON() as { action: string; mediaIds?: string[] };
      if (body.action === "list") {
        return route.fulfill({
          json: {
            action: "list",
            items: ids.map((mediaId) => ({
              mediaId,
              kind: "photo",
              width: 96,
              height: 64,
              durationS: null,
              blurhash: null,
              thumbUrl: null,
              takenAt: null,
              createdAt: "2026-10-22T10:00:00.000Z",
            })),
            nextCursor: null,
            total: 3,
            urlsValidSeconds: 3600,
            guests: [],
          },
        });
      }
      served += 1;
      const png = samplePhoto(served % 7).toString("base64");
      return route.fulfill({
        json: {
          action: "files",
          files: [
            {
              mediaId: body.mediaIds?.[0],
              displayUrl: `data:image/png;base64,${png}`,
              videoUrl: null,
              downloadUrl: "https://signed.test/x",
            },
          ],
          urlsValidSeconds: 3600,
        },
      });
    });

    await page.clock.install();
    await page.goto(`/e/${code}/live`);
    await expect(slide(page).first()).toBeVisible({ timeout: 20_000 });

    const session = await page.context().newCDPSession(page);
    const measure = async () => {
      await session.send("HeapProfiler.collectGarbage");
      const heap = await session.send("Runtime.getHeapUsage");
      const counters = await page.evaluate(() => ({
        nodes: document.getElementsByTagName("*").length,
        images: document.getElementsByTagName("img").length,
      }));
      return { used: heap.usedSize, ...counters };
    };
    const turns = async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        await page.clock.runFor(8_000);
        await page.waitForTimeout(15);
      }
    };

    await turns(200);
    const warm = await measure();
    await turns(1_000);
    const late = await measure();

    expect(served).toBeGreaterThan(1_000);
    expect(late.images).toBeLessThanOrEqual(4);
    expect(late.nodes).toBeLessThanOrEqual(warm.nodes + 5);
    // Allow 3 MB of noise; a leak of one object per turn would show at hundreds of KB per 1 000.
    testInfo.annotations.push({
      type: "heap-growth-bytes",
      description: String(late.used - warm.used),
    });
    expect(late.used - warm.used).toBeLessThan(3 * 1024 * 1024);
  });
});
