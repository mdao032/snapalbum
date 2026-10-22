import type { Page } from "@playwright/test";
import { createEvent } from "./guest-helpers";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  test,
} from "./fixtures";

/**
 * Cookie banner and audience measurement (step 5.2, G-003): nothing is sent or stored before an
 * acceptance, refusing is as easy as accepting, the choice can be changed. Every request to PostHog
 * is intercepted: none reaches it.
 */

// These tests start as a visitor who has not chosen yet (the others start with a refusal).
test.use({ storageState: { cookies: [], origins: [] } });

interface Captured {
  url: string;
  body: { api_key: string; event: string; distinct_id: string; properties: Record<string, string> };
}

async function capturePostHog(page: Page): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route("https://eu.i.posthog.com/**", async (route) => {
    captured.push({
      url: route.request().url(),
      body: JSON.parse(route.request().postData() ?? "{}"),
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return captured;
}

const banner = (page: Page) => page.getByTestId("consent-banner");
const stored = (page: Page, key: string) =>
  page.evaluate((k) => window.localStorage.getItem(k), key);

test.describe("bandeau de cookies", () => {
  test("G-003: sans choix, le bandeau apparaît et rien n'est envoyé ni enregistré", async ({
    page,
  }) => {
    const captured = await capturePostHog(page);
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await expect(
      banner(page).getByRole("heading", { name: "Votre choix sur les cookies" }),
    ).toBeVisible();
    await page.goto("/pricing");
    await expect(banner(page)).toBeVisible();

    expect(captured).toEqual([]);
    expect(await stored(page, "snapalbum:analytics-id")).toBeNull();
    expect(await stored(page, "snapalbum:consent")).toBeNull();
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/ph_|posthog/);
  });

  test("G-003, NF-031: « Refuser » et « Accepter » se valent : mêmes boutons, mêmes tailles, grands", async ({
    page,
  }) => {
    await page.goto("/");
    const refuse = await banner(page).getByRole("button", { name: "Refuser" }).boundingBox();
    const accept = await banner(page).getByRole("button", { name: "Accepter" }).boundingBox();
    expect(refuse?.height).toBeGreaterThanOrEqual(44);
    expect(accept?.height).toBeGreaterThanOrEqual(44);
    expect(Math.round(refuse?.width ?? 0)).toBe(Math.round(accept?.width ?? -1));
    expect(Math.round(refuse?.height ?? 0)).toBe(Math.round(accept?.height ?? -1));
    const classes = async (name: string) =>
      banner(page)
        .getByRole("button", { name })
        .evaluate((node) => node.className);
    expect(await classes("Refuser")).toBe(await classes("Accepter"));
  });

  test("NF-030, NF-022: le bandeau est accessible et ne fait pas défiler la page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("G-003: refuser enregistre le choix, rien n'est jamais envoyé, le bandeau ne revient pas", async ({
    page,
  }) => {
    const captured = await capturePostHog(page);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Refuser" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(JSON.parse((await stored(page, "snapalbum:consent")) ?? "{}").choice).toBe("refused");

    await page.goto("/pricing");
    await page.reload();
    await expect(banner(page)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(captured).toEqual([]);
    expect(await stored(page, "snapalbum:analytics-id")).toBeNull();
  });

  test("G-003, SPEC 15: accepter lance la mesure : une page vue par page, vers l'adresse européenne, sans paramètre", async ({
    page,
  }) => {
    const captured = await capturePostHog(page);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Accepter" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(JSON.parse((await stored(page, "snapalbum:consent")) ?? "{}").choice).toBe("accepted");

    await expect.poll(() => captured.length).toBe(1);
    expect(captured[0]?.url).toBe("https://eu.i.posthog.com/capture/");
    expect(captured[0]?.body).toMatchObject({
      api_key: "phc_e2e_key_that_is_not_real",
      event: "$pageview",
      properties: { platform: "web", $pathname: "/" },
    });

    await page.goto("/pricing?secret=1");
    await expect.poll(() => captured.length).toBe(2);
    expect(captured[1]?.body.properties.$pathname).toBe("/pricing");
    expect(JSON.stringify(captured[1]?.body)).not.toContain("secret");
    expect(captured[1]?.body.distinct_id).toBe(captured[0]?.body.distinct_id);
  });

  test("G-003: « Gérer les cookies » rouvre le bandeau ; refuser arrête la mesure et efface l'identifiant", async ({
    page,
  }) => {
    const captured = await capturePostHog(page);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Accepter" }).click();
    await expect.poll(() => captured.length).toBe(1);
    expect(await stored(page, "snapalbum:analytics-id")).toBeTruthy();

    const manage = page.getByRole("contentinfo").getByRole("button", { name: "Gérer les cookies" });
    await manage.click();
    await expect(
      banner(page).getByRole("heading", { name: "Votre choix sur les cookies" }),
    ).toBeFocused();
    await banner(page).getByRole("button", { name: "Refuser" }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(manage).toBeFocused();
    expect(await stored(page, "snapalbum:analytics-id")).toBeNull();

    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    expect(captured).toHaveLength(1);
  });

  test("un choix ancien de plus de six mois est redemandé", async ({ page }) => {
    await page.addInitScript(() => {
      const old = Date.now() - 200 * 24 * 3600 * 1000;
      window.localStorage.setItem(
        "snapalbum:consent",
        JSON.stringify({ choice: "accepted", at: old }),
      );
    });
    const captured = await capturePostHog(page);
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    expect(captured).toEqual([]);
  });

  test("un choix valide est respecté dès l'arrivée : accepté, la mesure démarre sans bandeau", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "snapalbum:consent",
        JSON.stringify({ choice: "accepted", at: Date.now() }),
      );
    });
    const captured = await capturePostHog(page);
    await page.goto("/");
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => captured.length).toBe(1);
  });

  test("section 12: le bandeau est en anglais sous /en", async ({ page }) => {
    await page.goto("/en");
    await expect(banner(page).getByRole("heading", { name: "Your cookie choice" })).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Refuse" })).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Accept" })).toBeVisible();
    await banner(page).getByRole("link", { name: "Learn more" }).click();
    await expect(page).toHaveURL(/\/en\/legal\/cookies$/);
  });

  test("NF-002: la page invité n'a ni bandeau, ni lien de gestion, ni mesure", async ({
    page,
    browser,
  }) => {
    // The organiser's pages carry the banner: refuse first so that it never covers a button.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "snapalbum:consent",
        JSON.stringify({ choice: "refused", at: Date.now() }),
      );
    });
    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    const captured = await capturePostHog(guest);
    await guest.goto(`/e/${code}`);
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByTestId("consent-banner")).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Gérer les cookies" })).toHaveCount(0);
    expect(captured).toEqual([]);
    await guest.context().close();
  });
});
