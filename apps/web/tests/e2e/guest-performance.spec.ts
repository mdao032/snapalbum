import { brotliCompressSync } from "node:zlib";
import { createEvent } from "./guest-helpers";
import { expect, newVisitor, test } from "./fixtures";

/** NF-002: the guest page loads less than 150 KB of JavaScript (brotli) before any action. */
const BUDGET_BYTES = 150 * 1000;

test.describe("budget de la page invité", () => {
  test("NF-002: moins de 150 Ko de JavaScript (brotli) avant le premier geste, moteur d'envoi chargé à la demande", async ({
    page,
    browser,
  }, testInfo) => {
    // Brotli sizes do not depend on the browser: measure once.
    test.skip(testInfo.project.name !== "chromium", "mesure indépendante du navigateur");

    const { code } = await createEvent(page);
    const guest = await newVisitor(browser);
    const scripts = new Map<string, number>();
    const bodies: string[] = [];
    guest.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
      const body = await response.body().catch(() => null);
      if (!body) return;
      scripts.set(url, brotliCompressSync(body).length);
      bodies.push(body.toString("utf8"));
    });

    await guest.goto(`/e/${code}`);
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByText("Choisir dans la galerie")).toBeVisible();

    const total = [...scripts.values()].reduce((sum, size) => sum + size, 0);
    const detail = [...scripts.entries()]
      .map(([url, size]) => `${size} ${url.split("/").pop()}`)
      .sort()
      .join("\n");
    expect(total, `JavaScript initial: ${total} octets\n${detail}`).toBeLessThan(BUDGET_BYTES);

    // The upload engine is not part of that first load: it comes with the first photo chosen.
    expect(bodies.some((text) => text.includes("already_received"))).toBe(false);
    await guest.context().close();
  });
});
