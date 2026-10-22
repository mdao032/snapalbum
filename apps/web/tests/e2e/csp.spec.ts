import type { Page } from "@playwright/test";
import { expect, newVisitor, test } from "./fixtures";
import { chooseFromGallery, createEvent, samplePhoto } from "./guest-helpers";

/** Every refusal the browser reports for the page's Content-Security-Policy, as a readable line. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(
        `${event.violatedDirective} ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`,
      );
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
}

test.describe("Content-Security-Policy", () => {
  test("S-004: les pages publiques, la connexion et la page invité envoient la politique", async ({
    page,
  }) => {
    const { code } = await createEvent(page);
    for (const path of ["/", "/en", "/pricing", "/demo", "/login", `/e/${code}`, `/en/e/${code}`]) {
      const policy = (await page.request.get(path)).headers()["content-security-policy"];
      expect(policy, path).toContain("default-src 'self'");
      expect(policy, path).toContain("frame-ancestors 'none'");
      expect(policy, path).toContain("object-src 'none'");
    }
  });

  test("S-004: un script d'un autre site est refusé par le navigateur", async ({ page }) => {
    await page.goto("/");
    const blocked = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener("securitypolicyviolation", (event) =>
            resolve(`${event.violatedDirective} ${event.blockedURI}`),
          );
          const script = document.createElement("script");
          script.src = "https://example.com/evil.js";
          document.head.appendChild(script);
        }),
    );
    expect(blocked).toContain("script-src");
    expect(blocked).toContain("https://example.com/evil.js");
  });

  test("S-004: le site public se parcourt sans aucune violation", async ({ page }) => {
    const violations = await watchViolations(page);
    for (const path of [
      "/",
      "/en",
      "/pricing",
      "/demo",
      "/usages/mariage",
      "/legal/cookies",
      "/login",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await violations(), path).toEqual([]);
    }
  });

  test("S-004: de la création à la galerie, l'envoi de photos ne rencontre aucune violation", async ({
    page,
    browser,
  }) => {
    // A whole journey (sign-in, upload, four organiser pages) on an emulated phone.
    test.setTimeout(90_000);
    const organiser = await watchViolations(page);
    const { code, id } = await createEvent(page);

    const guest = await newVisitor(browser);
    const guestViolations = await watchViolations(guest);
    await guest.goto(`/e/${code}`);
    await chooseFromGallery(guest, [{ name: "IMG_0001.png", buffer: samplePhoto(1) }]);
    await guest.getByLabel(/J’accepte que mes photos/).check();
    await guest.getByRole("button", { name: "Participer" }).click();
    await expect(guest.getByText("Tout est envoyé, merci !")).toBeVisible({ timeout: 30_000 });
    await guest.reload();
    await guest.waitForLoadState("networkidle");
    expect(await guestViolations()).toEqual([]);

    for (const path of [
      `/events/${id}`,
      `/events/${id}/moderation`,
      `/e/${code}/live`,
      "/account",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await organiser(), path).toEqual([]);
    }
    await guest.context().close();
  });
});
