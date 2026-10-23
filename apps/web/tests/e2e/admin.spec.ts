import type { APIRequestContext, Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createAnonymousUser, getRows, insertRows, patchRows } from "./admin";
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
 * The administrator area (step 5.3, F-090 to F-092, SPEC 9.3), against the real server and database.
 * The role is given in the database, like an owner would: nobody can give it to themselves.
 */

const CRON = "cron-secret-for-e2e-tests-only-1234";
test.setTimeout(120_000);

/** Signs in, then gives the account the administrator role; returns its identifier and address. */
async function signInAsAdmin(page: Page): Promise<{ id: string; email: string }> {
  await signIn(page);
  const data = await (await page.request.get("/api/account/export")).json();
  await patchRows("profiles", `user_id=eq.${data.account.id}`, { role: "admin" });
  return { id: data.account.id, email: data.account.email };
}

async function ownerOf(eventId: string): Promise<string> {
  const [row] = await getRows("events", `id=eq.${eventId}&select=owner_id`);
  return String(row?.owner_id);
}

/** An event of an ordinary organiser, made by another browser, with the data an administrator looks at. */
async function someonesEvent(browser: Parameters<typeof newVisitor>[0]) {
  const organiser = await newVisitor(browser);
  const { id, code } = await createEvent(organiser);
  await organiser.context().close();
  return { id, code };
}

/** A photo with `count` open reports on an event, written straight in the database. */
async function reportedMedia(eventId: string, count = 2) {
  const guest = await createAnonymousUser();
  const [guestRow] = await insertRows("guests", [
    {
      event_id: eventId,
      auth_user_id: guest.id,
      terms_accepted_at: new Date().toISOString(),
    },
  ]);
  const mediaId = randomUUID();
  await insertRows("media", [
    {
      id: mediaId,
      event_id: eventId,
      guest_id: guestRow?.id,
      kind: "photo",
      status: "ready",
      moderation: "approved",
      sha256: randomBytes(32).toString("hex"),
      mime_type: "image/jpeg",
    },
  ]);
  await insertRows(
    "reports",
    Array.from({ length: count }, (_, index) => ({
      media_id: mediaId,
      reason: index === 0 ? "inappropriate" : "other",
      reporter_fingerprint: randomBytes(32).toString("hex"),
    })),
  );
  return mediaId;
}

test.describe("F-090: accès réservé", () => {
  test("S-001: sans session on va se connecter, un organisateur ordinaire reçoit une page introuvable", async ({
    page,
    browser,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);

    const organiser = await newVisitor(browser);
    await signIn(organiser);
    for (const path of [
      "/admin",
      "/admin/events",
      "/admin/organisers",
      "/admin/payments",
      "/admin/reports",
      "/admin/beta",
    ]) {
      const response = await organiser.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(organiser.getByText("Cette page est introuvable")).toBeVisible();
    }
    await organiser.context().close();
  });

  test("un administrateur dont le compte est en suppression perd l'accès", async ({ page }) => {
    const { id } = await signInAsAdmin(page);
    expect((await page.goto("/admin"))?.status()).toBe(200);
    await patchRows("profiles", `user_id=eq.${id}`, { deleted_at: new Date().toISOString() });
    expect((await page.goto("/admin"))?.status()).toBe(404);
  });
});

test.describe("F-092: aperçu", () => {
  test("les chiffres de la plateforme s'affichent, accessibles, sans défilement horizontal", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin");
    for (const id of [
      "stat-events",
      "stat-active",
      "stat-conversion",
      "stat-media",
      "stat-storage",
      "stat-cost",
      "stat-revenue",
      "stat-organisers",
      "stat-reports",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("stat-conversion")).toContainText("%");
    await expect(page.getByTestId("stat-storage")).toContainText("STORAGE_ALERT_GB");
    await expect(page.getByTestId("stat-cost")).toContainText("Cloudflare");
    await expect(page.getByRole("link", { name: "Aperçu" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("section 12: l'aperçu est complet en anglais", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin area" })).toBeVisible();
    await expect(page.getByTestId("stat-events")).toContainText("Events created");
    await expectNoAccessibilityViolations(page);
  });

  test("SPEC 9.3: la tâche quotidienne dit qu'aucun seuil de stockage n'est configuré", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    const response = await request.get("/api/cron/daily-recap", {
      headers: { authorization: `Bearer ${CRON}` },
      timeout: 110_000,
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).storageAlert).toBe("no_threshold");
  });
});

test.describe("F-090: listes", () => {
  test("on retrouve un événement par son code, on ouvre sa fiche, l'organisateur est montré", async ({
    page,
    browser,
  }) => {
    const { id, code } = await someonesEvent(browser);
    await signInAsAdmin(page);

    await page.goto("/admin/events");
    await page.getByRole("searchbox", { name: "Rechercher" }).fill(code);
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(page.getByTestId("admin-count")).toHaveText("1 événement");
    const row = page.getByTestId("admin-event-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Mariage de Léa et Tom");
    await expect(row).toContainText("@example.test");
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await row.getByRole("link", { name: /Mariage de Léa et Tom/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${id}$`));
    await expect(page.getByTestId("admin-event")).toContainText(code);
    await expectNoAccessibilityViolations(page);
  });

  test("une recherche sans résultat le dit ; un % n'est pas un joker", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/admin/events?q=${encodeURIComponent("%%%")}`);
    await expect(page.getByTestId("admin-count")).toHaveText("Aucun événement");
    await expect(page.getByText("Aucun événement ne correspond.")).toBeVisible();
  });

  test("les organisateurs se listent et se cherchent par adresse, un administrateur est signalé", async ({
    page,
  }) => {
    const { email } = await signInAsAdmin(page);
    await page.goto(`/admin/organisers?q=${encodeURIComponent(email)}`);
    const row = page.getByTestId("admin-organiser-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(email);
    await expect(row).toContainText("Administrateur");
    await expectNoAccessibilityViolations(page);
  });

  test("les paiements se listent avec le lien pour rembourser dans Stripe", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    const owner = await ownerOf(id);
    const intent = `pi_${randomUUID().replaceAll("-", "")}`;
    await insertRows("purchases", [
      {
        event_id: id,
        event_title: "Mariage de Léa et Tom",
        user_id: owner,
        stripe_checkout_session_id: `cs_test_${randomUUID().replaceAll("-", "")}`,
        stripe_payment_intent_id: intent,
        amount_cents: 4900,
        currency: "eur",
        product: "event",
      },
    ]);
    await signInAsAdmin(page);
    await page.goto("/admin/payments");

    const row = page
      .getByTestId("admin-payment-row")
      .filter({ has: page.locator(`a[href$="${intent}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/49\s€/);
    await expect(row.getByRole("link", { name: /Rembourser dans Stripe/ })).toHaveAttribute(
      "href",
      `https://dashboard.stripe.com/test/payments/${intent}`,
    );
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("F-091: gestes sur un événement", () => {
  test("suspendre ferme l'événement aux invités, lever la suspension le rouvre, une trace garde l'administrateur", async ({
    page,
    browser,
  }) => {
    const { id, code } = await someonesEvent(browser);
    const { id: adminId } = await signInAsAdmin(page);
    await page.goto(`/admin/events/${id}`);

    await page.getByRole("button", { name: "Suspendre l’événement" }).click();
    await expect(page.getByRole("button", { name: "Lever la suspension" })).toBeVisible();
    const [suspended] = await getRows("events", `id=eq.${id}&select=status`);
    expect(suspended?.status).toBe("suspended");

    const guest = await newVisitor(browser);
    await guest.goto(`/e/${code}`);
    await expect(guest.getByText("Cette page est introuvable")).toBeVisible();
    await guest.context().close();

    await page.getByRole("button", { name: "Lever la suspension" }).click();
    // The page comes back with the other button: the first confirmation is not the second one.
    await expect(page.getByRole("button", { name: "Suspendre l’événement" })).toBeVisible();
    const [lifted] = await getRows("events", `id=eq.${id}&select=status`);
    expect(lifted?.status).toBe("active");

    const audit = await getRows(
      "audit_log",
      `target_id=eq.${id}&select=action,actor_id&order=created_at`,
    );
    expect(audit.map((line) => line.action)).toEqual([
      "admin.event.suspend",
      "admin.event.unsuspend",
    ]);
    expect(new Set(audit.map((line) => line.actor_id))).toEqual(new Set([adminId]));
  });

  test("prolonger de 3 mois repousse la fin de la conservation, sans paiement", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    const [before] = await getRows("events", `id=eq.${id}&select=expires_at`);
    await signInAsAdmin(page);
    await page.goto(`/admin/events/${id}`);
    await page.getByLabel("Prolonger la conservation").selectOption("3");
    await page.getByRole("button", { name: "Prolonger", exact: true }).click();
    await expect(page.getByText("C’est fait.")).toBeVisible();

    const [after] = await getRows("events", `id=eq.${id}&select=expires_at`);
    const gain =
      new Date(String(after?.expires_at)).getTime() -
      new Date(String(before?.expires_at)).getTime();
    expect(gain).toBeGreaterThan(80 * 24 * 3600 * 1000);
    expect(gain).toBeLessThan(100 * 24 * 3600 * 1000);
    expect(await getRows("purchases", `event_id=eq.${id}&select=id`)).toEqual([]);
  });

  test("une prolongation impossible (offre Pro) est dite, rien ne change", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    await patchRows("events", `id=eq.${id}`, { plan: "pro", expires_at: null });
    await signInAsAdmin(page);
    await page.goto(`/admin/events/${id}`);
    await expect(page.getByRole("button", { name: "Prolonger", exact: true })).toHaveCount(0);
    await page.goto(`/admin/events/${id}?failed=1`);
    await expect(page.getByText("Impossible dans l’état actuel de l’événement.")).toBeVisible();
  });

  test("une fiche d'événement inconnue est introuvable", async ({ page }) => {
    await signInAsAdmin(page);
    expect((await page.goto(`/admin/events/${randomUUID()}`))?.status()).toBe(404);
    expect((await page.goto("/admin/events/pas-un-identifiant"))?.status()).toBe(404);
  });
});

test.describe("F-090, F-091: signalements", () => {
  test("un média signalé : masquer le cache, ignorer le garde, supprimer demande une confirmation puis l'efface", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    const hide = await reportedMedia(id);
    const dismiss = await reportedMedia(id, 1);
    const remove = await reportedMedia(id, 1);
    await signInAsAdmin(page);
    await page.goto(`/admin/events/${id}`);
    await expect(page.getByTestId("admin-report")).toHaveCount(3);
    await expectNoAccessibilityViolations(page);

    const card = (mediaId: string) =>
      page
        .getByTestId("admin-report")
        .filter({ has: page.locator(`input[value="${mediaId}"]`) })
        .first();

    await expect(card(hide)).toContainText("2 signalements");
    await expect(card(hide)).toContainText("Contenu inapproprié");
    await card(hide).getByRole("button", { name: "Masquer" }).click();
    await expect(page.getByText("C’est fait.")).toBeVisible();
    await expect(card(hide).getByRole("button", { name: "Masquer" })).toHaveCount(0);
    const [hidden] = await getRows("media", `id=eq.${hide}&select=status`);
    expect(hidden?.status).toBe("hidden");

    await card(dismiss).getByRole("button", { name: "Ignorer" }).click();
    // The hidden one and the dismissed one are gone from the list: only the third remains.
    await expect(page.getByTestId("admin-report")).toHaveCount(1);
    const [kept] = await getRows("media", `id=eq.${dismiss}&select=status`);
    expect(kept?.status).toBe("ready");
    const open = await getRows("reports", `media_id=eq.${dismiss}&resolved_at=is.null&select=id`);
    expect(open).toEqual([]);

    // Deleting is a second step: nothing happens before the confirmation.
    await card(remove).getByText("Supprimer définitivement").click();
    await expect(card(remove)).toContainText("sans retour possible");
    const [still] = await getRows("media", `id=eq.${remove}&select=status`);
    expect(still?.status).toBe("ready");
    await card(remove).getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByTestId("admin-report")).toHaveCount(0);
    const [gone] = await getRows("media", `id=eq.${remove}&select=status`);
    expect(gone?.status).toBe("deleted");

    const audit = await getRows(
      "audit_log",
      `target_id=eq.${id}&action=like.admin.media.*&select=action`,
    );
    expect(audit.map((line) => line.action).sort()).toEqual([
      "admin.media.delete",
      "admin.media.hide",
    ]);
  });

  test("la page des signalements de la plateforme montre un signalement ouvert et rend compte du résultat", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    const media = await reportedMedia(id);
    await signInAsAdmin(page);
    await page.goto("/admin/reports");

    const card = page
      .getByTestId("admin-report")
      .filter({ has: page.locator(`input[value="${media}"]`) });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("link", { name: "Mariage de Léa et Tom" })).toHaveAttribute(
      "href",
      new RegExp(`/admin/events/${id}$`),
    );
    await card.getByRole("button", { name: "Ignorer" }).click();
    await expect(page).toHaveURL(/\/admin\/reports\?done=1$/);
    await expect(page.getByText("C’est fait.")).toBeVisible();
    await expect(card).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test("un retour vers une adresse extérieure à l'espace administrateur est ignoré", async ({
    page,
    browser,
  }) => {
    const { id } = await someonesEvent(browser);
    const media = await reportedMedia(id, 1);
    await signInAsAdmin(page);
    await page.goto("/admin/reports");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      for (const input of document.querySelectorAll<HTMLInputElement>("input[name=returnTo]")) {
        input.value = "https://evil.example.test/steal";
      }
    });
    await page
      .getByTestId("admin-report")
      .filter({ has: page.locator(`input[value="${media}"]`) })
      .getByRole("button", { name: "Ignorer" })
      .click();
    await expect(page).toHaveURL(/\/admin\?done=1$/);
  });
});
