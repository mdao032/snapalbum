import { createHmac, randomUUID } from "node:crypto";
import { getRows, setEventColumns } from "./admin";
import { test } from "./fixtures";
import { createEvent } from "./guest-helpers";

// Throwaway: captures for the phase 4 closing review. Not committed.
const OUT =
  "C:/Users/User/AppData/Local/Temp/claude/E--Projets-snapalbum/9f3aa651-e887-4234-b9d4-8b0ca41a8b3d/scratchpad";
const SECRET = "whsec_e2e_secret_for_tests_only";

test("captures phase 4", async ({ page, request }) => {
  test.skip(test.info().project.name !== "chromium");
  test.setTimeout(180_000);
  const sizes = [
    { name: "375", width: 375, height: 800 },
    { name: "1440", width: 1440, height: 900 },
  ];
  const shot = async (name: string) => {
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}-${size.name}.png`, fullPage: true });
    }
  };

  const { id } = await createEvent(page);
  await page.goto(`/events/${id}`);
  await page.waitForLoadState("networkidle");
  await shot("dash-free");

  await page.goto(`/events/${id}?payment=cancelled`);
  await page.waitForLoadState("networkidle");
  await shot("dash-cancelled");

  const [row] = await getRows("events", `id=eq.${id}&select=owner_id`);
  const session = `cs_test_${randomUUID().replaceAll("-", "")}`;
  await page.goto(`/events/${id}?payment=success&session_id=${session}`);
  const payload = JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 4900,
        currency: "eur",
        payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
        metadata: { event_id: id, user_id: String(row?.owner_id), product: "event" },
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac("sha256", SECRET).update(`${timestamp}.${payload}`).digest("hex")}`;
  await request.post("/api/stripe/webhook", {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: Buffer.from(payload),
  });
  await page.getByTestId("payment-return").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid=payment-return]")?.getAttribute("data-state") === "done",
    undefined,
    { timeout: 20_000 },
  );
  await shot("dash-paid-banner");

  await page.goto("/account");
  await page.waitForLoadState("networkidle");
  await shot("account");

  const second = await createEvent(page);
  await setEventColumns(second.id, {
    status: "pending_deletion",
    deletion_reason: "expired",
    deleted_at: new Date().toISOString(),
  });
  await page.goto(`/events/${second.id}`);
  await page.waitForLoadState("networkidle");
  await shot("dash-expired");
});
