import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable, type TestDb } from "./harness";

interface Answer {
  ok: boolean;
  result?: string;
  reason?: string;
  purchase_id?: string;
  plan?: string;
  expires_at?: string;
}

const session = () => `cs_test_${randomUUID().replaceAll("-", "")}`;

async function purchase(
  db: Queryable,
  change: {
    eventId: string;
    userId: string;
    sessionId?: string;
    paymentIntent?: string | null;
    product?: "event" | "extension";
    months?: number;
    stripeEventId?: string | null;
  },
): Promise<Answer> {
  const { rows } = await db.query<{ answer: Answer }>(
    `select public.apply_purchase($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as answer`,
    [
      change.eventId,
      change.userId,
      change.sessionId ?? session(),
      change.paymentIntent === undefined ? `pi_${randomUUID()}` : change.paymentIntent,
      4900,
      "eur",
      change.product ?? "event",
      change.months ?? 12,
      change.stripeEventId ?? null,
      "checkout.session.completed",
    ],
  );
  return rows[0]!.answer;
}

async function refund(
  db: Queryable,
  paymentIntent: string,
  stripeEventId: string | null = null,
): Promise<Answer> {
  const { rows } = await db.query<{ answer: Answer }>(
    `select public.apply_refund($1, 12, '2026-10-12T00:00:00Z', $2, 'charge.refunded') as answer`,
    [paymentIntent, stripeEventId],
  );
  return rows[0]!.answer;
}

async function eventRow(db: Queryable, id: string) {
  const { rows } = await db.query<{ plan: string; expires_at: Date | null }>(
    "select plan, expires_at from public.events where id = $1",
    [id],
  );
  return rows[0]!;
}

async function setup(db: TestDb, overrides: Record<string, unknown> = {}) {
  const owner = await db.createUser();
  const event = await db.createEvent(owner, overrides);
  return { owner, event };
}

describe("R2: un paiement relève l'offre et prolonge la conservation", () => {
  it("l'offre Événement passe l'événement en `event`, conservé 12 mois après le plus tardif de l'achat et de la date", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, { event_date: "2020-01-01" });
      const answer = await purchase(db, { eventId: event, userId: owner });
      expect(answer).toMatchObject({ ok: true, result: "applied", plan: "event" });

      const after = await eventRow(db, event);
      expect(after.plan).toBe("event");
      const expected = new Date();
      expected.setUTCMonth(expected.getUTCMonth() + 12);
      expect(Math.abs(after.expires_at!.getTime() - expected.getTime())).toBeLessThan(60_000);
    }));

  it("un album acheté longtemps à l'avance est conservé 12 mois après la fête, pas après l'achat", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, {
        event_date: "2099-06-01",
        expires_at: "2099-07-01T00:00:00Z",
      });
      await purchase(db, { eventId: event, userId: owner });
      const after = await eventRow(db, event);
      expect(after.expires_at!.toISOString()).toBe("2100-06-01T00:00:00.000Z");
    }));

  it("une conservation déjà plus longue n'est jamais raccourcie", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, {
        event_date: "2020-01-01",
        expires_at: "2099-01-01T00:00:00Z",
      });
      await purchase(db, { eventId: event, userId: owner });
      expect((await eventRow(db, event)).expires_at!.toISOString()).toBe(
        "2099-01-01T00:00:00.000Z",
      );
    }));

  it("la prolongation ajoute des mois à la date d'expiration et ne change pas l'offre", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, {
        plan: "event",
        expires_at: "2099-03-15T00:00:00Z",
      });
      const answer = await purchase(db, { eventId: event, userId: owner, product: "extension" });
      expect(answer).toMatchObject({ ok: true, result: "applied", plan: "event" });
      const after = await eventRow(db, event);
      expect(after.plan).toBe("event");
      expect(after.expires_at!.toISOString()).toBe("2100-03-15T00:00:00.000Z");
    }));

  it("l'offre Pro n'est jamais abaissée par un achat", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, { plan: "pro" });
      await purchase(db, { eventId: event, userId: owner });
      expect((await eventRow(db, event)).plan).toBe("pro");
    }));
});

describe("NF-012: un webhook rejoué deux fois n'a qu'un effet", () => {
  it("le même événement Stripe rejoué ne crée ni deuxième achat ni deuxième prolongation", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, {
        plan: "event",
        expires_at: "2099-03-15T00:00:00Z",
      });
      const sessionId = session();
      const first = await purchase(db, {
        eventId: event,
        userId: owner,
        sessionId,
        product: "extension",
        stripeEventId: "evt_1",
      });
      const second = await purchase(db, {
        eventId: event,
        userId: owner,
        sessionId,
        product: "extension",
        stripeEventId: "evt_1",
      });
      expect(first.result).toBe("applied");
      expect(second.result).toBe("duplicate_event");
      expect((await eventRow(db, event)).expires_at!.toISOString()).toBe(
        "2100-03-15T00:00:00.000Z",
      );
      const { rows } = await db.query("select count(*)::int as n from public.purchases");
      expect(rows[0]!.n).toBe(1);
    }));

  it("la même session payée, annoncée par un autre événement ou par la page de retour, ne compte qu'une fois", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      const sessionId = session();
      expect((await purchase(db, { eventId: event, userId: owner, sessionId })).result).toBe(
        "applied",
      );
      expect(
        (await purchase(db, { eventId: event, userId: owner, sessionId, stripeEventId: "evt_2" }))
          .result,
      ).toBe("already_applied");
      const { rows } = await db.query("select count(*)::int as n from public.purchases");
      expect(rows[0]!.n).toBe(1);
      // The journal still remembers the webhook event: replaying it changes nothing.
      expect(
        (await purchase(db, { eventId: event, userId: owner, sessionId, stripeEventId: "evt_2" }))
          .result,
      ).toBe("duplicate_event");
    }));

  it("un paiement pour un événement disparu est gardé dans le journal d'audit, pour un remboursement à la main", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const answer = await purchase(db, { eventId: randomUUID(), userId: owner });
      expect(answer).toEqual({ ok: false, reason: "event_not_found" });
      const { rows } = await db.query(
        "select action from public.audit_log where action = 'purchase_orphan'",
      );
      expect(rows).toHaveLength(1);
      const none = await db.query("select count(*)::int as n from public.purchases");
      expect(none.rows[0]!.n).toBe(0);
    }));

  it("des valeurs absurdes sont refusées sans rien écrire", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      expect(await purchase(db, { eventId: event, userId: owner, months: 0 })).toEqual({
        ok: false,
        reason: "invalid_input",
      });
      const { rows } = await db.query("select count(*)::int as n from public.purchases");
      expect(rows[0]!.n).toBe(0);
    }));
});

describe("R6: un remboursement complet reprend ses effets", () => {
  it("rembourser l'offre Événement remet l'événement en gratuit, une seule fois, avec une trace", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      const paymentIntent = `pi_${randomUUID()}`;
      await purchase(db, { eventId: event, userId: owner, paymentIntent });
      expect((await eventRow(db, event)).plan).toBe("event");

      expect(await refund(db, paymentIntent, "evt_r1")).toMatchObject({
        ok: true,
        result: "refunded",
        event_id: event,
      });
      const after = await eventRow(db, event);
      expect(after.plan).toBe("free");
      expect(after.expires_at!.toISOString()).toBe("2026-10-12T00:00:00.000Z");

      expect((await refund(db, paymentIntent, "evt_r1")).result).toBe("duplicate_event");
      expect((await refund(db, paymentIntent, "evt_r2")).result).toBe("already_refunded");
      const { rows } = await db.query(
        "select status, refunded_at from public.purchases where stripe_payment_intent_id = $1",
        [paymentIntent],
      );
      expect(rows[0]).toMatchObject({ status: "refunded" });
      expect(rows[0]!.refunded_at).not.toBeNull();
      const audit = await db.query(
        "select metadata from public.audit_log where action = 'purchase_refunded'",
      );
      expect(audit.rows).toHaveLength(1);
    }));

  it("rembourser une prolongation reprend ses mois et laisse l'offre en place", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db, {
        plan: "event",
        expires_at: "2099-03-15T00:00:00Z",
      });
      const paymentIntent = `pi_${randomUUID()}`;
      await purchase(db, { eventId: event, userId: owner, paymentIntent, product: "extension" });
      await refund(db, paymentIntent);
      const after = await eventRow(db, event);
      expect(after.plan).toBe("event");
      expect(after.expires_at!.toISOString()).toBe("2099-03-15T00:00:00.000Z");
    }));

  it("un remboursement inconnu de nous (autre produit Stripe) est ignoré sans erreur", () =>
    withTestDb(async (db) => {
      expect(await refund(db, "pi_inconnu")).toEqual({ ok: true, result: "unknown_purchase" });
    }));
});

describe("S-001: droits sur les achats", () => {
  it("un organisateur ne voit que ses achats, un administrateur les voit tous, un invité aucun", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      const other = await db.createUser();
      const admin = await db.createUser();
      await db.makeAdmin(admin);
      const guest = await db.createUser({ anonymous: true });
      await purchase(db, { eventId: event, userId: owner });

      const count = (actor: Parameters<typeof db.as>[0]) =>
        db.as(actor, async (q) => {
          const { rows } = await q.query("select count(*)::int as n from public.purchases");
          return rows[0]!.n as number;
        });
      expect(await count({ kind: "user", id: owner })).toBe(1);
      expect(await count({ kind: "user", id: other })).toBe(0);
      expect(await count({ kind: "user", id: admin })).toBe(1);
      expect(await count({ kind: "guest", id: guest })).toBe(0);
      await expect(count({ kind: "visitor" })).rejects.toThrow(/permission denied/);
    }));

  it("personne ne peut écrire dans les achats ni lire le journal Stripe, sauf le serveur", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      await purchase(db, { eventId: event, userId: owner, stripeEventId: "evt_x" });
      const write = (sql: string) => db.as({ kind: "user", id: owner }, (q) => q.query(sql, []));

      await expect(
        write(
          `insert into public.purchases (event_title, user_id, amount_cents, currency, product)
           values ('x', '${owner}', 0, 'eur', 'event')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(write("update public.purchases set amount_cents = 0")).rejects.toThrow(
        /permission denied/,
      );
      await expect(write("delete from public.purchases")).rejects.toThrow(/permission denied/);
      await expect(write("select * from public.stripe_events")).rejects.toThrow(
        /permission denied/,
      );
      await expect(write("update public.events set plan = 'pro'")).rejects.toThrow(
        /permission denied/,
      );
    }));

  it("seul le serveur appelle les fonctions de paiement", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      const call = (actor: Parameters<typeof db.as>[0]) =>
        db.as(actor, (q) =>
          q.query(
            `select public.apply_purchase($1, $2, 'cs_x', null, 1, 'eur', 'event', 12, null, null)`,
            [event, owner],
          ),
        );
      await expect(call({ kind: "user", id: owner })).rejects.toThrow(/permission denied/);
      await expect(call({ kind: "visitor" })).rejects.toThrow(/permission denied/);
      await expect(
        db.as({ kind: "user", id: owner }, (q) =>
          q.query("select public.apply_refund('pi_x', 12, now(), null, null)"),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(call({ kind: "service" })).resolves.toBeDefined();
    }));

  it("les achats survivent à la suppression de l'événement, avec son titre", () =>
    withTestDb(async (db) => {
      const { owner, event } = await setup(db);
      await purchase(db, { eventId: event, userId: owner });
      await db.query("delete from public.events where id = $1", [event]);
      const { rows } = await db.query(
        "select event_id, event_title from public.purchases where user_id = $1",
        [owner],
      );
      expect(rows).toEqual([{ event_id: null, event_title: "Mariage de Léa et Tom" }]);
    }));
});
