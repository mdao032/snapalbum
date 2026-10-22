import type { APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { createAnonymousUser, getRows, insertRows, setEventColumns } from "./admin";
import { expect, expectNoAccessibilityViolations, newVisitor, test } from "./fixtures";
import { createEvent } from "./guest-helpers";

/**
 * Life of an event and its e-mails (step 4.3), against the real server and database. E-mails are
 * written to the server log (`EMAIL_MODE=log`) and recorded in `email_log`, which is what these
 * tests read. The scheduled tasks are called with the secret the server was started with. Clocks
 * are simulated by moving the dates in the database, not by waiting.
 */

const CRON = "cron-secret-for-e2e-tests-only-1234";
const WEBHOOK = "whsec_e2e_secret_for_tests_only";
const DAY = 24 * 60 * 60 * 1000;

// A task may have a backlog to clear on a database that has seen thousands of test events.
test.setTimeout(150_000);

const task = (request: APIRequestContext, name: string, secret = CRON) =>
  request.get(`/api/cron/${name}`, {
    headers: { authorization: `Bearer ${secret}` },
    timeout: 140_000,
  });

async function ownerOf(eventId: string): Promise<string> {
  const [row] = await getRows("events", `id=eq.${eventId}&select=owner_id`);
  return String(row?.owner_id);
}

async function eventRow(eventId: string) {
  const [row] = await getRows("events", `id=eq.${eventId}&select=status,plan,deletion_reason`);
  return row;
}

const emails = (eventId: string, kind: string) =>
  getRows(
    "email_log",
    `event_id=eq.${eventId}&kind=eq.${kind}&select=recipient_key,status,provider`,
  );

/** Waits until `count` messages of this kind have really gone out (a claim alone is not sent). */
async function waitForEmail(eventId: string, kind: string, count = 1) {
  await expect
    .poll(async () => (await emails(eventId, kind)).filter((row) => row.status === "sent").length, {
      message: `no "${kind}" e-mail sent`,
      timeout: 20_000,
    })
    .toBe(count);
}

function signedPayment(eventId: string, userId: string) {
  const payload = JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${randomUUID().replaceAll("-", "")}`,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 4900,
        currency: "eur",
        payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
        metadata: { event_id: eventId, user_id: userId, product: "event" },
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK).update(`${timestamp}.${payload}`).digest("hex");
  return { payload, signature: `t=${timestamp},v1=${signature}` };
}

async function addGuest(eventId: string, overrides: Record<string, unknown> = {}) {
  const user = await createAnonymousUser();
  await insertRows("guests", [
    {
      event_id: eventId,
      auth_user_id: user.id,
      terms_accepted_at: new Date().toISOString(),
      ...overrides,
    },
  ]);
  return user;
}

test.describe("Tâches planifiées : le secret", () => {
  test("S-001: sans le secret, avec un autre ou sans en-tête, aucune tâche ne tourne", async ({
    request,
  }) => {
    for (const name of ["expire-events", "reminders", "daily-recap", "cleanup-uploads"]) {
      expect((await request.get(`/api/cron/${name}`)).status()).toBe(401);
      expect((await task(request, name, "pas-le-bon-secret-du-tout-123")).status()).toBe(401);
    }
    const unknown = await task(request, "delete-everything");
    expect(unknown.status()).toBe(404);
  });

  test("les quatre tâches répondent avec le secret", async ({ request }) => {
    for (const name of ["expire-events", "reminders", "daily-recap", "cleanup-uploads"]) {
      const response = await task(request, name);
      expect(response.status(), name).toBe(200);
      expect((await response.json()).task).toBe(name);
    }
  });
});

test.describe("E-mails envoyés par les gestes de l'organisateur", () => {
  test("SPEC 14: la création du premier événement envoie le message de bienvenue, une seule fois", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    await waitForEmail(id, "welcome");
    expect(await emails(id, "welcome")).toEqual([
      { recipient_key: await ownerOf(id), status: "sent", provider: "console" },
    ]);
  });

  test("R1: l'invité reçoit « l'organisateur a été prévenu », et c'est vrai : un seul e-mail, même après plusieurs refus", async ({
    page,
    request,
  }) => {
    const { id, code } = await createEvent(page);
    await setEventColumns(id, { media_count: 200 });
    const guest = await addGuest(id);
    const body = {
      eventCode: code,
      kind: "photo",
      sha256: "a".repeat(63) + "1",
      mimeType: "image/jpeg",
      extension: "jpg",
      bytes: 1_000_000,
      displayBytes: 4000,
      thumbBytes: 800,
      previewFormat: "webp",
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request.post("/api/uploads/reserve", {
        headers: { Authorization: `Bearer ${guest.token}` },
        data: { ...body, sha256: String(attempt).repeat(64) },
      });
      expect(response.status()).toBe(409);
    }
    await waitForEmail(id, "quota_reached");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await emails(id, "quota_reached")).toHaveLength(1);
  });

  test("R5: demander la suppression envoie la confirmation avec la date de la purge", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "Supprimer l’événement" }).click();
    await page.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByText(/Suppression prévue le/)).toBeVisible();
    await waitForEmail(id, "deletion_requested");
  });

  test("F-044: « L'album est prêt » envoie le lien aux seuls invités qui l'ont demandé, une fois", async ({
    page,
  }) => {
    const { id } = await createEvent(page);
    const asked = await addGuest(id, {
      notify_email: "demande@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    await addGuest(id, { notify_email: "sans-accord@example.test" });
    await addGuest(id);

    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "L’album est prêt" }).click();
    await page.getByRole("button", { name: "Oui, l’album est prêt" }).click();
    await expect(page.getByTestId("album-ready-done")).toBeVisible();

    await waitForEmail(id, "album_ready");
    const sent = await getRows(
      "email_log",
      `event_id=eq.${id}&kind=eq.album_ready&select=recipient_key`,
    );
    const [guestRow] = await getRows("guests", `auth_user_id=eq.${asked.id}&select=id`);
    expect(sent).toEqual([{ recipient_key: String(guestRow?.id) }]);
  });
});

test.describe("Expiration, rappels, récapitulatif, purge", () => {
  test("R3: le rappel d'expiration part une fois, quel que soit le nombre d'exécutions", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    await setEventColumns(id, { expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    for (let run = 0; run < 3; run += 1) {
      expect((await task(request, "reminders")).status()).toBe(200);
    }
    await waitForEmail(id, "expiry_reminder_7");
    expect(await emails(id, "expiry_reminder_1")).toHaveLength(0);

    await setEventColumns(id, { expires_at: new Date(Date.now() + 0.5 * DAY).toISOString() });
    await task(request, "reminders");
    await task(request, "reminders");
    await waitForEmail(id, "expiry_reminder_1");
  });

  test("SPEC 14: le lendemain de la fête, l'organisateur reçoit son récapitulatif, une seule fois", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    await setEventColumns(id, { event_date: twoDaysAgo });
    await task(request, "daily-recap");
    await task(request, "daily-recap");
    await waitForEmail(id, "recap_next_day");
  });

  test("SPEC 9.2: un album échu se ferme aux invités, reste récupérable en payant, puis est purgé", async ({
    page,
    request,
    browser,
  }) => {
    const { id, code } = await createEvent(page);
    const guest = await addGuest(id, {
      notify_email: "efface@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    await setEventColumns(id, { expires_at: new Date(Date.now() - DAY).toISOString() });

    const expired = await task(request, "expire-events");
    expect((await expired.json()).expired).toBeGreaterThanOrEqual(1);
    expect(await eventRow(id)).toMatchObject({
      status: "pending_deletion",
      deletion_reason: "expired",
    });
    // The e-mail address a guest left is erased with the expiry (SPEC 7).
    const [after] = await getRows(
      "guests",
      `auth_user_id=eq.${guest.id}&select=notify_email,notify_consent_at`,
    );
    expect(after).toEqual({ notify_email: null, notify_consent_at: null });

    // Guests no longer see the event; the organiser sees why, and how to bring it back.
    const visitor = await newVisitor(browser);
    await visitor.goto(`/e/${code}`);
    await expect(visitor.getByText("Cette page est introuvable")).toBeVisible();
    await visitor.context().close();

    await page.goto(`/events/${id}`);
    await expect(page.getByTestId("expired-card")).toContainText("Cet album a expiré");
    await expect(page.getByRole("button", { name: "Annuler la suppression" })).toHaveCount(0);
    await expect(page.getByTestId("upgrade-button")).toBeVisible();
    await expectNoAccessibilityViolations(page);

    // Paying within the 7 days brings the album back.
    const { payload, signature } = signedPayment(id, await ownerOf(id));
    const paid = await request.post("/api/stripe/webhook", {
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      data: Buffer.from(payload),
    });
    expect(paid.status()).toBe(200);
    expect(await eventRow(id)).toMatchObject({ status: "active", plan: "event" });
    await page.reload();
    await expect(page.getByTestId("expired-card")).toHaveCount(0);
    await expect(page.getByTestId("plan-card")).toHaveAttribute("data-plan", "event");
    await waitForEmail(id, "payment_confirmed");
  });

  test("R5, SPEC 9.2: sept jours plus tard, l'album est purgé : base, stockage et trace d'audit", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    await setEventColumns(id, {
      status: "pending_deletion",
      deleted_at: new Date(Date.now() - 8 * DAY).toISOString(),
      deletion_reason: "user",
    });
    const response = await task(request, "expire-events");
    expect((await response.json()).purged).toContain(id);
    expect(await getRows("events", `id=eq.${id}`)).toEqual([]);
    const audit = await getRows("audit_log", `target_id=eq.${id}&action=eq.event_purged`);
    expect(audit).toHaveLength(1);

    const gone = await page.goto(`/events/${id}`);
    expect(gone?.status()).toBe(404);
  });

  test("R5: une suppression de moins de 7 jours n'est pas purgée et peut être annulée", async ({
    page,
    request,
  }) => {
    const { id } = await createEvent(page);
    await page.goto(`/events/${id}`);
    await page.getByRole("button", { name: "Supprimer l’événement" }).click();
    await page.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByText(/Suppression prévue le/)).toBeVisible();
    await task(request, "expire-events");
    expect(await getRows("events", `id=eq.${id}`)).toHaveLength(1);
    await page.getByRole("button", { name: "Annuler la suppression" }).click();
    await expect(page.getByText(/Suppression prévue le/)).toHaveCount(0);
    expect(await eventRow(id)).toMatchObject({ status: "active" });
  });
});
