import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows, setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  signIn,
  test,
} from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/**
 * Moderation (F-070 to F-073): validation, hiding, deleting, blocking and reports, from the
 * organiser's page and from the guests' side, against the real database and storage.
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

// Upload, join and several organiser steps per test: slow phone profiles need more than 30 s.
test.setTimeout(120_000);

async function guestSends(page: Page, code: string, seeds: number[], name?: string) {
  await page.goto(`/e/${code}`);
  await chooseFromGallery(
    page,
    seeds.map((seed) => ({ name: `IMG_${seed}.png`, buffer: samplePhoto(seed) })),
  );
  if (name) await page.getByLabel("Votre prénom (facultatif)").fill(name);
  await page.getByLabel(/J’accepte que mes photos/).check();
  await page.getByRole("button", { name: "Participer" }).click();
  await expect(page.locator("li[data-status='sent']")).toHaveCount(seeds.length, {
    timeout: 60_000,
  });
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const tiles = (page: Page) => page.getByTestId("moderation-tile");
const countOf = (page: Page, list: string) => page.getByTestId(`count-${list}`);
const gotoModeration = (page: Page, id: string) => page.goto(`/events/${id}/moderation`);

async function requireApproval(id: string) {
  const [event] = await getRows("events", `id=eq.${id}&select=settings`);
  await setEventColumns(id, {
    settings: { ...(event?.settings as object), require_approval: true },
  });
}

async function selectAll(page: Page) {
  await page.getByRole("button", { name: "Tout sélectionner" }).click();
}

test.describe("Validation préalable", () => {
  test("F-071: les photos en attente n'apparaissent pas dans l'album, la liste « À valider » s'ouvre en premier et approuver les rend visibles", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await requireApproval(id);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [71, 72]);

    // Not in the album yet.
    await guest.getByTestId("tab-gallery").click();
    await expect(guest.getByText("Il n’y a pas encore de photo.")).toBeVisible();

    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("attention-pending")).toHaveText("2 photos à valider.");
    await page.getByTestId("open-moderation").click();
    await expect(page.getByTestId("filter-pending")).toHaveAttribute("aria-selected", "true");
    await expect(tiles(page)).toHaveCount(2);
    await expect(countOf(page, "pending")).toHaveText("2");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await tiles(page).first().getByRole("checkbox").check();
    await page.getByTestId("action-approve").click();
    await expect(page.getByText("1 photo mise à jour.")).toBeVisible();
    await expect(tiles(page)).toHaveCount(1);
    await expect(countOf(page, "pending")).toHaveText("1");
    await expect(countOf(page, "visible")).toHaveText("1");

    await guest.reload();
    await guest.getByTestId("tab-gallery").click();
    await expect(guest.getByTestId("gallery-tile")).toHaveCount(1);
    await guest.context().close();
  });

  test("F-071: la validation une par une se fait au clavier : A approuve, R refuse", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await requireApproval(id);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [73, 74]);

    await gotoModeration(page, id);
    await page.getByTestId("open-review").click();
    const review = page.getByTestId("review-mode");
    await expect(review).toBeVisible();
    await expect(review.getByText("1 sur 2")).toBeVisible();
    await expect
      .poll(() =>
        review
          .getByTestId("review-photo")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    await page.keyboard.press("a");
    await expect(review.getByText("1 sur 1")).toBeVisible();
    await page.keyboard.press("r");
    await expect(review.getByText("Tout est validé.").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();

    const rows = await getRows("media", `event_id=eq.${id}&select=moderation&order=created_at.asc`);
    expect(rows.map((row) => row.moderation).sort()).toEqual(["approved", "rejected"]);
    await expect(countOf(page, "refused")).toHaveText("1");
    await expect(countOf(page, "visible")).toHaveText("1");
    await guest.context().close();
  });
});

test.describe("Masquer, rétablir, supprimer", () => {
  test("F-070: masquer retire de l'album, rétablir remet, supprimer demande confirmation puis efface fichiers et place", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [75, 76, 77]);
    const files = await getRows("media", `event_id=eq.${id}&select=key_thumb,key_display`);

    await gotoModeration(page, id);
    await expect(page.getByTestId("filter-visible")).toHaveAttribute("aria-selected", "true");
    await expect(tiles(page)).toHaveCount(3);

    // Hide the three at once.
    await selectAll(page);
    await expect(page.getByText("3 photos sélectionnées")).toBeVisible();
    await page.getByTestId("action-hide").click();
    await expect(page.getByText("3 photos mises à jour.")).toBeVisible();
    await expect(countOf(page, "hidden")).toHaveText("3");
    await expect(countOf(page, "visible")).toHaveText("0");

    // The guest's album no longer shows them.
    await guest.getByTestId("tab-gallery").click();
    await expect(guest.getByText("Il n’y a pas encore de photo.")).toBeVisible();

    // Restore one.
    await page.getByTestId("filter-hidden").click();
    await expect(tiles(page)).toHaveCount(3);
    await tiles(page).first().getByRole("checkbox").check();
    await page.getByTestId("action-restore").click();
    await expect(countOf(page, "visible")).toHaveText("1");

    // Delete the two others: "keep" first, then for good.
    await selectAll(page);
    await page.getByTestId("action-delete").click();
    await expect(page.getByText(/Supprimer définitivement ces 2 photos/)).toBeVisible();
    await page.getByRole("button", { name: "Non, garder" }).click();
    // "Keep" leaves the selection as it was.
    await expect(page.getByText("2 photos sélectionnées")).toBeVisible();
    await page.getByTestId("action-delete").click();
    await page.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByText("2 photos mises à jour.")).toBeVisible();
    await expect(countOf(page, "hidden")).toHaveText("0");

    const rows = await getRows("media", `event_id=eq.${id}&select=status,key_thumb,key_display`);
    expect(rows.filter((row) => row.status === "deleted")).toHaveLength(2);
    expect(rows.filter((row) => row.status === "ready")).toHaveLength(1);
    const gone = rows.find((row) => row.status === "deleted")!;
    expect(await exists(String(gone.key_thumb))).toBe(false);
    expect(await exists(String(gone.key_display))).toBe(false);
    const kept = rows.find((row) => row.status === "ready")!;
    expect(await exists(String(kept.key_thumb))).toBe(true);
    expect(files).toHaveLength(3);
    const [event] = await getRows("events", `id=eq.${id}&select=media_count`);
    expect(event?.media_count).toBe(1);
    const log = await getRows("audit_log", `target_id=eq.${id}&select=action&order=created_at.asc`);
    expect(log.map((row) => row.action)).toEqual(["media.hide", "media.delete"]);
    await guest.context().close();
  });
});

test.describe("Blocage d'un invité", () => {
  test("F-072: un invité bloqué ne peut plus envoyer, débloqué il le peut de nouveau", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guestSends(guest, code, [78], "Anna");

    await gotoModeration(page, id);
    const panel = page.getByTestId("guests-panel");
    await expect(panel.getByText("Anna")).toBeVisible();
    await panel.getByRole("button", { name: /Bloquer — Anna/ }).click();
    await expect(page.getByText("Anna ne peut plus envoyer de photos.")).toBeVisible();
    await expect(panel.getByText("Bloqué", { exact: true })).toBeVisible();

    // A new upload is refused for good, not retried.
    await chooseFromGallery(guest, [{ name: "IMG_79.png", buffer: samplePhoto(79) }]);
    await expect(guest.locator("li[data-status='rejected']")).toHaveCount(1, { timeout: 30_000 });

    await panel.getByRole("button", { name: /Débloquer — Anna/ }).click();
    await expect(page.getByText("Anna peut de nouveau envoyer des photos.")).toBeVisible();
    const [row] = await getRows("guests", `event_id=eq.${id}&select=blocked_at`);
    expect(row?.blocked_at).toBeNull();
    await guest.context().close();
  });
});

test.describe("Signalements", () => {
  test("F-073: un invité signale une photo depuis la visionneuse, l'organisateur la voit, l'ignore ou la masque", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const author = await newVisitor(browser);
    await guestSends(author, code, [80]);
    const viewer = await newVisitor(browser);
    await viewer.goto(`/e/${code}`);
    await viewer.waitForLoadState("networkidle");
    await viewer.getByTestId("tab-gallery").click();
    await viewer.getByLabel(/J’accepte que mes photos/).check();
    await viewer.getByRole("button", { name: "Participer" }).click();
    await expect(viewer.getByTestId("gallery-tile")).toHaveCount(1);
    await viewer.getByTestId("gallery-tile").first().click();
    await viewer.getByTestId("viewer-report").click();
    await expectNoAccessibilityViolations(viewer);
    await viewer.getByRole("button", { name: "Contenu inapproprié" }).click();
    await expect(viewer.getByText("Merci, l’organisateur a été prévenu.")).toBeVisible();
    // Reporting twice is accepted and counted once.
    await viewer.getByTestId("viewer-report").click();
    await viewer.getByRole("button", { name: "Autre" }).click();

    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("attention-reported")).toHaveText("1 photo signalée.");
    await gotoModeration(page, id);
    await expect(page.getByTestId("filter-reported")).toHaveAttribute("aria-selected", "true");
    await expect(tiles(page)).toHaveCount(1);
    await expect(tiles(page).getByText("1 signalement")).toBeVisible();

    await selectAll(page);
    await page.getByTestId("action-dismiss").click();
    await expect(countOf(page, "reported")).toHaveText("0");
    await expect(countOf(page, "visible")).toHaveText("1");
    const reports = await getRows("reports", "select=resolved_at");
    expect(reports.some((row) => row.resolved_at !== null)).toBe(true);
    await author.context().close();
    await viewer.context().close();
  });

  test("F-073: le titulaire d'un lien de partage peut aussi signaler, sans compte", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    const author = await newVisitor(browser);
    await guestSends(author, code, [81]);
    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "Créer un lien de partage" }).click();
    const link = new URL(await page.getByLabel("Lien de partage").inputValue());

    const visitor = await newVisitor(browser);
    await visitor.goto(link.pathname);
    await visitor.getByTestId("gallery-tile").first().click();
    await visitor.getByTestId("viewer-report").click();
    await visitor.getByRole("button", { name: "Atteinte à la vie privée" }).click();
    await expect(visitor.getByText("Merci, l’organisateur a été prévenu.")).toBeVisible();

    await gotoModeration(page, id);
    await expect(countOf(page, "reported")).toHaveText("1");
    await author.context().close();
    await visitor.context().close();
  });
});

test.describe("Accès", () => {
  test("S-001: la page de modération d'un autre organisateur est introuvable, sans connexion on est envoyé se connecter", async ({
    page,
    browser,
  }) => {
    const { id } = await createEvent(page);
    const stranger = await newVisitor(browser);
    await stranger.goto(`/events/${id}/moderation`);
    await expect(stranger).toHaveURL(/\/login/);
    await signIn(stranger);
    await stranger.goto(`/events/${id}/moderation`);
    await expect(stranger.getByText("Cette page est introuvable")).toBeVisible();
    await stranger.context().close();
  });

  test("S-001, NF-043: l'API de signalement refuse l'absence de session et un corps invalide", async ({
    request,
  }) => {
    const call = (data: unknown) => request.post("/api/gallery/report", { data });
    const access = { type: "event", eventCode: "k7m2x9qvbr" };
    const mediaId = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
    expect((await call({ access, mediaId, reason: "other" })).status()).toBe(401);
    expect((await call({ access, mediaId, reason: "spam" })).status()).toBe(400);
    const unknown = await call({
      access: { type: "share", token: "z".repeat(32) },
      mediaId,
      reason: "other",
    });
    expect(unknown.status()).toBe(404);
  });
});
