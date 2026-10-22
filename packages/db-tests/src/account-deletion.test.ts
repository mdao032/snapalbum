import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable, type TestDb } from "./harness";

/**
 * F-004, G-004, R5: the deletion of an organiser's account, in the database. The server calls these
 * functions with the service role; nobody else may.
 */

interface Answer {
  ok: boolean;
  reason?: string;
  deleted_at?: string;
  event_ids?: string[];
  restored?: number;
  purchases?: number;
}

const NOW = "2026-10-22T10:00:00Z";
const GRACE = 7;

async function call(db: Queryable, sql: string, values: unknown[]): Promise<Answer> {
  const { rows } = await db.query<{ answer: Answer }>(`select ${sql} as answer`, values);
  return rows[0]!.answer;
}

const request = (db: Queryable, user: string, now = NOW) =>
  call(db, "public.request_account_deletion($1, $2)", [user, now]);
const cancel = (db: Queryable, user: string, now = NOW) =>
  call(db, "public.cancel_account_deletion($1, $2, $3)", [user, now, GRACE]);
const prepare = (db: Queryable, user: string) =>
  call(db, "public.prepare_account_purge($1)", [user]);
const finish = (db: Queryable, user: string) => call(db, "public.finish_account_purge($1)", [user]);

async function eventState(db: Queryable, id: string) {
  const { rows } = await db.query<{
    status: string;
    deletion_reason: string | null;
    deleted_at: Date | null;
  }>("select status, deletion_reason, deleted_at from public.events where id = $1", [id]);
  return rows[0]!;
}

async function profileDeletedAt(db: Queryable, user: string): Promise<Date | null> {
  const { rows } = await db.query<{ deleted_at: Date | null }>(
    "select deleted_at from public.profiles where user_id = $1",
    [user],
  );
  return rows[0]!.deleted_at;
}

async function auditActions(db: Queryable, user: string): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    "select action from public.audit_log where target_type = 'user' and target_id = $1 order by created_at, id",
    [user],
  );
  // The lines of one transaction share a date: compare them as a set, in alphabetical order.
  return rows.map((row) => row.action).sort();
}

async function addPurchase(db: TestDb, user: string, event: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.purchases (event_id, event_title, user_id, stripe_checkout_session_id,
                                   amount_cents, currency, product)
     values ($1, 'Mariage de Léa et Tom', $2, $3, 4900, 'eur', 'event') returning id`,
    [event, user, `cs_test_${randomUUID().replaceAll("-", "")}`],
  );
  return rows[0]!.id;
}

describe("F-004: demander la suppression du compte", () => {
  it("marque le compte et ferme les événements actifs, avec la raison « account »", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const first = await db.createEvent(owner);
      const second = await db.createEvent(owner);

      const answer = await request(db, owner);
      expect(answer.ok).toBe(true);
      expect([...(answer.event_ids ?? [])].sort()).toEqual([first, second].sort());
      expect((await profileDeletedAt(db, owner))?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
      for (const id of [first, second]) {
        const state = await eventState(db, id);
        expect(state.status).toBe("pending_deletion");
        expect(state.deletion_reason).toBe("account");
        expect(state.deleted_at?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
      }
      expect(await auditActions(db, owner)).toEqual(["account_deletion_requested"]);
    }));

  it("ne touche ni les événements des autres, ni ceux déjà supprimés ou suspendus", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const other = await db.createUser();
      const mine = await db.createEvent(owner);
      const theirs = await db.createEvent(other);
      const suspended = await db.createEvent(owner, { status: "suspended" });
      const deletedBefore = await db.createEvent(owner, {
        status: "pending_deletion",
        deleted_at: "2026-10-20T10:00:00Z",
        deletion_reason: "user",
      });

      const answer = await request(db, owner);
      expect(answer.event_ids).toEqual([mine]);
      expect((await eventState(db, theirs)).status).toBe("active");
      expect((await eventState(db, suspended)).status).toBe("suspended");
      const before = await eventState(db, deletedBefore);
      expect(before.deletion_reason).toBe("user");
      expect(before.deleted_at?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
      expect(await profileDeletedAt(db, other)).toBeNull();
    }));

  it("demander deux fois est refusé : les 7 jours ne se repoussent pas", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      await db.createEvent(owner);
      await request(db, owner);
      const again = await request(db, owner, "2026-10-25T10:00:00Z");
      expect(again).toMatchObject({ ok: false, reason: "already_requested" });
      expect((await profileDeletedAt(db, owner))?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
    }));

  it("un utilisateur sans profil (invité anonyme) n'a rien à supprimer", () =>
    withTestDb(async (db) => {
      const guest = await db.createUser({ anonymous: true });
      expect(await request(db, guest)).toMatchObject({ ok: false, reason: "no_profile" });
      expect(await request(db, randomUUID())).toMatchObject({ ok: false, reason: "no_profile" });
    }));
});

describe("F-004, R5: annuler pendant les 7 jours", () => {
  it("remet le compte et les événements fermés par la demande, tels qu'ils étaient", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      const expired = await db.createEvent(owner, {
        status: "pending_deletion",
        deleted_at: "2026-10-15T10:00:00Z",
        deletion_reason: "expired",
      });
      await request(db, owner);

      const answer = await cancel(db, owner, "2026-10-28T09:59:00Z");
      expect(answer).toMatchObject({ ok: true, restored: 1 });
      expect(await profileDeletedAt(db, owner)).toBeNull();
      expect(await eventState(db, event)).toMatchObject({
        status: "active",
        deletion_reason: null,
        deleted_at: null,
      });
      // An album that expired before is not brought back by a change of mind about the account.
      expect(await eventState(db, expired)).toMatchObject({
        status: "pending_deletion",
        deletion_reason: "expired",
      });
      expect(await auditActions(db, owner)).toEqual([
        "account_deletion_cancelled",
        "account_deletion_requested",
      ]);
    }));

  it("est refusé une fois les 7 jours écoulés, ou sans demande", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      await db.createEvent(owner);
      expect(await cancel(db, owner)).toMatchObject({ ok: false, reason: "not_requested" });
      await request(db, owner);
      expect(await cancel(db, owner, "2026-10-29T10:00:00Z")).toMatchObject({
        ok: false,
        reason: "too_late",
      });
      expect(await profileDeletedAt(db, owner)).not.toBeNull();
    }));

  it("on peut redemander la suppression après l'avoir annulée", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      await db.createEvent(owner);
      await request(db, owner);
      await cancel(db, owner);
      expect((await request(db, owner, "2026-11-01T10:00:00Z")).ok).toBe(true);
    }));
});

describe("F-004, G-004: purger le compte", () => {
  it("ne prépare jamais un compte dont la suppression n'a pas été demandée", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      expect(await prepare(db, owner)).toEqual({ ok: false });
      expect((await eventState(db, event)).status).toBe("active");
      expect(await finish(db, owner)).toMatchObject({ ok: false, reason: "not_requested" });
    }));

  it("prépare tous les événements du compte, quel que soit leur état, pour la purge", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const active = await db.createEvent(owner);
      const suspended = await db.createEvent(owner, { status: "suspended" });
      await request(db, owner);

      const answer = await prepare(db, owner);
      expect(answer.ok).toBe(true);
      expect([...(answer.event_ids ?? [])].sort()).toEqual([active, suspended].sort());
      expect((await eventState(db, suspended)).status).toBe("pending_deletion");
      // Every one of them is now accepted by the purge of an event.
      for (const id of [active, suspended]) {
        const { rows } = await db.query<{ answer: { ok: boolean } }>(
          "select public.purge_event($1) as answer",
          [id],
        );
        expect(rows[0]!.answer.ok).toBe(true);
      }
    }));

  it("l'étape finale est refusée tant qu'un événement reste, puis efface les titres des achats et garde le reste", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      const purchase = await addPurchase(db, owner, event);
      await request(db, owner);
      await prepare(db, owner);

      expect(await finish(db, owner)).toMatchObject({ ok: false, reason: "events_remain" });
      await db.query("select public.purge_event($1)", [event]);
      expect(await finish(db, owner)).toMatchObject({ ok: true, purchases: 1 });

      const { rows } = await db.query<{
        event_title: string;
        amount_cents: number;
        status: string;
      }>("select event_title, amount_cents, status from public.purchases where id = $1", [
        purchase,
      ]);
      expect(rows[0]).toEqual({ event_title: "", amount_cents: 4900, status: "paid" });
      expect(await auditActions(db, owner)).toEqual([
        "account_deletion_requested",
        "account_purged",
      ]);
    }));

  it("supprimer le compte de connexion garde les achats, sans lien avec la personne", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      const purchase = await addPurchase(db, owner, event);
      await request(db, owner);
      await prepare(db, owner);
      await db.query("select public.purge_event($1)", [event]);
      await finish(db, owner);

      await db.query("delete from auth.users where id = $1", [owner]);

      const { rows } = await db.query<{ user_id: string | null; amount_cents: number }>(
        "select user_id, amount_cents from public.purchases where id = $1",
        [purchase],
      );
      expect(rows[0]).toEqual({ user_id: null, amount_cents: 4900 });
      const profile = await db.query("select 1 from public.profiles where user_id = $1", [owner]);
      expect(profile.rowCount).toBe(0);
      // The audit lines stay, with no one attached to them.
      expect(await auditActions(db, owner)).toContain("account_purged");
    }));

  it("un événement qui garde un propriétaire empêche toujours de supprimer le compte de connexion", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      await db.createEvent(owner);
      await expect(db.query("delete from auth.users where id = $1", [owner])).rejects.toThrow(
        /violates foreign key/,
      );
    }));
});

describe("S-001: seul le serveur appelle ces fonctions", () => {
  it("un organisateur, un invité et un visiteur sont refusés", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const guest = await db.createUser({ anonymous: true });
      const sql = [
        ["public.request_account_deletion($1, now())", [owner]],
        ["public.cancel_account_deletion($1, now(), 7)", [owner]],
        ["public.prepare_account_purge($1)", [owner]],
        ["public.finish_account_purge($1)", [owner]],
      ] as const;
      const actors = [
        { kind: "user", id: owner },
        { kind: "guest", id: guest },
        { kind: "visitor" },
      ] as const;
      for (const [fn, values] of sql) {
        for (const actor of actors) {
          await expect(
            db.as(actor, (q) => q.query(`select ${fn}`, [...values])),
            `${fn} par ${actor.kind}`,
          ).rejects.toThrow(/permission denied/);
        }
      }
      const answer = await db.as({ kind: "service" }, (q) =>
        q.query("select public.prepare_account_purge($1) as answer", [owner]),
      );
      expect((answer.rows[0] as { answer: Answer }).answer.ok).toBe(false);
    }));

  it("un organisateur ne peut pas écrire la date de suppression de son profil", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      await expect(
        db.as({ kind: "user", id: owner }, (q) =>
          q.query("update public.profiles set deleted_at = now() where user_id = $1", [owner]),
        ),
      ).rejects.toThrow(/permission denied/);
    }));
});
