import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { getRows, patchRows } from "./admin";
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
 * Feedback (step 6.2): an organiser on their event page, a guest after sending a photo, and the
 * administrator who reads and handles it.
 */
test.setTimeout(120_000);

// The guest sends a photo to the local S3 emulator (`pnpm storage:start`).
test.beforeAll(async () => {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100",
    forcePathStyle: true,
    credentials: { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: "snapalbum-e2e" }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
    if (process.env.CI) throw error;
    test.skip(true, "S3 emulator not running (pnpm storage:start)");
  }
});

async function rate(page: Page, value: number) {
  await page.getByTestId("feedback-form").getByLabel(`${value} sur 5`).check({ force: true });
}

test.describe("6.2: avis", () => {
  test("6.2: l'organisateur donne son avis depuis la page de l'événement ; la note est obligatoire", async ({
    page,
  }) => {
    const { id, code } = await createEvent(page);
    const card = page.getByTestId("organiser-feedback");
    await card.scrollIntoViewIfNeeded();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    // The comment alone is not enough: the rating is the one required answer.
    await card.getByLabel("Qu’est-ce qui a bloqué, qu’est-ce qui vous a plu ?").fill("Ça va");
    await card.getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(card.getByText("Choisissez une note de 1 à 5.")).toBeVisible();
    expect(await getRows("feedback", `event_id=eq.${id}&select=id`)).toHaveLength(0);

    await rate(page, 5);
    await card.getByLabel("Qu’est-ce qui a bloqué, qu’est-ce qui vous a plu ?").fill("Très simple");
    await card.getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(card.getByTestId("feedback-thanks")).toBeVisible();

    const rows = await getRows(
      "feedback",
      `event_id=eq.${id}&select=audience,rating,message,locale`,
    );
    expect(rows).toEqual([
      { audience: "organiser", rating: 5, message: "Très simple", locale: "fr" },
    ]);
    expect(code).toBeTruthy();
  });

  test("6.2: l'invité donne son avis depuis « Mes photos », une fois une photo envoyée", async ({
    page,
    browser,
  }) => {
    const { id, code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);

    // Nothing about feedback on the first screen.
    await expect(guest.getByText("Donner mon avis")).toHaveCount(0);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
    await guest.getByLabel(/J’accepte que mes photos/).check();
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByText("Tout est envoyé, merci !")).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText("Donner mon avis")).toHaveCount(0);

    await guest.getByRole("button", { name: "Mes photos" }).click();
    await guest.getByRole("button", { name: "Donner mon avis" }).click();
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);

    await rate(guest, 4);
    await guest.getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(guest.getByTestId("feedback-thanks")).toBeVisible();
    await guest.getByRole("button", { name: "Fermer" }).click();
    await expect(guest.getByTestId("feedback-form")).toHaveCount(0);

    const rows = await getRows("feedback", `event_id=eq.${id}&select=audience,rating,message`);
    expect(rows).toEqual([{ audience: "guest", rating: 4, message: "" }]);
    await guest.context().close();
  });

  test("6.2: l'administrateur lit les avis, non traités d'abord, et les marque comme traités", async ({
    page,
    browser,
  }) => {
    const organiser = await newVisitor(browser);
    const { id } = await createEvent(organiser);
    const card = organiser.getByTestId("organiser-feedback");
    await rate(organiser, 2);
    const message = `Le QR code était petit ${Date.now()}`;
    await card.getByLabel("Qu’est-ce qui a bloqué, qu’est-ce qui vous a plu ?").fill(message);
    await card.getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(card.getByTestId("feedback-thanks")).toBeVisible();

    await signIn(page);
    const data = await (await page.request.get("/api/account/export")).json();
    await patchRows("profiles", `user_id=eq.${data.account.id}`, { role: "admin" });

    await page.goto("/admin/feedback");
    const row = page.getByTestId("feedback-row").filter({ hasText: message });
    await expect(row).toHaveAttribute("data-handled", "false");
    await expect(row.getByText("2 sur 5")).toBeVisible();
    await expect(row.getByText("Organisateur")).toBeVisible();
    await expect(row.getByRole("link", { name: "Mariage de Léa et Tom" })).toHaveAttribute(
      "href",
      new RegExp(`/admin/events/${id}$`),
    );
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await row.getByTestId("feedback-toggle").click();
    await expect(page.getByText("C’est fait.")).toBeVisible();
    await expect(page.getByTestId("feedback-row").filter({ hasText: message })).toHaveAttribute(
      "data-handled",
      "true",
    );
    await page
      .getByTestId("feedback-row")
      .filter({ hasText: message })
      .getByTestId("feedback-toggle")
      .click();
    await expect(page.getByTestId("feedback-row").filter({ hasText: message })).toHaveAttribute(
      "data-handled",
      "false",
    );

    // In English, too.
    await page.goto("/en/admin/feedback");
    await expect(page.getByRole("heading", { name: "User feedback" })).toBeVisible();
    await organiser.context().close();
  });

  test("6.2: un visiteur sans lien avec l'événement ne peut pas y laisser d'avis", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const stranger = await newVisitor(browser);
    await signIn(stranger);
    const answer = await stranger.request.post("/api/feedback", {
      data: { audience: "organiser", eventCode: code, rating: 5, message: "", locale: "fr" },
    });
    expect(answer.status()).toBe(404);
    const none = await stranger.request.post("/api/feedback", {
      data: { audience: "guest", eventCode: code, rating: 5, message: "", locale: "fr" },
    });
    expect(none.status()).toBe(404);
    await stranger.context().close();
  });
});
