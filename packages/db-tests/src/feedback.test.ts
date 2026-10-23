import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type Queryable, type TestDb } from "./harness";

/**
 * Step 6.2: feedback from organisers and guests during the field beta. Written by the server with
 * the service role; read and marked as handled by the administrators; closed to the API.
 */

interface Page {
  total: number;
  open: number;
  average: number;
  rows: {
    id: string;
    audience: string;
    rating: number;
    handled_at: string | null;
    author_email: string | null;
  }[];
}

const list = async (db: Queryable) =>
  (await db.query<{ answer: Page }>("select public.admin_list_feedback(50, 0) as answer")).rows[0]!
    .answer;

async function insertFeedback(
  db: TestDb,
  values: {
    user: string;
    event?: string | null;
    audience?: string;
    rating?: number;
    message?: string;
  },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.feedback (event_id, audience, user_id, rating, message, locale)
     values ($1, $2, $3, $4, $5, 'fr') returning id`,
    [
      values.event ?? null,
      values.audience ?? "organiser",
      values.user,
      values.rating ?? 4,
      values.message ?? "",
    ],
  );
  return rows[0]!.id;
}

describe("6.2: avis", () => {
  it("la note va de 1 à 5 et le commentaire fait 1 000 caractères au plus", () =>
    withTestDb(async (db) => {
      const user = await db.createUser({ email: `a-${randomUUID()}@example.test` });
      // Run as the server: a refused statement is rolled back on its own, the test goes on.
      const refused = (values: Parameters<typeof insertFeedback>[1]) =>
        db.as({ kind: "service" }, (q) =>
          insertFeedback({ ...db, query: q.query.bind(q) }, values),
        );
      for (const rating of [0, 6]) {
        await expect(refused({ user, rating }), `note ${rating}`).rejects.toThrow();
      }
      await expect(refused({ user, message: "x".repeat(1001) })).rejects.toThrow();
      await expect(refused({ user, audience: "visitor" })).rejects.toThrow();
      expect(await insertFeedback(db, { user, rating: 5, message: "x".repeat(1000) })).toBeTruthy();
    }));

  it("la liste donne les avis non traités d'abord, la note moyenne et l'adresse des organisateurs seulement", () =>
    withTestDb(async (db) => {
      const before = await list(db);
      const email = `o-${randomUUID()}@example.test`;
      const organiser = await db.createUser({ email });
      const guest = await db.createUser({ anonymous: true });
      const event = await db.createEvent(organiser);

      const handled = await insertFeedback(db, { user: organiser, event, rating: 2 });
      await db.query("update public.feedback set handled_at = now() where id = $1", [handled]);
      const fromGuest = await insertFeedback(db, {
        user: guest,
        event,
        audience: "guest",
        rating: 5,
      });
      const fromOrganiser = await insertFeedback(db, { user: organiser, event, rating: 4 });

      const after = await list(db);
      expect(after.total - before.total).toBe(3);
      expect(after.open - before.open).toBe(2);
      expect(after.average).toBeGreaterThan(0);

      const ours = after.rows.filter((row) => [handled, fromGuest, fromOrganiser].includes(row.id));
      // Open ones come before the handled one.
      expect(ours.map((row) => row.id).indexOf(handled)).toBe(2);
      expect(ours.find((row) => row.id === fromOrganiser)?.author_email).toBe(email);
      expect(ours.find((row) => row.id === fromGuest)?.author_email).toBeNull();
    }));

  it("marquer comme traité, puis rouvrir, écrit l'audit ; un avis inconnu est refusé", () =>
    withTestDb(async (db) => {
      const user = await db.createUser({ email: `a-${randomUUID()}@example.test` });
      const admin = await db.createUser({ email: `b-${randomUUID()}@example.test` });
      await db.makeAdmin(admin);
      const id = await insertFeedback(db, { user });
      const call = async (handled: boolean, target = id) =>
        (
          await db.query<{ answer: { ok: boolean } }>(
            "select public.admin_set_feedback_handled($1, $2, $3) as answer",
            [admin, target, handled],
          )
        ).rows[0]!.answer;

      expect(await call(true)).toEqual({ ok: true });
      const handledAt = (
        await db.query<{ handled_at: string | null }>(
          "select handled_at from public.feedback where id = $1",
          [id],
        )
      ).rows[0]!.handled_at;
      expect(handledAt).not.toBeNull();
      expect(await call(false)).toEqual({ ok: true });
      expect(await call(true, randomUUID())).toEqual({ ok: false });

      const audit = await db.query(
        "select action from public.audit_log where target_id = $1 order by action",
        [id],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        "admin.feedback.handle",
        "admin.feedback.reopen",
      ]);
    }));

  it("un avis disparaît avec le compte qui l'a écrit, et reste sans son événement", () =>
    withTestDb(async (db) => {
      const user = await db.createUser({ email: `a-${randomUUID()}@example.test` });
      const event = await db.createEvent(user);
      const id = await insertFeedback(db, { user, event });
      await db.query("delete from public.events where id = $1", [event]);
      const kept = await db.query("select event_id from public.feedback where id = $1", [id]);
      expect(kept.rows).toEqual([{ event_id: null }]);

      await db.query("delete from auth.users where id = $1", [user]);
      const gone = await db.query("select 1 from public.feedback where id = $1", [id]);
      expect(gone.rowCount).toBe(0);
    }));

  it("la table et les fonctions ne sont ouvertes qu'au serveur (rôle de service)", () =>
    withTestDb(async (db) => {
      const user = await db.createUser({ email: `a-${randomUUID()}@example.test` });
      const admin = await db.createUser({ email: `b-${randomUUID()}@example.test` });
      await db.makeAdmin(admin);
      const guest = await db.createUser({ anonymous: true });
      const actors = [
        { kind: "user", id: user },
        { kind: "user", id: admin },
        { kind: "guest", id: guest },
        { kind: "visitor" },
      ] as const;
      for (const actor of actors) {
        for (const sql of [
          "select * from public.feedback",
          "delete from public.feedback",
          "select public.admin_list_feedback(10, 0)",
          `select public.admin_set_feedback_handled('${admin}', '${randomUUID()}', true)`,
        ]) {
          await expect(
            db.as(actor, (q) => q.query(sql)),
            `${sql} par ${actor.kind}`,
          ).rejects.toThrow(/permission denied/);
        }
      }
    }));
});
