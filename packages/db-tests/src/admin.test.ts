import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable, type TestDb } from "./harness";

/**
 * F-090, F-091, F-092, SPEC 9.3: the administrator area's functions. The server calls them with
 * the service role, after checking the caller's role; nobody else may.
 */

interface Page<T> {
  total: number;
  rows: T[];
}

async function call<T>(db: Queryable, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await db.query<{ answer: T }>(`select ${sql} as answer`, values);
  return rows[0]!.answer;
}

const NOW = "2026-10-22T10:00:00Z";

interface Overview {
  events_total: number;
  events_30d: number;
  events_suspended: number;
  events_paid: number;
  organisers_total: number;
  bytes_total: number;
  revenue_cents: number;
  purchases_paid: number;
  purchases_refunded: number;
  open_reports: number;
}
const overview = (db: Queryable) => call<Overview>(db, "public.admin_overview($1)", [NOW]);
const listEvents = (db: Queryable, query: string | null, limit = 25, offset = 0) =>
  call<Page<{ id: string; owner_email: string | null; open_reports: number }>>(
    db,
    "public.admin_list_events($1, $2, $3)",
    [query, limit, offset],
  );

async function owner(db: TestDb, email: string) {
  const id = await db.createUser({ email });
  return id;
}

describe("F-092: les chiffres de la plateforme", () => {
  it("comptent les événements, les médias, le stockage, les achats et les signalements", () =>
    withTestDb(async (db) => {
      const before = await overview(db);
      const user = await owner(db, `a-${randomUUID()}@example.test`);
      const event = await db.createEvent(user, { plan: "event" });
      await db.createEvent(user, { status: "suspended" });
      const guest = await db.createGuest(event, await db.createUser({ anonymous: true }));
      const media = await db.createMedia(event, guest, { status: "ready" });
      await db.query("update public.events set bytes_used = 5000 where id = $1", [event]);
      await db.query(
        `insert into public.purchases (event_id, event_title, user_id, amount_cents, currency, product)
         values ($1, 'x', $2, 4900, 'eur', 'event')`,
        [event, user],
      );
      await db.query(
        `insert into public.reports (media_id, reason, reporter_fingerprint)
         values ($1, 'other', repeat('a', 64))`,
        [media],
      );

      const after = await overview(db);
      expect(after.events_total - before.events_total).toBeGreaterThanOrEqual(2);
      expect(after.events_30d - before.events_30d).toBeGreaterThanOrEqual(2);
      expect(after.events_suspended - before.events_suspended).toBeGreaterThanOrEqual(1);
      expect(after.events_paid - before.events_paid).toBeGreaterThanOrEqual(1);
      expect(after.organisers_total - before.organisers_total).toBeGreaterThanOrEqual(1);
      expect(after.bytes_total - before.bytes_total).toBeGreaterThanOrEqual(5000);
      expect(after.revenue_cents - before.revenue_cents).toBeGreaterThanOrEqual(4900);
      expect(after.purchases_paid - before.purchases_paid).toBeGreaterThanOrEqual(1);
      expect(after.open_reports - before.open_reports).toBeGreaterThanOrEqual(1);
    }));

  it("un achat remboursé ne compte plus dans le chiffre d'affaires", () =>
    withTestDb(async (db) => {
      const before = await overview(db);
      const user = await owner(db, `b-${randomUUID()}@example.test`);
      const event = await db.createEvent(user);
      await db.query(
        `insert into public.purchases (event_id, event_title, user_id, amount_cents, currency, product, status)
         values ($1, 'x', $2, 4900, 'eur', 'event', 'refunded')`,
        [event, user],
      );
      const after = await overview(db);
      expect(after.revenue_cents).toBe(before.revenue_cents);
      expect(after.purchases_refunded - before.purchases_refunded).toBeGreaterThanOrEqual(1);
    }));
});

describe("F-090: listes et recherche", () => {
  it("retrouve un événement par son titre, l'adresse de l'organisateur ou son code exact", () =>
    withTestDb(async (db) => {
      const email = `Orga-${randomUUID()}@Example.test`;
      const user = await owner(db, email);
      const event = await db.createEvent(user, { title: "Gala des Licornes Z9Q" });

      const byTitle = await listEvents(db, "licornes z9q");
      expect(byTitle.rows.map((row) => row.id)).toEqual([event]);
      expect(byTitle.total).toBe(1);
      expect(byTitle.rows[0]?.owner_email?.toLowerCase()).toBe(email.toLowerCase());

      expect((await listEvents(db, email.toUpperCase())).rows.map((row) => row.id)).toContain(
        event,
      );
      const { rows } = await db.query<{ public_code: string }>(
        "select public_code from public.events where id = $1",
        [event],
      );
      const code = rows[0]!.public_code;
      expect((await listEvents(db, code)).rows.map((row) => row.id)).toEqual([event]);
      // A code is found whole, not by a piece of it.
      expect((await listEvents(db, code.slice(0, 5))).rows.map((row) => row.id)).not.toContain(
        event,
      );
    }));

  it("un % ou un _ dans la recherche n'est pas un joker", () =>
    withTestDb(async (db) => {
      const user = await owner(db, `c-${randomUUID()}@example.test`);
      await db.createEvent(user, { title: "Fête normale" });
      const literal = await listEvents(db, "Fête_normale");
      expect(literal.rows).toEqual([]);
      const percent = await listEvents(db, "F%te");
      expect(percent.rows).toEqual([]);
    }));

  it("pagine du plus récent au plus ancien, sans perdre ni répéter une ligne", () =>
    withTestDb(async (db) => {
      const user = await owner(db, `d-${randomUUID()}@example.test`);
      const tag = `Pagi-${randomUUID().slice(0, 8)}`;
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await db.createEvent(user, { title: `${tag} ${i}`, plan: "event" }));
      }
      const first = await listEvents(db, tag, 2, 0);
      const second = await listEvents(db, tag, 2, 2);
      const third = await listEvents(db, tag, 2, 4);
      expect(first.total).toBe(5);
      const seen = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    }));

  it("les signalements ouverts de chaque événement sont comptés", () =>
    withTestDb(async (db) => {
      const user = await owner(db, `e-${randomUUID()}@example.test`);
      const event = await db.createEvent(user, { title: `Signal-${randomUUID().slice(0, 8)}` });
      const guest = await db.createGuest(event, await db.createUser({ anonymous: true }));
      const media = await db.createMedia(event, guest, { status: "ready" });
      await db.query(
        `insert into public.reports (media_id, reason, reporter_fingerprint)
         values ($1, 'other', repeat('b', 64)), ($1, 'private', repeat('c', 64))`,
        [media],
      );
      await db.query(
        `update public.reports set resolved_at = now() where reporter_fingerprint = repeat('c', 64)`,
      );
      const { rows } = await db.query<{ title: string }>(
        "select title from public.events where id = $1",
        [event],
      );
      const found = (await listEvents(db, rows[0]!.title)).rows[0];
      expect(Number(found?.open_reports)).toBe(1);
    }));

  it("les organisateurs et les achats se listent avec l'adresse, les totaux et les dates", () =>
    withTestDb(async (db) => {
      const email = `f-${randomUUID()}@example.test`;
      const user = await owner(db, email);
      const event = await db.createEvent(user);
      await db.query(
        `insert into public.purchases (event_id, event_title, user_id, amount_cents, currency, product,
                                       stripe_payment_intent_id)
         values ($1, 'Mariage', $2, 4900, 'eur', 'event', 'pi_test_123')`,
        [event, user],
      );

      const organisers = await call<
        Page<{ email: string; events_count: number; paid_cents: number; deleted_at: string | null }>
      >(db, "public.admin_list_organisers($1, 10, 0)", [email]);
      expect(organisers.total).toBe(1);
      expect(organisers.rows[0]).toMatchObject({ email, events_count: 1, paid_cents: 4900 });

      const purchases = await call<
        Page<{ owner_email: string; stripe_payment_intent_id: string; amount_cents: number }>
      >(db, "public.admin_list_purchases(200, 0)", []);
      const mine = purchases.rows.find((row) => row.stripe_payment_intent_id === "pi_test_123");
      expect(mine).toMatchObject({ owner_email: email, amount_cents: 4900 });
    }));
});

describe("F-091: suspendre et prolonger", () => {
  it("suspend un événement actif, le rétablit, et refuse tout autre état, avec une trace", () =>
    withTestDb(async (db) => {
      const admin = await owner(db, `g-${randomUUID()}@example.test`);
      const event = await db.createEvent(await owner(db, `h-${randomUUID()}@example.test`));
      const set = (suspended: boolean) =>
        call<{ ok: boolean; status?: string }>(db, "public.admin_set_event_suspended($1, $2, $3)", [
          event,
          suspended,
          admin,
        ]);

      expect(await set(false)).toEqual({ ok: false });
      expect(await set(true)).toEqual({ ok: true, status: "suspended" });
      expect(await set(true)).toEqual({ ok: false });
      expect(await set(false)).toEqual({ ok: true, status: "active" });

      const { rows } = await db.query<{ action: string; actor_id: string }>(
        "select action, actor_id from public.audit_log where target_id = $1 order by action",
        [event],
      );
      expect(rows).toEqual([
        { action: "admin.event.suspend", actor_id: admin },
        { action: "admin.event.unsuspend", actor_id: admin },
      ]);
    }));

  it("un événement en suppression n'est pas suspendu", () =>
    withTestDb(async (db) => {
      const admin = await owner(db, `i-${randomUUID()}@example.test`);
      const event = await db.createEvent(await owner(db, `j-${randomUUID()}@example.test`), {
        status: "pending_deletion",
        deleted_at: NOW,
        deletion_reason: "user",
      });
      expect(
        await call(db, "public.admin_set_event_suspended($1, true, $2)", [event, admin]),
      ).toEqual({ ok: false });
    }));

  it("prolonge depuis l'échéance, ou depuis maintenant si elle est passée, de 1 à 24 mois", () =>
    withTestDb(async (db) => {
      const admin = await owner(db, `k-${randomUUID()}@example.test`);
      const ahead = await db.createEvent(await owner(db, `l-${randomUUID()}@example.test`), {
        expires_at: "2027-03-15T00:00:00Z",
      });
      const past = await db.createEvent(await owner(db, `m-${randomUUID()}@example.test`), {
        expires_at: "2026-01-01T00:00:00Z",
      });
      const extend = (id: string, months: number) =>
        call<{ ok: boolean; expires_at?: string }>(
          db,
          "public.admin_extend_event($1, $2, $3, $4)",
          [id, months, admin, NOW],
        );

      expect((await extend(ahead, 3)).expires_at).toBe("2027-06-15T00:00:00+00:00");
      expect((await extend(past, 2)).expires_at).toBe("2026-12-22T10:00:00+00:00");
      expect(await extend(ahead, 0)).toEqual({ ok: false });
      expect(await extend(ahead, 25)).toEqual({ ok: false });
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.audit_log where target_id = $1 and action = 'admin.event.extend'",
        [ahead],
      );
      expect(rows[0]!.n).toBe(1);
    }));

  it("ne prolonge ni un événement Pro, ni un événement en suppression", () =>
    withTestDb(async (db) => {
      const admin = await owner(db, `n-${randomUUID()}@example.test`);
      const pro = await db.createEvent(await owner(db, `o-${randomUUID()}@example.test`), {
        plan: "pro",
        expires_at: null,
      });
      const pending = await db.createEvent(await owner(db, `p-${randomUUID()}@example.test`), {
        status: "pending_deletion",
        deleted_at: NOW,
        deletion_reason: "expired",
      });
      for (const id of [pro, pending]) {
        expect(
          await call(db, "public.admin_extend_event($1, 3, $2, $3)", [id, admin, NOW]),
        ).toEqual({
          ok: false,
        });
      }
    }));
});

describe("SPEC 9.3: joindre les administrateurs", () => {
  it("rend l'adresse et la langue des administrateurs, et d'eux seuls", () =>
    withTestDb(async (db) => {
      const email = `q-${randomUUID()}@example.test`;
      const admin = await owner(db, email);
      const plain = await owner(db, `r-${randomUUID()}@example.test`);
      await db.makeAdmin(admin);

      const contacts = await call<{ email: string; locale: string }[]>(
        db,
        "public.admin_contacts()",
        [],
      );
      expect(contacts.map((contact) => contact.email)).toContain(email);
      const text = JSON.stringify(contacts);
      expect(text).not.toContain(String(plain));
      expect(contacts.find((contact) => contact.email === email)?.locale).toBe("fr");
    }));

  it("un administrateur dont la suppression est demandée n'est plus joint", () =>
    withTestDb(async (db) => {
      const email = `s-${randomUUID()}@example.test`;
      const admin = await owner(db, email);
      await db.makeAdmin(admin);
      await db.query("update public.profiles set deleted_at = now() where user_id = $1", [admin]);
      const contacts = await call<{ email: string }[]>(db, "public.admin_contacts()", []);
      expect(contacts.map((contact) => contact.email)).not.toContain(email);
    }));
});

describe("S-001: seul le serveur appelle ces fonctions", () => {
  it("un organisateur, un invité, un administrateur connecté et un visiteur sont refusés", () =>
    withTestDb(async (db) => {
      const user = await owner(db, `t-${randomUUID()}@example.test`);
      const admin = await owner(db, `u-${randomUUID()}@example.test`);
      await db.makeAdmin(admin);
      const guest = await db.createUser({ anonymous: true });
      const event = await db.createEvent(user);
      const calls = [
        ["public.admin_overview(now())", []],
        ["public.admin_list_events(null, 10, 0)", []],
        ["public.admin_list_organisers(null, 10, 0)", []],
        ["public.admin_list_purchases(10, 0)", []],
        ["public.admin_set_event_suspended($1, true, $2)", [event, user]],
        ["public.admin_extend_event($1, 3, $2, now())", [event, user]],
        ["public.admin_contacts()", []],
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
      const allowed = await db.as({ kind: "service" }, (q) =>
        q.query("select public.admin_overview(now()) as answer", []),
      );
      expect(
        Number((allowed.rows[0] as { answer: { events_total: number } }).answer.events_total),
      ).toBeGreaterThan(0);
    }));
});
