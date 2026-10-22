import { setEventColumns } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";
import { createEvent } from "./guest-helpers";

/**
 * Plans in the interface (step 4.1): the "Made with" notice follows the plan, the free plan says
 * plainly what it does to the photos (F-045), and the pricing page reads its figures from plans.ts.
 */

test.describe("Page des tarifs", () => {
  test("F-045: les trois offres, leurs prix et la qualité de l'offre gratuite, sans débordement ni défaut d'accessibilité", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("tarif simple");

    const free = page.getByTestId("plan-free");
    await expect(free).toContainText("Gratuit");
    await expect(free).toContainText(/0\s€/);
    await expect(free).toContainText(/200 photos et vidéos par événement/);
    await expect(free).toContainText(
      "Photos optimisées (2 048 px au plus), originaux non conservés",
    );
    await expect(free).toContainText("Mention « Créé avec Snapalbum » visible");

    const event = page.getByTestId("plan-event");
    await expect(event).toContainText(/49\s€/);
    await expect(event).toContainText("Photos d’origine conservées");
    await expect(event).toContainText("Album conservé 12 mois");
    await expect(event).toContainText("discrète");

    await expect(page.getByTestId("plan-pro")).toContainText("Bientôt disponible");
    await expect(page.getByText(/envoyées avant restent en version optimisée/)).toBeVisible();
    await expect(page.getByText(/19\s€/)).toBeVisible();

    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("la page existe aussi en anglais", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(page.getByTestId("plan-event")).toContainText("€49");
    await expect(page.getByTestId("plan-free")).toContainText("Optimised photos");
  });
});

test.describe("F-045: transparence sur la qualité de l'offre gratuite", () => {
  test("la mention est visible à la création, dans le tableau de bord et à la modération, et disparaît en payant", async ({
    page,
  }) => {
    const { id } = await createEvent(page);

    await page.goto("/events/new");
    await expect(page.getByTestId("quality-notice")).toContainText(
      "Offre gratuite : photos optimisées — originaux avec l’offre Événement.",
    );
    await expectNoAccessibilityViolations(page);

    await page.goto(`/events/${id}`);
    const card = page.getByTestId("plan-card");
    await expect(card).toHaveAttribute("data-plan", "free");
    await expect(card).toContainText("Offre Gratuit");
    await expect(card).toContainText("Album conservé jusqu’au");
    await expect(card.getByTestId("quality-notice")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.goto(`/events/${id}/moderation`);
    await expect(page.getByTestId("quality-notice")).toBeVisible();

    await setEventColumns(id, { plan: "event" });
    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "event");
    await expect(page.getByTestId("plan-card").getByTestId("quality-notice")).toHaveCount(0);
    await page.goto(`/events/${id}/moderation`);
    await expect(page.getByTestId("quality-notice")).toHaveCount(0);
  });
});

test.describe("La mention « Créé avec Snapalbum » suit l'offre", () => {
  test("visible en gratuit, discrète en Événement, absente en Pro : page invité, partage et diaporama", async ({
    page,
    browser,
  }) => {
    const { code, id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "Créer un lien de partage" }).click();
    const link = new URL(await page.getByLabel("Lien de partage").inputValue());

    const guest = await newVisitor(browser);
    const shared = await newVisitor(browser);

    const check = async (mode: "visible" | "discreet" | null) => {
      for (const visitor of [guest, shared]) {
        await visitor.goto(visitor === guest ? `/e/${code}` : link.pathname);
        const notice = visitor.getByTestId("made-with");
        if (mode === null) {
          await expect(notice).toHaveCount(0);
        } else {
          await expect(notice).toHaveAttribute("data-mode", mode);
          await expect(notice).toContainText("Créé avec Snapalbum");
        }
      }
      await page.goto(`/e/${code}/live`);
      if (mode === null) {
        await expect(page.getByTestId("made-with")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("made-with")).toHaveAttribute("data-mode", mode);
      }
    };

    await check("visible");
    await expectNoAccessibilityViolations(guest);
    await expectNoHorizontalScroll(guest);

    await setEventColumns(id, { plan: "event" });
    await check("discreet");

    await setEventColumns(id, { plan: "pro" });
    await check(null);

    await guest.context().close();
    await shared.context().close();
  });
});
