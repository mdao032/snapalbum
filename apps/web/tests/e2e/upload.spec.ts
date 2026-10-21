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

// The app talks to the emulator through a small CORS proxy (`storage-cors-proxy.mjs`); buckets are
// created on the emulator itself.
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
    // Without the emulator these tests cannot run: fail loudly in CI, skip on a bare machine.
    if (process.env.CI) throw error;
    test.skip(true, "S3 emulator not running (pnpm storage:start)");
  }
});

async function join(page: Page) {
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
}

test.describe("envoi de photos par un invité", () => {
  test("F-030, F-031, F-032, F-035, F-036, F-037: l'invité choisit des photos, rejoint, voit la progression et tout arrive", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);

    // F-030: both entry points are there, big enough for a thumb.
    for (const name of ["Prendre une photo", "Choisir dans la galerie"]) {
      const label = guest.locator("label", { hasText: name });
      await expect(label).toBeVisible();
      expect((await label.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(guest.getByTestId("camera-input")).toHaveAttribute("capture", "environment");
    await expect(guest.getByTestId("gallery-input")).toHaveAttribute("multiple", "");

    // F-035: the join step appears with the first choice, and sending resumes once joined.
    await chooseFromGallery(guest, [
      { name: "IMG_0001.png", buffer: samplePhoto(1) },
      { name: "IMG_0002.png", buffer: samplePhoto(2) },
    ]);
    await expect(guest.getByRole("heading", { name: "Participez à l’album" })).toBeVisible();
    await join(guest);

    await expect(guest.getByText("Tout est envoyé, merci !")).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText("2 sur 2 envoyées").first()).toBeVisible();
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2);

    const media = await getRows("media", `event_id=eq.${id}&select=status,kind`);
    expect(media).toHaveLength(2);
    expect(media.every((row) => row.status === "ready" && row.kind === "photo")).toBe(true);
    await guest.context().close();
  });

  test("F-031: un fichier abîmé ou d'un format inconnu est refusé avec une explication, les autres partent", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [
      { name: "ok.png", buffer: samplePhoto(3) },
      { name: "abime.png", buffer: Buffer.from("pas une image") },
      { name: "notes.pdf", buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" },
    ]);
    await join(guest);

    await expect(guest.locator("li[data-status='sent']")).toHaveCount(1, { timeout: 30_000 });
    await expect(guest.locator("li[data-status='rejected']")).toHaveCount(2);
    await expect(guest.getByText("Ce fichier semble abîmé.")).toBeVisible();
    await expect(
      guest.getByText("Ce format n’est pas pris en charge sur cet appareil."),
    ).toBeVisible();
    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(1);
    await guest.context().close();
  });

  test("R1: album plein : le fichier attend de la place, l'invité en est informé et rien n'est perdu", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await setEventColumns(id, { media_count: 200 });
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0009.png", buffer: samplePhoto(9) }]);
    await join(guest);

    await expect(guest.locator("li[data-status='waiting_quota']")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(guest.getByText("L’album est plein pour le moment.")).toBeVisible();
    await expect(guest.getByText(/Gardez cette page ouverte/).first()).toBeVisible();
    await guest.context().close();
  });

  test("F-037: l'invité est prévenu quand la connexion tombe, puis l'envoi continue au retour", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0010.png", buffer: samplePhoto(10) }]);
    await join(guest);
    await expect(guest.getByText("Tout est envoyé, merci !")).toBeVisible({ timeout: 30_000 });

    await guest.context().setOffline(true);
    await expect(guest.getByText(/Pas de connexion/)).toBeVisible();
    await guest.context().setOffline(false);
    await expect(guest.getByText(/Pas de connexion/)).toHaveCount(0);

    await chooseFromGallery(guest, [{ name: "IMG_0011.png", buffer: samplePhoto(11) }]);
    await expect(guest.locator("li[data-status='sent']")).toHaveCount(2, { timeout: 30_000 });
    expect(await getRows("media", `event_id=eq.${id}&select=id`)).toHaveLength(2);
    await guest.context().close();
  });
});
