import type { Page } from "@playwright/test";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  test,
} from "./fixtures";
import { createEvent } from "./guest-helpers";

/**
 * NF-030, NF-031, step 5.4: every page of the site, in both languages, on the four device
 * profiles, has no detectable WCAG A/AA issue and never scrolls sideways.
 */
test.setTimeout(180_000);

async function check(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  // A colour transition caught half-way would be measured as a contrast failure.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
}

/** The element under the keyboard focus has a visible indicator (WCAG 2.4.7, 2.4.11). */
async function expectVisibleFocus(page: Page, steps: number) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  for (let step = 0; step < steps; step += 1) {
    await page.keyboard.press("Tab");
    const indicator = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return "none";
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none";
      return outline || shadow
        ? "visible"
        : `${element.tagName} ${element.textContent?.slice(0, 30)}`;
    });
    expect(indicator, `Tab ${step + 1}`).toBe("visible");
  }
}

test.describe("parcours d'accessibilité de toutes les pages", () => {
  test("NF-030: le site public, en français et en anglais", async ({ page }) => {
    for (const path of [
      "/",
      "/pricing",
      "/demo",
      "/usages/mariage",
      "/legal/privacy",
      "/legal/cookies",
      "/login",
      "/en",
      "/en/pricing",
      "/en/demo",
      "/en/usages/wedding",
      "/en/login",
    ]) {
      await check(page, path);
    }
  });

  test("NF-030: l'espace de l'organisateur et les pages d'un événement", async ({ page }) => {
    const { id, code } = await createEvent(page);
    for (const path of [
      "/events",
      "/events/new",
      `/events/${id}`,
      `/events/${id}/moderation`,
      "/account",
      `/e/${code}`,
      `/en/e/${code}`,
      `/e/${code}/live`,
      "/en/events",
      `/en/events/${id}`,
      "/en/account",
    ]) {
      await check(page, path);
    }
  });

  test("NF-030: la navigation au clavier montre toujours où l'on est", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("iphone") || testInfo.project.name === "pixel-7",
      "clavier",
    );
    await expectVisibleFocus(page, 12);
  });
});
