import type { Page } from "@playwright/test";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  test,
} from "./fixtures";

/**
 * The public site (step 5.1): home page, pages for each occasion, search-engine files and the demo.
 * No page promises more than the product does, and the demo never writes anywhere.
 */

const OCCASIONS = [
  {
    fr: "mariage",
    en: "wedding",
    h1fr: /Toutes les photos de votre mariage/,
    h1en: /Every photo of your wedding/,
  },
  {
    fr: "anniversaire",
    en: "birthday",
    h1fr: /Un anniversaire, des dizaines de téléphones/,
    h1en: /One birthday, dozens of phones/,
  },
  {
    fr: "entreprise",
    en: "company",
    h1fr: /événements d’entreprise, validées/,
    h1en: /company events, approved/,
  },
] as const;

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  return page
    .locator("script[type='application/ld+json']")
    .evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent ?? "null")));
}

/**
 * Opens the demo with time held still: photos only "travel" when the test moves the clock, so a slow
 * phone profile can never make a photo arrive before the test looked at it.
 */
async function openDemo(page: Page, path = "/demo"): Promise<void> {
  await page.clock.install();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
}

const pathOf = (href: string | null) => (href ? new URL(href).pathname : null);

test.describe("page d'accueil complète", () => {
  test("NF-030, NF-022: les sections de la promesse, de la démonstration, des tarifs et de la FAQ", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("enfin réunies");

    await expect(page.getByRole("heading", { level: 2, name: "Comment ça marche" })).toBeVisible();
    await expect(page.locator("#comment-ca-marche li")).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 3, name: "Vous créez l’album" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Essayez comme un invité" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Pour chaque occasion" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Questions fréquentes" }),
    ).toBeVisible();
    await expect(page.locator("#faq details")).toHaveCount(10);

    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("F-045: les tarifs de l'accueil viennent de plans.ts et disent que l'offre gratuite optimise les photos", async ({
    page,
  }) => {
    await page.goto("/");
    const free = page.getByTestId("home-plan-free");
    const event = page.getByTestId("home-plan-event");
    await expect(free).toContainText(/0\s€/);
    await expect(free).toContainText("200 photos et vidéos par événement");
    await expect(free).toContainText(
      /Photos optimisées \(2\s048 px au plus\), originaux non conservés/,
    );
    await expect(event).toContainText(/49\s€/);
    await expect(event).toContainText("Photos d’origine conservées");

    await page.getByRole("link", { name: "Voir tous les tarifs" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("la FAQ s'ouvre au clavier et ses chiffres sont ceux des offres", async ({ page }) => {
    await page.goto("/");
    const question = page.getByText("Combien de photos et de vidéos peut-on envoyer ?");
    const details = page.locator("#faq details", { has: question });
    await expect(details).not.toHaveAttribute("open", "");
    await question.click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("200 photos et vidéos par événement");
    await expect(details).toContainText(/10\s000/);
    await expect(details).toContainText("Le nombre d’invités n’est pas limité");
  });

  test("témoignages: aucune section tant qu'il n'y en a pas de réel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#temoignages")).toHaveCount(0);
    await expect(page.getByText("Ils ont utilisé")).toHaveCount(0);
  });

  test("section 12: la page d'accueil est complète en anglais", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 2, name: "How it works" })).toBeVisible();
    await expect(page.locator("#faq details")).toHaveCount(10);
    await expect(page.getByTestId("home-plan-event")).toContainText("€49");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("le pied de page mène à la démo, aux tarifs et à chaque occasion", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Liens du pied de page" });
    for (const name of [
      "Comment ça marche",
      "Démo",
      "Tarifs",
      "Mariage",
      "Anniversaire",
      "Entreprise",
    ]) {
      await expect(footer.getByRole("link", { name })).toBeVisible();
    }
    await footer.getByRole("link", { name: "Démo" }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("le lien « Comment ça marche » du pied de page ramène à la section", async ({ page }) => {
    await page.goto("/pricing");
    await page
      .getByRole("navigation", { name: "Liens du pied de page" })
      .getByRole("link", { name: "Comment ça marche" })
      .click();
    await expect(page).toHaveURL(/\/#comment-ca-marche$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Comment ça marche" }),
    ).toBeInViewport();
  });

  test("l'en-tête propose la navigation sur grand écran", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "sur téléphone, la navigation est au pied de page",
    );
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Démo" })).toBeVisible();
    await nav.getByRole("link", { name: "Tarifs" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });
});

test.describe("pages par occasion", () => {
  for (const occasion of OCCASIONS) {
    test(`${occasion.fr}: contenu rédigé, accessible, sans défilement horizontal`, async ({
      page,
    }) => {
      await page.goto(`/usages/${occasion.fr}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(occasion.h1fr);
      await expect(page.locator("#points li")).toHaveCount(3);
      await expect(page.locator("#conseils li")).toHaveCount(4);
      await expect(page.locator("#offre")).toContainText(/200 photos et vidéos|offre Événement/);
      await expectNoAccessibilityViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test(`${occasion.en}: la page anglaise a son propre texte et sa propre adresse`, async ({
      page,
    }) => {
      await page.goto(`/en/usages/${occasion.en}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(occasion.h1en);
      await expectNoAccessibilityViolations(page);
    });

    test(`${occasion.fr}: annonce son adresse canonique et sa version anglaise`, async ({
      page,
    }) => {
      await page.goto(`/usages/${occasion.fr}`);
      expect(pathOf(await page.locator("link[rel='canonical']").getAttribute("href"))).toBe(
        `/usages/${occasion.fr}`,
      );
      expect(
        pathOf(await page.locator("link[rel='alternate'][hreflang='en']").getAttribute("href")),
      ).toBe(`/en/usages/${occasion.en}`);
      expect(
        pathOf(
          await page.locator("link[rel='alternate'][hreflang='x-default']").getAttribute("href"),
        ),
      ).toBe(`/usages/${occasion.fr}`);
    });
  }

  test("le sélecteur de langue ne mène pas à une page introuvable", async ({ page }) => {
    await page.goto("/usages/mariage");
    await page.getByRole("button", { name: /^en English/ }).click();
    await expect(page).toHaveURL(/\/en\/usages\/wedding$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Every photo of your wedding/);
  });

  test("un slug de l'autre langue est redirigé vers l'adresse de la langue", async ({ page }) => {
    await page.goto("/en/usages/mariage");
    await expect(page).toHaveURL(/\/en\/usages\/wedding$/);
  });

  test("une occasion inconnue est une page introuvable", async ({ page }) => {
    const response = await page.goto("/usages/licorne");
    expect(response?.status()).toBe(404);
  });

  test("les chiffres de l'offre sont ceux de plans.ts", async ({ page }) => {
    await page.goto("/usages/mariage");
    await expect(page.locator("#offre")).toContainText(/49\s€/);
    await expect(page.locator("#offre")).toContainText(/10\s000/);
    await expect(page.locator("#offre")).toContainText(
      "conservés que pour les photos envoyées après",
    );
  });
});

test.describe("référencement", () => {
  test("l'accueil a titre, description, adresse canonique, langues et partage", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Snapalbum : toutes les photos de votre événement/);
    await expect(page.locator("meta[name='description']")).toHaveAttribute("content", /QR code/);
    expect(pathOf(await page.locator("link[rel='canonical']").getAttribute("href"))).toBe("/");
    expect(
      pathOf(await page.locator("link[rel='alternate'][hreflang='en']").getAttribute("href")),
    ).toBe("/en");
    await expect(page.locator("meta[property='og:title']")).toHaveAttribute("content", /Snapalbum/);
    await expect(page.locator("meta[property='og:site_name']")).toHaveAttribute(
      "content",
      "Snapalbum",
    );
  });

  test("l'image de partage existe et est une image PNG", async ({ page, request }) => {
    await page.goto("/");
    const image = await page.locator("meta[property='og:image']").first().getAttribute("content");
    expect(image).toBeTruthy();
    const response = await request.get(new URL(image ?? "").pathname);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  });

  test("les pages privées ne sont pas indexables", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);
  });

  test("les données structurées de l'accueil : organisation, site, offres, FAQ", async ({
    page,
  }) => {
    await page.goto("/");
    const data = await jsonLd(page);
    const types = data.map((item) => item["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "Product", "FAQPage"]);

    const product = data.find((item) => item["@type"] === "Product") as {
      offers: { price: string; priceCurrency: string }[];
    };
    expect(product.offers.map((offer) => offer.price)).toEqual(["0.00", "49.00"]);
    expect(product.offers.every((offer) => offer.priceCurrency === "EUR")).toBe(true);

    const faq = data.find((item) => item["@type"] === "FAQPage") as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(10);
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|"review"/);
  });

  test("robots.txt ferme les espaces privés et annonce le plan du site", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("User-Agent: *");
    for (const path of ["/api/", "/events", "/en/events", "/account", "/login", "/e/", "/g/"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test("le plan du site liste les pages publiques avec leurs langues, jamais une page privée", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const text = await response.text();
    for (const path of [
      "/pricing",
      "/demo",
      "/usages/mariage",
      "/en/usages/wedding",
      "/en/usages/company",
    ]) {
      expect(text).toContain(`${path}</loc>`);
    }
    expect(text).toContain('hreflang="en"');
    expect(text).not.toMatch(/<loc>[^<]*\/(events|account|login|api|e|g)(\/|<)/);
  });
});

test.describe("démonstration publique sans compte", () => {
  test("F-045, NF-031: l'invité d'exemple choisit des photos, les voit partir et arriver chez l'organisateur", async ({
    page,
  }) => {
    await page.goto("/demo");
    await expect(
      page.getByRole("heading", { level: 1, name: "Essayez comme un invité" }),
    ).toBeVisible();
    await expect(page.getByText("Démonstration : aucune photo n’est envoyée.")).toBeVisible();
    await expect(page.getByTestId("demo-counter")).toHaveText("Aucune photo reçue");

    const take = page.getByRole("button", { name: "Prendre une photo" });
    const box = await take.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await take.click();

    await expect(
      page.getByRole("heading", { name: "Choisissez des photos d’exemple" }),
    ).toBeFocused();
    const send = page.getByRole("button", { name: "Choisissez au moins une photo" });
    await expect(send).toBeDisabled();
    for (const name of ["Les mariés", "Le gâteau", "La piste de danse"]) {
      await page.getByRole("button", { name, exact: false }).click();
    }
    await page.clock.resume();
    await expectNoAccessibilityViolations(page);
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    await page.getByRole("button", { name: "Envoyer 3 photos" }).click();

    await expect(page.getByRole("list", { name: "Vos envois" }).locator("li")).toHaveCount(3);
    await page.clock.runFor(1000);
    await expect(page.getByTestId("demo-counter")).toHaveText("Aucune photo reçue");
    await page.clock.runFor(4000);
    await expect(page.getByTestId("demo-counter")).toHaveText("3 photos reçues");
    await expect(
      page.getByRole("status").filter({ hasText: "Merci ! 3 photos envoyées." }),
    ).toBeVisible();
    await page.clock.resume();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Recommencer la démo" }).click();
    await expect(page.getByTestId("demo-counter")).toHaveText("Aucune photo reçue");
    await expect(page.getByRole("button", { name: "Prendre une photo" })).toBeVisible();
  });

  test("sans réseau les photos attendent, au retour elles partent (R1: rien n'est perdu)", async ({
    page,
  }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Ajouter depuis ma galerie" }).click();
    await page.getByRole("button", { name: "Le bouquet" }).click();
    await page.getByRole("button", { name: "Envoyer 1 photo" }).click();
    await page.getByRole("button", { name: "Couper le réseau" }).click();

    await expect(page.getByText("Réseau coupé")).toBeVisible();
    await expect(page.getByText("En attente du réseau")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Pas de réseau" })).toBeVisible();
    await page.clock.runFor(5000);
    await expect(page.getByTestId("demo-counter")).toHaveText("Aucune photo reçue");

    await page.getByRole("button", { name: "Rétablir le réseau" }).click();
    await page.clock.runFor(2000);
    await expect(page.getByTestId("demo-counter")).toHaveText("1 photo reçue");
  });

  test("S-001: la démonstration n'envoie rien : aucune requête d'écriture, aucun appel à l'API", async ({
    page,
  }) => {
    const requests: { method: string; url: string }[] = [];
    page.on("request", (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });
    await openDemo(page);
    const before = requests.length;

    await page.getByRole("button", { name: "Prendre une photo" }).click();
    await page.getByRole("button", { name: "Le coucher de soleil" }).click();
    await page.getByRole("button", { name: "Les cousins" }).click();
    await page.getByRole("button", { name: "Envoyer 2 photos" }).click();
    await page.clock.runFor(4000);
    await expect(page.getByTestId("demo-counter")).toHaveText("2 photos reçues");

    // Nothing is chosen from the device and nothing is sent: the page asks for nothing more.
    const after = requests.slice(before).filter((request) => !request.url.includes("_rsc="));
    expect(after).toEqual([]);
    expect(
      requests.filter((request) => request.method !== "GET" && request.method !== "HEAD"),
    ).toEqual([]);
    expect(requests.some((request) => new URL(request.url).pathname.startsWith("/api/"))).toBe(
      false,
    );
    await expect(page.locator("input[type='file']")).toHaveCount(0);
  });

  test("section 12: la démonstration est complète en anglais", async ({ page }) => {
    await openDemo(page, "/en/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Try it as a guest" })).toBeVisible();
    await page.getByRole("button", { name: "Take a photo" }).click();
    await page.getByRole("button", { name: "The cake" }).click();
    await page.getByRole("button", { name: "Send 1 photo" }).click();
    await page.clock.runFor(3000);
    await expect(page.getByTestId("demo-counter")).toHaveText("1 photo received");
    await page.clock.resume();
    await expectNoAccessibilityViolations(page);
  });
});
