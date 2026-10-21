import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  linkOnTestServer,
  test,
  uniqueEmail,
  waitForSignInEmail,
} from "./fixtures";
import type { Page } from "@playwright/test";

async function requestLink(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel(/Adresse e-mail|Email address/).fill(email);
  await page.getByRole("button", { name: /Recevoir mon lien|Email me a sign-in link/ }).click();
}

test.describe("connexion par lien magique", () => {
  test("F-001: la page de connexion est accessible, en français puis en anglais", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connexion à votre espace");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.goto("/en/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to your space");
    await expectNoAccessibilityViolations(page);
  });

  test("NF-031: le champ et le bouton de connexion ont une zone tactile d'au moins 44 px", async ({
    page,
  }) => {
    await page.goto("/login");
    for (const target of [
      page.getByLabel("Adresse e-mail"),
      page.getByRole("button", { name: "Recevoir mon lien de connexion" }),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("F-001: du formulaire à Mon compte, puis déconnexion", async ({ page }) => {
    const email = uniqueEmail();
    await requestLink(page, email);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vérifiez vos e-mails");
    await expect(page.getByText(email)).toBeVisible();
    await expectNoAccessibilityViolations(page);

    const mail = await waitForSignInEmail(email);
    expect(mail.subject).toContain("Votre lien de connexion");
    expect(mail.html).toContain("Me connecter");
    await page.goto(linkOnTestServer(mail.link, test.info().project.use.baseURL));

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon compte");
    await expect(page.getByLabel("Adresse e-mail")).toHaveValue(email);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  });

  test("F-001: le lien fonctionne depuis un autre navigateur que celui de la demande", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail();
    await requestLink(page, email);
    const mail = await waitForSignInEmail(email);

    // Typical case: the e-mail is read on a phone while the request came from a laptop.
    const phone = await browser.newContext();
    const phonePage = await phone.newPage();
    await phonePage.goto(linkOnTestServer(mail.link, test.info().project.use.baseURL));
    await expect(phonePage).toHaveURL(/\/account$/);
    await phone.close();
  });

  test("F-001: un lien déjà utilisé ramène à la connexion avec une explication", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await requestLink(page, email);
    const link = linkOnTestServer(
      (await waitForSignInEmail(email)).link,
      test.info().project.use.baseURL,
    );

    await page.goto(link);
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?error=link_expired/);
    await expect(page.getByRole("alert").filter({ hasText: "expiré" })).toContainText(
      "a expiré ou a déjà été utilisé",
    );
    await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test("F-001: une page protégée renvoie à la connexion puis revient à la page demandée", async ({
    page,
  }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);

    const email = uniqueEmail();
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByRole("button", { name: "Recevoir mon lien de connexion" }).click();
    const mail = await waitForSignInEmail(email);
    expect(new URL(mail.link).searchParams.get("next")).toBe("/account");

    await page.goto(linkOnTestServer(mail.link, test.info().project.use.baseURL));
    await expect(page).toHaveURL(/\/account$/);
  });

  test("F-001: l'e-mail et la suite du parcours sont en anglais depuis /en/login", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await requestLink(page, email, "/en/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");

    const mail = await waitForSignInEmail(email);
    expect(mail.subject).toContain("sign-in link");
    expect(mail.html).toContain("Your sign-in link");
    await page.goto(linkOnTestServer(mail.link, test.info().project.use.baseURL));
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My account");
  });

  test("F-001: on peut redemander un lien ou changer d'adresse", async ({ page }) => {
    const email = uniqueEmail();
    await requestLink(page, email);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vérifiez vos e-mails");
    // Supabase refuses two e-mails to the same address less than a second apart.
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Renvoyer le lien" }).click();
    await expect(page.getByRole("status").first()).toContainText("nouveau lien");

    await page.getByRole("button", { name: "Utiliser une autre adresse" }).click();
    await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
  });

  test("S-003: la sixième demande depuis la même adresse IP est refusée", async ({ page }) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await requestLink(page, uniqueEmail());
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vérifiez vos e-mails");
    }
    await requestLink(page, uniqueEmail());
    await expect(page.getByRole("alert").filter({ hasText: "Trop de demandes" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connexion à votre espace");
  });

  test("S-003: un renvoi refusé garde la confirmation à l'écran avec l'explication", async ({
    page,
  }) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await requestLink(page, uniqueEmail());
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vérifiez vos e-mails");
    }
    await page.getByRole("button", { name: "Renvoyer le lien" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Trop de demandes" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vérifiez vos e-mails");
  });
});

test.describe("page Mon compte", () => {
  test("F-003: enregistre le nom et suit la langue choisie", async ({ page }) => {
    const email = uniqueEmail();
    await requestLink(page, email);
    const mail = await waitForSignInEmail(email);
    await page.goto(linkOnTestServer(mail.link, test.info().project.use.baseURL));
    await expect(page).toHaveURL(/\/account$/);

    await page.getByLabel("Nom affiché").fill("Léa Martin");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("status")).toContainText("enregistrées");

    await page.reload();
    await expect(page.getByLabel("Nom affiché")).toHaveValue("Léa Martin");

    await page.getByLabel("Langue préférée").selectOption("en");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My account");
    await expect(page.getByLabel("Preferred language")).toHaveValue("en");
  });

  test("F-003: les zones tactiles de la page sont d'au moins 44 px", async ({ page }) => {
    const email = uniqueEmail();
    await requestLink(page, email);
    await page.goto(
      linkOnTestServer((await waitForSignInEmail(email)).link, test.info().project.use.baseURL),
    );
    for (const name of ["Mon compte", "Se déconnecter", "Enregistrer"]) {
      const box = await page
        .getByRole(name === "Mon compte" ? "link" : "button", { name })
        .first()
        .boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
      expect(box?.width, name).toBeGreaterThanOrEqual(44);
    }
  });
});
