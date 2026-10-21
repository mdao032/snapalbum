import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

/** "Mes photos" (F-038) and deletion of one's own media (G-005), against the real storage. */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const BUCKET = "snapalbum-e2e";
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

test.describe("Mes photos", () => {
  test("F-038, G-005: l'invité voit ses envois, en supprime un après confirmation, et la place est libérée", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    // The button only exists for a guest who has joined.
    await expect(guest.getByRole("button", { name: "Mes photos" })).toHaveCount(0);
    await chooseFromGallery(guest, [
      { name: "IMG_0001.png", buffer: samplePhoto(1) },
      { name: "IMG_0002.png", buffer: samplePhoto(2) },
    ]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2, { timeout: 30_000 });

    await guest.getByRole("button", { name: "Mes photos" }).click();
    const mine = guest.getByRole("region", { name: "Mes photos" });
    await expect(mine.getByRole("img")).toHaveCount(2);
    for (const image of await mine.getByRole("img").all()) {
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);

    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(2);

    // First click only asks; "Non, garder" cancels and nothing is deleted.
    await mine
      .getByRole("button", { name: /Supprimer cette photo/ })
      .first()
      .click();
    await expect(mine.getByText("Supprimer cette photo pour tout le monde ?")).toBeVisible();
    await mine.getByRole("button", { name: "Non, garder" }).click();
    await expect(mine.getByRole("img")).toHaveCount(2);

    await mine
      .getByRole("button", { name: /Supprimer cette photo/ })
      .first()
      .click();
    await mine.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(mine.getByText("Photo supprimée.")).toBeVisible();
    await expect(mine.getByRole("img")).toHaveCount(1);

    const after = await getRows("media", `event_id=eq.${id}&select=id,status,key_thumb`);
    expect(after.filter((row) => row.status === "deleted")).toHaveLength(1);
    const deleted = after.find((row) => row.status === "deleted");
    expect(await exists(String(deleted?.key_thumb))).toBe(false);
    const kept = after.find((row) => row.status === "ready");
    expect(await exists(String(kept?.key_thumb))).toBe(true);
    const event = await getRows("events", `id=eq.${id}&select=media_count`);
    expect(event[0]?.media_count).toBe(1);
    await guest.context().close();
  });

  test("F-038: un invité ne voit que ses photos, et sa liste vide a une phrase claire", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const alice = await newVisitor(browser);
    await alice.goto(`/e/${code}`);
    await chooseFromGallery(alice, [{ name: "IMG_0001.png", buffer: samplePhoto(11) }]);
    await join(alice);
    await expect(alice.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });

    const bob = await newVisitor(browser);
    await bob.goto(`/e/${code}`);
    await chooseFromGallery(bob, [{ name: "IMG_0002.png", buffer: samplePhoto(12) }]);
    await join(bob);
    await expect(bob.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await bob.getByRole("button", { name: "Mes photos" }).click();
    await expect(bob.getByRole("region", { name: "Mes photos" }).getByRole("img")).toHaveCount(1);

    await bob.getByRole("button", { name: /Supprimer cette photo/ }).click();
    await bob.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(bob.getByText("Vous n’avez pas encore envoyé de photo.")).toBeVisible();
    await alice.context().close();
    await bob.context().close();
  });

  test("G-005: une erreur de réseau à la suppression garde la photo et le dit", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(21) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await guest.getByRole("button", { name: "Mes photos" }).click();
    const mine = guest.getByRole("region", { name: "Mes photos" });
    await expect(mine.getByRole("img")).toHaveCount(1);

    await guest.route("**/api/uploads/mine", (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      return body.action === "delete" ? route.abort("connectionfailed") : route.continue();
    });
    await mine.getByRole("button", { name: /Supprimer cette photo/ }).click();
    await mine.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(mine.getByText("La suppression a échoué. Réessayez.")).toBeVisible();
    await expect(mine.getByRole("img")).toHaveCount(1);
    await guest.context().close();
  });

  test("R1: un album plein redevient accessible quand l'invité supprime une photo", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(31) }]);
    await join(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await setEventColumns(id, { media_count: 200 });

    await chooseFromGallery(guest, [{ name: "IMG_0002.png", buffer: samplePhoto(32) }]);
    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(1, {
      timeout: 30_000,
    });
    // Deleting the first photo frees one place (the counters are maintained by the database).
    await guest.getByRole("button", { name: "Mes photos" }).click();
    const mine = guest.getByRole("region", { name: "Mes photos" });
    await mine.getByRole("button", { name: /Supprimer cette photo/ }).click();
    await mine.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(mine.getByText("Photo supprimée.")).toBeVisible();
    await guest.getByRole("button", { name: "Réessayer maintenant" }).click();
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2, { timeout: 30_000 });
    await guest.context().close();
  });
});
