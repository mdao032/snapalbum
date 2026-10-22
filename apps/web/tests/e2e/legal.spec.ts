import { createEvent } from "./guest-helpers";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";

/**
 * Legal pages (step 5.2, G-001): drafts for the five documents, in two languages, linked from the
 * places where a person agrees to something. They stay out of search engines until a lawyer has
 * validated them.
 */

const PAGES = [
  { slug: "notice", fr: "Mentions légales", en: "Legal notice" },
  { slug: "terms", fr: "Conditions d’utilisation", en: "Terms of use" },
  { slug: "sales", fr: "Conditions de vente", en: "Terms of sale" },
  { slug: "privacy", fr: "Politique de confidentialité", en: "Privacy policy" },
  { slug: "cookies", fr: "Politique de cookies", en: "Cookie policy" },
] as const;

test.describe("pages légales", () => {
  for (const page of PAGES) {
    test(`G-001, NF-030: ${page.slug} en français, brouillon signalé, accessible`, async ({
      page: browser,
    }) => {
      await browser.goto(`/legal/${page.slug}`);
      await expect(browser.getByRole("heading", { level: 1 })).toHaveText(page.fr);
      await expect(browser.getByTestId("legal-draft")).toContainText(
        "n’a pas encore été relu par un juriste",
      );
      await expect(browser.getByText(/Dernière mise à jour\s:\s22 octobre 2026/)).toBeVisible();
      expect(await browser.locator("main h2").count()).toBeGreaterThanOrEqual(4);
      await expect(browser.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);
      await expectNoAccessibilityViolations(browser);
      await expectNoHorizontalScroll(browser);
    });

    test(`G-001, section 12: ${page.slug} en anglais`, async ({ page: browser }) => {
      await browser.goto(`/en/legal/${page.slug}`);
      await expect(browser.locator("html")).toHaveAttribute("lang", "en");
      await expect(browser.getByRole("heading", { level: 1 })).toHaveText(page.en);
      await expect(browser.getByTestId("legal-draft")).toContainText(
        "has not yet been reviewed by a lawyer",
      );
      await expectNoAccessibilityViolations(browser);
    });
  }

  test("les informations de l'éditeur non données sont signalées, jamais inventées", async ({
    page,
  }) => {
    await page.goto("/legal/notice");
    await expect(
      page.locator("mark", { hasText: "À compléter : raison sociale" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("mark", { hasText: "À compléter : numéro SIRET" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("mark", { hasText: "À compléter : adresse e-mail de contact" }).first(),
    ).toBeVisible();
  });

  test("F-045, R4, R6: les conditions de vente citent les prix et le remboursement de plans.ts", async ({
    page,
  }) => {
    await page.goto("/legal/sales");
    const text = await page.locator("article").innerText();
    expect(text).toMatch(/49\s€ TTC par événement/);
    expect(text).toMatch(/19\s€ TTC pour 12 mois/);
    expect(text).toMatch(/dans les 14 jours suivant l’achat si moins de 20 photos/);
    expect(text).not.toContain("{");
  });

  test("le sommaire mène aux sections", async ({ page }) => {
    await page.goto("/legal/privacy");
    await page
      .getByRole("navigation", { name: "Sommaire" })
      .getByRole("link", { name: "Vos droits" })
      .click();
    await expect(page).toHaveURL(/#rights$/);
    await expect(page.getByRole("heading", { level: 2, name: "Vos droits" })).toBeInViewport();
  });

  test("une page légale inconnue est un vrai 404", async ({ page }) => {
    const response = await page.goto("/legal/inconnue");
    expect(response?.status()).toBe(404);
  });

  test("brouillon : les pages légales ne sont pas dans le plan du site", async ({ request }) => {
    const text = await (await request.get("/sitemap.xml")).text();
    expect(text).not.toContain("/legal/");
  });

  test("le pied de page donne accès aux cinq pages", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Liens du pied de page" });
    for (const name of [
      "Mentions légales",
      "Conditions d’utilisation",
      "Conditions de vente",
      "Confidentialité",
      "Cookies",
    ]) {
      await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await footer.getByRole("link", { name: "Confidentialité", exact: true }).click();
    await expect(page).toHaveURL(/\/legal\/privacy$/);
  });

  test("la page de connexion renvoie vers les conditions et la confidentialité", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("link", { name: "conditions d’utilisation", exact: true }),
    ).toHaveAttribute("href", /\/legal\/terms$/);
    await expect(
      page.getByRole("link", { name: "politique de confidentialité", exact: true }),
    ).toHaveAttribute("href", /\/legal\/privacy$/);
    await expectNoAccessibilityViolations(page);
  });

  test("R2: le bouton d'achat renvoie vers les conditions de vente", async ({ page }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    await expect(
      page.getByTestId("plan-card").getByRole("link", { name: "conditions de vente" }),
    ).toHaveAttribute("href", /\/legal\/sales$/);
  });

  test("G-001: la page invité donne accès aux conditions et à la confidentialité, sans quitter la page", async ({
    page,
    browser,
  }) => {
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    const links = guest.getByRole("navigation", { name: "Informations légales" });
    await expect(links.getByRole("link", { name: "Conditions d’utilisation" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(links.getByRole("link", { name: "Confidentialité" })).toHaveAttribute(
      "href",
      /\/legal\/privacy$/,
    );
    await expectNoAccessibilityViolations(guest);
    await guest.context().close();
  });
});
