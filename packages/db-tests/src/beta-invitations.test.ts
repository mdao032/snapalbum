import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable } from "./harness";

/**
 * Step 6.1: beta invitations. An administrator makes a single-use code for an organiser's address;
 * the organiser enters it on one of their free events and receives the Event plan without paying.
 * Everything is reserved to the server (service role).
 */

interface Answer {
  ok: boolean;
  reason?: string;
  id?: string;
  plan?: string;
  expires_at?: string;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () =>
  Array.from({ length: 10 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

async function call(db: Queryable, sql: string, values: unknown[]): Promise<Answer> {
  const { rows } = await db.query<{ answer: Answer }>(`select ${sql} as answer`, values);
  return rows[0]!.answer;
}

const invite = (db: Queryable, admin: string, email: string, code = newCode()) =>
  call(db, "public.create_beta_invitation($1, $2, $3)", [admin, email, code]).then((answer) => ({
    answer,
    code,
  }));
const redeem = (db: Queryable, user: string, event: string, code: string, months = 12) =>
  call(db, "public.redeem_beta_invitation($1, $2, $3, $4)", [user, event, code, months]);

async function setup(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const email = `orga-${randomUUID()}@example.test`;
  const user = await db.createUser({ email });
  const admin = await db.createUser({ email: `admin-${randomUUID()}@example.test` });
  await db.makeAdmin(admin);
  const event = await db.createEvent(user);
  return { email, user, admin, event };
}

describe("6.1: création d'une invitation", () => {
  it("garde l'adresse en minuscules, écrit l'audit et refuse une seconde invitation ouverte", () =>
    withTestDb(async (db) => {
      const { email, admin } = await setup(db);
      const first = await invite(db, admin, `  ${email.toUpperCase()} `);
      expect(first.answer.ok).toBe(true);

      const { rows } = await db.query<{ email: string }>(
        "select email from public.beta_invitations where id = $1",
        [first.answer.id],
      );
      expect(rows[0]?.email).toBe(email);
      const audit = await db.query(
        "select 1 from public.audit_log where action = 'admin.beta.invite' and target_id = $1",
        [first.answer.id],
      );
      expect(audit.rowCount).toBe(1);

      const second = await invite(db, admin, email);
      expect(second.answer).toEqual({ ok: false, reason: "already_invited" });
    }));

  it("refuse une adresse ou un code mal formés et un code déjà pris", () =>
    withTestDb(async (db) => {
      const { admin } = await setup(db);
      expect((await invite(db, admin, "pas une adresse")).answer.reason).toBe("invalid_input");
      expect((await invite(db, admin, "a@example.test", "abc")).answer.reason).toBe(
        "invalid_input",
      );
      // 0, O, 1, I and L are not in the alphabet.
      expect((await invite(db, admin, "a@example.test", "ABCDE0FGHJ")).answer.reason).toBe(
        "invalid_input",
      );
      const taken = await invite(db, admin, `a-${randomUUID()}@example.test`);
      const clash = await invite(db, admin, `b-${randomUUID()}@example.test`, taken.code);
      expect(clash.answer.reason).toBe("duplicate_code");
    }));

  it("une nouvelle invitation est possible une fois la première utilisée ou révoquée", () =>
    withTestDb(async (db) => {
      const { email, admin, user, event } = await setup(db);
      const first = await invite(db, admin, email);
      expect((await redeem(db, user, event, first.code)).ok).toBe(true);
      const second = await invite(db, admin, email);
      expect(second.answer.ok).toBe(true);

      const revoked = await call(db, "public.revoke_beta_invitation($1, $2)", [
        admin,
        second.answer.id,
      ]);
      expect(revoked.ok).toBe(true);
      expect((await invite(db, admin, email)).answer.ok).toBe(true);
    }));
});

describe("6.1: utilisation du code", () => {
  it("donne l'offre Événement avec sa conservation, sans paiement, et note l'achat comme un cadeau", () =>
    withTestDb(async (db) => {
      const { email, admin, user, event } = await setup(db);
      const { code } = await invite(db, admin, email);

      const result = await redeem(db, user, event, code, 12);
      expect(result.ok).toBe(true);
      expect(result.plan).toBe("event");

      const { rows: events } = await db.query<{ plan: string; expires_at: string | null }>(
        "select plan, expires_at from public.events where id = $1",
        [event],
      );
      expect(events[0]?.plan).toBe("event");
      expect(events[0]?.expires_at).not.toBeNull();

      const { rows: purchases } = await db.query<{
        source: string;
        amount_cents: number;
        stripe_checkout_session_id: string | null;
        product: string;
      }>(
        "select source, amount_cents, stripe_checkout_session_id, product from public.purchases where event_id = $1",
        [event],
      );
      expect(purchases).toEqual([
        {
          source: "beta_invitation",
          amount_cents: 0,
          stripe_checkout_session_id: null,
          product: "event",
        },
      ]);

      const { rows: invitations } = await db.query<{ redeemed_by: string; event_title: string }>(
        "select redeemed_by, event_title from public.beta_invitations where code = $1",
        [code],
      );
      expect(invitations[0]?.redeemed_by).toBe(user);
      expect(invitations[0]?.event_title).toBeTruthy();
    }));

  it("un code ne sert qu'une fois", () =>
    withTestDb(async (db) => {
      const { email, admin, user, event } = await setup(db);
      const other = await db.createEvent(user);
      const { code } = await invite(db, admin, email);
      expect((await redeem(db, user, event, code)).ok).toBe(true);
      expect(await redeem(db, user, other, code)).toEqual({ ok: false, reason: "already_used" });
      const { rows } = await db.query("select 1 from public.purchases where event_id = $1", [
        other,
      ]);
      expect(rows).toHaveLength(0);
    }));

  it("un code inconnu et le code d'un autre organisateur répondent pareil", () =>
    withTestDb(async (db) => {
      const { email, admin, event, user } = await setup(db);
      const stranger = await db.createUser({ email: `s-${randomUUID()}@example.test` });
      const strangerEvent = await db.createEvent(stranger);
      const { code } = await invite(db, admin, email);

      const unknown = await redeem(db, user, event, newCode());
      const notYours = await redeem(db, stranger, strangerEvent, code);
      expect(unknown).toEqual({ ok: false, reason: "invalid_code" });
      expect(notYours).toEqual(unknown);

      const { rows } = await db.query(
        "select 1 from public.beta_invitations where code = $1 and redeemed_at is not null",
        [code],
      );
      expect(rows).toHaveLength(0);
    }));

  it("un code révoqué ne marche plus", () =>
    withTestDb(async (db) => {
      const { email, admin, user, event } = await setup(db);
      const { answer, code } = await invite(db, admin, email);
      await call(db, "public.revoke_beta_invitation($1, $2)", [admin, answer.id]);
      expect(await redeem(db, user, event, code)).toEqual({ ok: false, reason: "revoked" });
    }));

  it("refuse l'événement d'un autre, un événement déjà payant et un événement suspendu", () =>
    withTestDb(async (db) => {
      const { email, admin, user } = await setup(db);
      const stranger = await db.createUser({ email: `s-${randomUUID()}@example.test` });
      const theirs = await db.createEvent(stranger);
      const paid = await db.createEvent(user, { plan: "event" });
      const suspended = await db.createEvent(user, { status: "suspended" });
      const { code } = await invite(db, admin, email);

      expect((await redeem(db, user, theirs, code)).reason).toBe("event_not_found");
      expect((await redeem(db, user, randomUUID(), code)).reason).toBe("event_not_found");
      expect((await redeem(db, user, paid, code)).reason).toBe("not_free");
      expect((await redeem(db, user, suspended, code)).reason).toBe("event_not_active");

      // None of those failures used up the code.
      const free = await db.createEvent(user);
      expect((await redeem(db, user, free, code)).ok).toBe(true);
    }));
});

describe("6.1: chiffres et listes de l'administrateur", () => {
  it("les événements en bêta sont comptés à part, hors paiements et hors conversion", () =>
    withTestDb(async (db) => {
      const before = await call(db, "public.admin_overview(now())", []);
      const { email, admin, user, event } = await setup(db);
      const { code } = await invite(db, admin, email);
      await redeem(db, user, event, code);

      const after = (await call(db, "public.admin_overview(now())", [])) as unknown as Record<
        string,
        number
      >;
      const was = before as unknown as Record<string, number>;
      expect(after.events_beta! - was.events_beta!).toBe(1);
      expect(after.events_paid! - was.events_paid!).toBe(0);
      expect(after.purchases_paid! - was.purchases_paid!).toBe(0);
      expect(after.revenue_cents! - was.revenue_cents!).toBe(0);
    }));

  it("la liste donne l'état de chaque invitation, la plus récente d'abord", () =>
    withTestDb(async (db) => {
      const { email, admin, user, event } = await setup(db);
      const used = await invite(db, admin, email);
      await redeem(db, user, event, used.code);
      const revoked = await invite(db, admin, `r-${randomUUID()}@example.test`);
      await call(db, "public.revoke_beta_invitation($1, $2)", [admin, revoked.answer.id]);
      const open = await invite(db, admin, `o-${randomUUID()}@example.test`);
      // A transaction has one `now()`: give the others an earlier date so the order is visible.
      await db.query(
        "update public.beta_invitations set created_at = now() - interval '1 day' where id <> $1",
        [open.answer.id],
      );

      const { rows } = await db.query<{
        answer: {
          total: number;
          rows: { id: string; state: string; event_title: string | null }[];
        };
      }>("select public.admin_list_beta_invitations(10, 0) as answer");
      const states = new Map(rows[0]!.answer.rows.map((row) => [row.id, row.state]));
      expect(states.get(open.answer.id!)).toBe("open");
      expect(states.get(revoked.answer.id!)).toBe("revoked");
      expect(states.get(used.answer.id!)).toBe("redeemed");
      expect(rows[0]!.answer.rows[0]!.id).toBe(open.answer.id);
    }));
});

describe("6.1: droits", () => {
  it("seul le serveur (rôle de service) appelle les fonctions ; la table est fermée à l'API", () =>
    withTestDb(async (db) => {
      const { admin, user, event } = await setup(db);
      const guest = await db.createUser({ anonymous: true });
      const calls = [
        ["public.create_beta_invitation($1, 'a@example.test', 'ABCDEFGHJK')", [admin]],
        ["public.revoke_beta_invitation($1, $2)", [admin, randomUUID()]],
        ["public.redeem_beta_invitation($1, $2, 'ABCDEFGHJK', 12)", [user, event]],
        ["public.admin_list_beta_invitations(10, 0)", []],
      ] as const;
      const actors = [
        { kind: "user", id: user },
        { kind: "user", id: admin },
        { kind: "guest", id: guest },
        { kind: "visitor" },
      ] as const;
      for (const [fn, values] of calls) {
        for (const actor of actors) {
          await expect(
            db.as(actor, (q) => q.query(`select ${fn}`, [...values])),
            `${fn} par ${actor.kind}`,
          ).rejects.toThrow(/permission denied/);
        }
      }

      const { code } = await invite(db, admin, `t-${randomUUID()}@example.test`);
      for (const actor of actors) {
        // No grant at all for the API roles (and RLS without a policy behind it).
        await expect(
          db.as(actor, (q) => q.query("select code from public.beta_invitations")),
          `lecture par ${actor.kind}`,
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.as(actor, (q) => q.query("update public.beta_invitations set revoked_at = now()")),
          `écriture par ${actor.kind}`,
        ).rejects.toThrow(/permission denied/);
      }

      const stored = await db.as({ kind: "service" }, (q) =>
        q.query("select code from public.beta_invitations where code = $1", [code]),
      );
      expect(stored.rows).toHaveLength(1);
    }));
});
