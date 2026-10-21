import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows } from "./admin";
import { expect, newVisitor, test } from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * Reliable queue (NF-010, NF-011, NF-023): files survive a closed or reloaded page and are sent
 * when the guest comes back; a browser built into another app is recognised.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const BUCKET = "snapalbum-e2e";

test.beforeAll(async () => {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
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

/** Playwright's WebKit on Windows has no usable IndexedDB: those runs skip what needs it. */
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

test.describe("file d'attente fiable", () => {
  test("NF-010, NF-011: des photos qui n'ont pas pu partir survivent au rechargement de la page et partent au retour, sans doublon", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    test.skip(!(await indexedDbWorks(guest)), "IndexedDB indisponible dans ce navigateur de test");
    // The guest joins with a first photo, so the session exists when the connection fails.
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });

    // The server cannot be reached: three photos are chosen and cannot be sent.
    await guest.route("**/api/uploads/**", (route) => route.abort("connectionfailed"));
    await chooseFromGallery(guest, [
      { name: "IMG_0002.png", buffer: samplePhoto(2) },
      { name: "IMG_0003.png", buffer: samplePhoto(3) },
      { name: "IMG_0004.png", buffer: samplePhoto(4) },
    ]);
    await expect(guest.locator("li[data-status='failed']")).toHaveCount(3, { timeout: 30_000 });
    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(1);

    // The page is closed and opened again (the connection is back): nothing was lost.
    await guest.unroute("**/api/uploads/**");
    await guest.reload();
    await expect(guest.getByText("Reprise de 3 envois laissés en cours.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(3, { timeout: 30_000 });
    await expect(guest.getByText("Tout est envoyé, merci !")).toBeVisible();
    expect(await getRows("media", `event_id=eq.${id}&select=status`)).toHaveLength(4);

    // Everything confirmed: nothing is left to resume at the next visit.
    await guest.reload();
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByText(/Reprise de/)).toHaveCount(0);
    await expect(guest.locator("li")).toHaveCount(0);
    await guest.context().close();
  });

  test("NF-010: sans stockage local utilisable, la photo part quand même et l'invité est prévenu de garder la page ouverte", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.addInitScript(() => {
      indexedDB.open = () => {
        throw new Error("blocked");
      };
    });
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await expect(guest.getByText(/Impossible de garder une copie de sauvegarde/)).toBeVisible();
    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(1);
    await guest.context().close();
  });

  test("NF-011: au retour sur la page (visibilitychange), les envois en attente repartent", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });

    await guest.route("**/api/uploads/**", (route) => route.abort("connectionfailed"));
    await chooseFromGallery(guest, [{ name: "IMG_0002.png", buffer: samplePhoto(2) }]);
    await expect(guest.locator("li[data-status='failed']")).toHaveCount(1, { timeout: 30_000 });
    await guest.unroute("**/api/uploads/**");

    // The tab comes back to the front: no waiting for the next delay.
    await guest.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2, { timeout: 30_000 });
    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(2);
    await guest.context().close();
  });
});

test.describe("navigateurs intégrés aux applis (NF-023)", () => {
  const INSTAGRAM_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.30.109 (iPhone15,2; iOS 17_5; fr_FR)";
  const FACEBOOK_ANDROID =
    "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0]";

  test("NF-023: dans Instagram, un message invite à ouvrir le lien dans le navigateur, avec un bouton pour le copier", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser, { userAgent: INSTAGRAM_IOS });
    await guest.goto(`/e/${code}`);
    await expect(
      guest.getByRole("heading", { name: "Ouvrez ce lien dans votre navigateur" }),
    ).toBeVisible();
    await expect(guest.getByRole("button", { name: "Copier le lien" })).toBeVisible();
    // No Android intent on iOS; the upload buttons are still there (a suggestion, not a block).
    await expect(guest.getByRole("link", { name: "Ouvrir dans le navigateur" })).toHaveCount(0);
    await expect(guest.getByTestId("gallery-input")).toBeAttached();
    await guest.context().close();
  });

  test("NF-023: sur Android, le message propose d'ouvrir directement Chrome", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser, { userAgent: FACEBOOK_ANDROID });
    await guest.goto(`/e/${code}`);
    const open = guest.getByRole("link", { name: "Ouvrir dans le navigateur" });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute(
      "href",
      new RegExp(`^intent://.*/e/${code}#Intent;scheme=http`),
    );
    await guest.context().close();
  });

  test("NF-023: un navigateur ordinaire ne voit aucun message", async ({ page, browser }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByText("Ouvrez ce lien dans votre navigateur")).toHaveCount(0);
    await guest.context().close();
  });
});
