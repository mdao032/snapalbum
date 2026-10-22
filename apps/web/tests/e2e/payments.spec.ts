import type { APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { getRows } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  signIn,
  test,
} from "./fixtures";
import { createEvent } from "./guest-helpers";

/**
 * Payment (step 4.2) without calling Stripe: the pages are Stripe's, so what is tested here is
 * everything this application owns, against the real server and database. Webhooks are signed
 * with the test secret the server was started with (`playwright.config.ts`), exactly as Stripe
 * signs them. The full path with a real test card is Dao's to try (`manual-qa.md`).
 */

const SECRET = "whsec_e2e_secret_for_tests_only";

function sign(payload: string, secret = SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function ownerOf(eventId: string): Promise<string> {
  const [row] = await getRows("events", `id=eq.${eventId}&select=owner_id`);
  return String(row?.owner_id);
}

interface Payment {
  session: string;
  paymentIntent: string;
}

const newPayment = (): Payment => ({
  session: `cs_test_${randomUUID().replaceAll("-", "")}`,
  paymentIntent: `pi_${randomUUID().replaceAll("-", "")}`,
});

function sessionPayload(
  eventId: string,
  userId: string,
  payment: Payment,
  options: { id?: string; product?: string } = {},
): string {
  return JSON.stringify({
    id: options.id ?? `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: payment.session,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 4900,
        currency: "eur",
        payment_intent: payment.paymentIntent,
        metadata: { event_id: eventId, user_id: userId, product: options.product ?? "event" },
      },
    },
  });
}

const refundPayload = (payment: Payment) =>
  JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type: "charge.refunded",
    data: { object: { object: "charge", refunded: true, payment_intent: payment.paymentIntent } },
  });

function deliver(request: APIRequestContext, payload: string, signature = sign(payload)) {
  return request.post("/api/stripe/webhook", {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: Buffer.from(payload),
  });
}

test.describe("Paiement : boutons et retour de la page Stripe", () => {
  test("R2, R4: l'organisateur voit le prix de l'offre et de la prolongation ; sans Stripe configuré, le refus est dit clairement", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);

    const card = page.getByTestId("plan-card");
    await expect(card.getByTestId("upgrade-button")).toContainText(
      /Passer à l’offre Événement \(49\s€\)/,
    );
    await expect(card.getByTestId("extend-button")).toContainText(/Prolonger de 12 mois \(19\s€\)/);

    await card.getByTestId("upgrade-button").click();
    await expect(card.getByRole("alert")).toContainText("Le paiement n’est pas disponible");
    await expect(page).toHaveURL(new RegExp(`/events/${id}$`));
  });

  test("le retour « annulé » le dit : rien n'a été débité", async ({ page }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}?payment=cancelled`);
    await expect(page.getByTestId("payment-return")).toContainText(
      "Paiement annulé : rien n’a été débité.",
    );
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "free");
    await expectNoAccessibilityViolations(page);
  });

  test("SPEC 13: le webhook arrive pendant que la page attend : l'offre change sans recharger la page", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const payment = newPayment();
    await page.goto(`/events/${id}?payment=success&session_id=${payment.session}`);

    const banner = page.getByTestId("payment-return");
    await expect(banner).toHaveAttribute("data-state", "confirming");
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "free");
    // A mark that a reload would erase.
    await page.evaluate(() => {
      (window as unknown as { __stayed: boolean }).__stayed = true;
    });

    const response = await deliver(request, sessionPayload(id, await ownerOf(id), payment));
    expect(response.status()).toBe(200);

    await expect(banner).toHaveAttribute("data-state", "done", { timeout: 20_000 });
    await expect(banner).toContainText("Merci ! Votre paiement est confirmé");
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "event", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("plan-card")).toContainText("Offre Événement");
    // The quality notice of the free plan is gone, the upgrade button too.
    await expect(page.getByTestId("quality-notice")).toHaveCount(0);
    await expect(page.getByTestId("upgrade-button")).toHaveCount(0);
    await expect(page.getByTestId("extend-button")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __stayed?: boolean }).__stayed)).toBe(
      true,
    );
    // The address no longer carries the payment.
    await expect(page).toHaveURL(new RegExp(`/events/${id}$`));
  });

  test("NF-012: un webhook rejoué deux fois n'a qu'un effet, visible dans « Mon compte »", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const payload = sessionPayload(id, await ownerOf(id), newPayment());

    expect((await deliver(request, payload)).status()).toBe(200);
    const second = await deliver(request, payload);
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({ outcome: "ignored" });

    const rows = await getRows("purchases", `event_id=eq.${id}&select=status,amount_cents`);
    expect(rows).toEqual([{ status: "paid", amount_cents: 4900 }]);

    await page.goto("/account");
    const history = page.getByTestId("purchase-history");
    await expect(history.getByTestId("purchase")).toHaveCount(1);
    await expect(history).toContainText("Offre Événement");
    await expect(history).toContainText("Mariage de Léa et Tom");
    await expect(history).toContainText(/49\s€/);
    await expect(history).toContainText("Payé");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("R6: un remboursement complet remet l'événement en gratuit et le dit dans l'historique", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const payment = newPayment();
    await deliver(request, sessionPayload(id, await ownerOf(id), payment));
    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "event");

    expect((await deliver(request, refundPayload(payment))).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "free");
    await expect(page.getByTestId("upgrade-button")).toBeVisible();

    await page.goto("/account");
    await expect(page.getByTestId("purchase")).toHaveAttribute("data-status", "refunded");
    await expect(page.getByTestId("purchase-history")).toContainText("Remboursé");
  });

  test("S-001: un webhook non signé, mal signé ou modifié est refusé et ne change rien", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const payload = sessionPayload(id, await ownerOf(id), newPayment());

    const unsigned = await request.post("/api/stripe/webhook", {
      headers: { "content-type": "application/json" },
      data: Buffer.from(payload),
    });
    expect(unsigned.status()).toBe(400);
    expect((await deliver(request, payload, sign(payload, "whsec_pas_le_bon"))).status()).toBe(400);
    const altered = payload.replace('"amount_total":4900', '"amount_total":1');
    expect((await deliver(request, altered, sign(payload))).status()).toBe(400);

    expect(await getRows("purchases", `event_id=eq.${id}`)).toEqual([]);
    const [event] = await getRows("events", `id=eq.${id}&select=plan`);
    expect(event?.plan).toBe("free");
  });

  test("S-001: l'historique ne montre que les paiements de l'organisateur connecté", async ({
    page,
    request,
    browser,
  }) => {
    const { id } = await createEvent(page);
    await deliver(request, sessionPayload(id, await ownerOf(id), newPayment()));

    const other = await newVisitor(browser);
    await signIn(other);
    await other.goto("/account");
    await expect(other.getByText("Vous n’avez encore rien acheté.")).toBeVisible();
    await other.context().close();
  });
});
