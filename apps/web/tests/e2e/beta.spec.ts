import type { Page } from "@playwright/test";
import { getRows, patchRows } from "./admin";
import {
  expect,
  expectNoAccessibilityViolations,
  expectNoHorizontalScroll,
  newVisitor,
  signIn,
  test,
} from "./fixtures";

/**
 * Field beta (step 6.1): an administrator makes a code for an organiser's address, the organiser
 * enters it on a free event and gets the Event plan without paying.
 */
test.setTimeout(120_000);

async function signInAsAdmin(page: Page): Promise<void> {
  await signIn(page);
  const data = await (await page.request.get("/api/account/export")).json();
  await patchRows("profiles", `user_id=eq.${data.account.id}`, { role: "admin" });
}

/** An organiser signs in and creates a free event; returns their address and the event's id. */
async function organiserWithEvent(page: Page): Promise<{ email: string; eventId: string }> {
  const email = await signIn(page);
  await page.goto("/events/new");
  await page.getByLabel("Nom de l’événement").fill("Anniversaire de Mamie");
  await page.getByRole("button", { name: "Créer mon événement" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  return { email, eventId: page.url().split("/").pop() ?? "" };
}

async function makeCode(admin: Page, email: string): Promise<string> {
  await admin.goto("/admin/beta");
  await admin.getByLabel("Adresse e-mail de l’organisateur").fill(email);
  await admin.getByTestId("beta-create").click();
  await expect(admin.getByText("C’est fait.")).toBeVisible();
  const row = admin.getByTestId("beta-row").filter({ hasText: email });
  return (await row.getByTestId("beta-code").innerText()).replace("-", "");
}

test.describe("6.1: code d'invitation de la bêta", () => {
  test("6.1: l'administrateur crée un code, l'organisateur l'utilise et obtient l'offre Événement sans payer", async ({
    page,
    browser,
  }) => {
    const organiser = await newVisitor(browser);
    const { email, eventId } = await organiserWithEvent(organiser);
    await expect(organiser.getByTestId("plan-card")).toHaveAttribute("data-plan", "free");
    await expect(organiser.getByTestId("beta-code-form")).toBeVisible();

    await signInAsAdmin(page);
    const code = await makeCode(page, email);
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    // Typed in lower case with a dash, as a person would.
    await organiser.reload();
    await organiser
      .getByLabel("Code d’invitation")
      .fill(`${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase());
    await organiser.getByRole("button", { name: "Utiliser mon code" }).click();

    await expect(organiser.getByText(/Votre code est accepté/)).toBeVisible();
    await expect(organiser.getByTestId("plan-card")).toHaveAttribute("data-plan", "event");
    await expect(organiser.getByTestId("beta-code-form")).toHaveCount(0);
    await expectNoAccessibilityViolations(organiser);
    await expectNoHorizontalScroll(organiser);

    const [event] = await getRows("events", `id=eq.${eventId}&select=plan,expires_at`);
    expect(event?.plan).toBe("event");
    expect(event?.expires_at).not.toBeNull();
    const purchases = await getRows(
      "purchases",
      `event_id=eq.${eventId}&select=source,amount_cents`,
    );
    expect(purchases).toEqual([{ source: "beta_invitation", amount_cents: 0 }]);

    // The administrator sees it was used, and it no longer shows the code.
    await page.goto("/admin/beta");
    const row = page.getByTestId("beta-row").filter({ hasText: email });
    await expect(row).toHaveAttribute("data-state", "redeemed");
    await expect(row.getByText("Anniversaire de Mamie")).toBeVisible();
    await expect(row.getByTestId("beta-code")).toHaveCount(0);
    await organiser.context().close();
  });

  test("6.1: un mauvais code, le code d'un autre et un code annulé sont refusés avec une explication", async ({
    page,
    browser,
  }) => {
    const organiser = await newVisitor(browser);
    const { email, eventId } = await organiserWithEvent(organiser);
    const stranger = await newVisitor(browser);
    const strangerEvent = await organiserWithEvent(stranger);

    await signInAsAdmin(page);
    const code = await makeCode(page, email);
    const enter = async (visitor: Page, value: string, url: string) => {
      await visitor.goto(url);
      await visitor.getByLabel("Code d’invitation").fill(value);
      await visitor.getByRole("button", { name: "Utiliser mon code" }).click();
    };

    await enter(organiser, "ABC", `/events/${eventId}`);
    await expect(organiser.getByText(/Ce code est incomplet/)).toBeVisible();
    await enter(organiser, "ZZZZZZZZZZ", `/events/${eventId}`);
    await expect(organiser.getByText(/Ce code n’est pas valide pour votre compte/)).toBeVisible();
    await expectNoAccessibilityViolations(organiser);

    // A real code, but made for someone else: the answer is the same as for an unknown one.
    await enter(stranger, code, `/events/${strangerEvent.eventId}`);
    await expect(stranger.getByText(/Ce code n’est pas valide pour votre compte/)).toBeVisible();
    const [untouched] = await getRows("events", `id=eq.${strangerEvent.eventId}&select=plan`);
    expect(untouched?.plan).toBe("free");

    // Cancelled by the administrator: refused, and the code no longer shows in the list.
    await page.goto("/admin/beta");
    const row = page.getByTestId("beta-row").filter({ hasText: email });
    await row.getByTestId("beta-revoke").click();
    await expect(page.getByText("C’est fait.")).toBeVisible();
    await expect(page.getByTestId("beta-row").filter({ hasText: email })).toHaveAttribute(
      "data-state",
      "revoked",
    );
    await enter(organiser, code, `/events/${eventId}`);
    await expect(organiser.getByText(/Ce code a été annulé/)).toBeVisible();

    await organiser.context().close();
    await stranger.context().close();
  });

  test("6.1: une adresse déjà invitée est signalée ; l'anglais est complet", async ({
    page,
    browser,
  }) => {
    const organiser = await newVisitor(browser);
    const { email, eventId } = await organiserWithEvent(organiser);
    await signInAsAdmin(page);
    await makeCode(page, email);

    await page.getByLabel("Adresse e-mail de l’organisateur").fill(email);
    await page.getByTestId("beta-create").click();
    await expect(page.getByText(/déjà une invitation ouverte/)).toBeVisible();

    await page.goto("/en/admin/beta");
    await expect(page.getByRole("heading", { name: "Field beta" })).toBeVisible();
    await expect(page.getByLabel("Organiser’s e-mail address")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);

    await organiser.goto(`/en/events/${eventId}`);
    await expect(organiser.getByText("Do you have an invitation code?")).toBeVisible();
    await organiser.context().close();
  });
});
