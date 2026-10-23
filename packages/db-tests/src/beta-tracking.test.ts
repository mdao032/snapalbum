import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable, type TestDb } from "./harness";

/**
 * Step 6.3: the send figures of the beta events in the administrator's overview, and the counter of
 * reservations that were never confirmed.
 */

interface Overview {
  beta_uploads_delivered: number;
  beta_uploads_failed: number;
  events_beta: number;
}

const overview = async (db: Queryable) =>
  (await db.query<{ answer: Overview }>("select public.admin_overview(now()) as answer")).rows[0]!
    .answer;

/** An event that received the plan by invitation, with `statuses` media rows. */
async function betaEvent(db: TestDb, statuses: string[], abandoned = 0) {
  const owner = await db.createUser({ email: `o-${randomUUID()}@example.test` });
  const event = await db.createEvent(owner);
  await db.query(
    `insert into public.purchases (event_id, event_title, user_id, source, amount_cents, currency, product)
     values ($1, 'Bêta', $2, 'beta_invitation', 0, 'eur', 'event')`,
    [event, owner],
  );
  const guest = await db.createGuest(event, await db.createUser({ anonymous: true }));
  for (const status of statuses) await db.createMedia(event, guest, { status });
  if (abandoned > 0) {
    await db.query("select public.bump_uploads_abandoned($1, $2)", [event, abandoned]);
  }
  return event;
}

describe("6.3: envois des événements de la bêta", () => {
  it("compte livrés et échecs des seuls événements de la bêta", () =>
    withTestDb(async (db) => {
      const before = await overview(db);
      await betaEvent(db, ["ready", "ready", "hidden", "deleted", "rejected", "pending"], 2);

      // A paying event is not part of the beta figures.
      const owner = await db.createUser({ email: `p-${randomUUID()}@example.test` });
      const paying = await db.createEvent(owner, { plan: "event" });
      const guest = await db.createGuest(paying, await db.createUser({ anonymous: true }));
      await db.createMedia(paying, guest, { status: "ready" });
      await db.createMedia(paying, guest, { status: "rejected" });

      const after = await overview(db);
      expect(after.beta_uploads_delivered - before.beta_uploads_delivered).toBe(4);
      // 1 refused file + 2 reservations never confirmed; the pending one is still on its way.
      expect(after.beta_uploads_failed - before.beta_uploads_failed).toBe(3);
      expect(after.events_beta - before.events_beta).toBe(1);
    }));

  it("le compteur d'envois abandonnés s'additionne et ignore un nombre négatif", () =>
    withTestDb(async (db) => {
      const event = await betaEvent(db, [], 3);
      await db.query("select public.bump_uploads_abandoned($1, 2)", [event]);
      await db.query("select public.bump_uploads_abandoned($1, -9)", [event]);
      const { rows } = await db.query<{ uploads_abandoned: number }>(
        "select uploads_abandoned from public.events where id = $1",
        [event],
      );
      expect(rows[0]?.uploads_abandoned).toBe(5);
    }));

  it("la fonction du compteur n'est ouverte qu'au serveur", () =>
    withTestDb(async (db) => {
      const user = await db.createUser({ email: `u-${randomUUID()}@example.test` });
      const event = await db.createEvent(user);
      for (const actor of [{ kind: "user", id: user }, { kind: "visitor" }] as const) {
        await expect(
          db.as(actor, (q) => q.query("select public.bump_uploads_abandoned($1, 1)", [event])),
          actor.kind,
        ).rejects.toThrow(/permission denied/);
      }
    }));
});
