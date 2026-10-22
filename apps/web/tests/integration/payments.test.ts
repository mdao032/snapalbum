import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { createEvent } from "@/server/events";
import { handleStripeEvent } from "@/server/payments";

/**
 * Payments on the real database: a webhook replayed, or racing itself and the return page, has one
 * effect (SPEC 13, NF-012); a full refund takes it back (R6). Needs `pnpm db:start`.
 */

function localEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const env = localEnv();
const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const createdUsers: string[] = [];
const createdEvents: string[] = [];

async function newEvent(eventDate = "2026-09-12") {
  const owner = await admin.auth.admin.createUser({
    email: `pay-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (owner.error || !owner.data.user) throw owner.error ?? new Error("no user");
  createdUsers.push(owner.data.user.id);
  const created = await createEvent(admin, owner.data.user.id, {
    title: "Mariage de Léa et Tom",
    eventDate,
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return { eventId: created.event.id, userId: owner.data.user.id };
}

const sessionEvent = (
  who: { eventId: string; userId: string },
  options: { eventId?: string; sessionId?: string; paymentIntent?: string; product?: string } = {},
): Stripe.Event =>
  ({
    id: options.eventId ?? `evt_${randomUUID()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: options.sessionId ?? `cs_test_${randomUUID().replaceAll("-", "")}`,
        payment_status: "paid",
        amount_total: 4900,
        currency: "eur",
        payment_intent: options.paymentIntent ?? `pi_${randomUUID()}`,
        metadata: {
          event_id: who.eventId,
          user_id: who.userId,
          product: options.product ?? "event",
        },
      },
    },
  }) as unknown as Stripe.Event;

const refundEvent = (paymentIntent: string, refunded = true): Stripe.Event =>
  ({
    id: `evt_${randomUUID()}`,
    type: "charge.refunded",
    data: { object: { refunded, payment_intent: paymentIntent } },
  }) as unknown as Stripe.Event;

async function purchases(eventId: string) {
  const { data, error } = await admin
    .from("purchases")
    .select("status, product, amount_cents")
    .eq("event_id", eventId);
  if (error) throw error;
  return data;
}

async function eventRow(eventId: string) {
  const { data, error } = await admin
    .from("events")
    .select("plan, expires_at")
    .eq("id", eventId)
    .single();
  if (error) throw error;
  return data;
}

afterAll(async () => {
  for (const id of createdEvents) await admin.from("events").delete().eq("id", id);
  await admin.from("purchases").delete().in("user_id", createdUsers);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
}, 60_000);

describe("NF-012: un webhook rejoué, ou simultané, n'a qu'un effet", () => {
  it("le paiement passe l'événement en `event` ; rejoué deux fois, un seul achat et la même date", async () => {
    const who = await newEvent();
    const event = sessionEvent(who);

    expect(await handleStripeEvent(admin, event)).toBe("applied");
    const first = await eventRow(who.eventId);
    expect(first.plan).toBe("event");
    expect(Date.parse(first.expires_at!)).toBeGreaterThan(Date.now() + 360 * 24 * 3600 * 1000);

    expect(await handleStripeEvent(admin, event)).toBe("ignored");
    expect(await handleStripeEvent(admin, event)).toBe("ignored");
    expect(await purchases(who.eventId)).toEqual([
      { status: "paid", product: "event", amount_cents: 4900 },
    ]);
    expect(await eventRow(who.eventId)).toEqual(first);
  });

  it("dix webhooks simultanés pour la même session ne créent qu'un achat", async () => {
    const who = await newEvent();
    const sessionId = `cs_test_${randomUUID().replaceAll("-", "")}`;
    const paymentIntent = `pi_${randomUUID()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        handleStripeEvent(
          admin,
          sessionEvent(who, {
            sessionId,
            paymentIntent,
            eventId: `evt_race_${randomUUID()}_${index}`,
          }),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === "applied")).toHaveLength(1);
    expect(await purchases(who.eventId)).toHaveLength(1);
  });

  it("R4: deux prolongations différentes s'ajoutent, la même rejouée non", async () => {
    const who = await newEvent();
    await handleStripeEvent(admin, sessionEvent(who));
    const base = Date.parse((await eventRow(who.eventId)).expires_at!);

    const extension = sessionEvent(who, { product: "extension" });
    await handleStripeEvent(admin, extension);
    await handleStripeEvent(admin, extension);
    const once = Date.parse((await eventRow(who.eventId)).expires_at!);
    expect(once - base).toBeGreaterThan(360 * 24 * 3600 * 1000);

    await handleStripeEvent(admin, sessionEvent(who, { product: "extension" }));
    const twice = Date.parse((await eventRow(who.eventId)).expires_at!);
    expect(twice - once).toBeGreaterThan(360 * 24 * 3600 * 1000);
    expect(await purchases(who.eventId)).toHaveLength(3);
  });

  it("un paiement pour un événement disparu fait échouer le traitement : Stripe réessaiera et l'audit s'en souvient", async () => {
    const who = await newEvent();
    const gone = { eventId: randomUUID(), userId: who.userId };
    await expect(handleStripeEvent(admin, sessionEvent(gone))).rejects.toThrow(/event_not_found/);
    const { data } = await admin.from("audit_log").select("action").eq("target_id", gone.eventId);
    expect(data).toEqual([{ action: "purchase_orphan" }]);
  });
});

describe("R6: un remboursement complet reprend ses effets", () => {
  it("l'événement redevient gratuit, avec la conservation gratuite, une seule fois", async () => {
    const who = await newEvent("2026-09-12");
    const paymentIntent = `pi_${randomUUID()}`;
    await handleStripeEvent(admin, sessionEvent(who, { paymentIntent }));
    expect((await eventRow(who.eventId)).plan).toBe("event");

    // A partial refund changes nothing.
    await handleStripeEvent(admin, refundEvent(paymentIntent, false));
    expect((await eventRow(who.eventId)).plan).toBe("event");

    await handleStripeEvent(admin, refundEvent(paymentIntent));
    await handleStripeEvent(admin, refundEvent(paymentIntent));
    const after = await eventRow(who.eventId);
    expect(after.plan).toBe("free");
    expect(after.expires_at).toBe("2026-10-13T00:00:00+00:00");
    expect(await purchases(who.eventId)).toEqual([
      { status: "refunded", product: "event", amount_cents: 4900 },
    ]);
    const { data } = await admin
      .from("audit_log")
      .select("action")
      .eq("target_id", who.eventId)
      .eq("action", "purchase_refunded");
    expect(data).toHaveLength(1);
  });
});
