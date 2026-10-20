import { describe, expect, it } from "vitest";
import { withTestDb } from "./harness";

describe("S-001: table profiles", () => {
  it("crée un profil à l'inscription d'un organisateur", () =>
    withTestDb(async (db) => {
      const id = await db.createUser({ metadata: { full_name: "Léa Martin", locale: "en" } });
      const { rows } = await db.query(
        "select display_name, locale, role from public.profiles where user_id = $1",
        [id],
      );
      expect(rows).toEqual([{ display_name: "Léa Martin", locale: "en", role: "user" }]);
    }));

  it("utilise le français quand la langue demandée est inconnue", () =>
    withTestDb(async (db) => {
      const id = await db.createUser({ metadata: { locale: "de" } });
      const { rows } = await db.query("select locale from public.profiles where user_id = $1", [
        id,
      ]);
      expect(rows[0]?.locale).toBe("fr");
    }));

  it("F-035: ne crée pas de profil pour une session invité anonyme", () =>
    withTestDb(async (db) => {
      const id = await db.createUser({ anonymous: true });
      const { rowCount } = await db.query("select 1 from public.profiles where user_id = $1", [id]);
      expect(rowCount).toBe(0);
    }));

  describe("lecture", () => {
    it("autorisé : un organisateur lit son propre profil", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const rows = await db.as(
          { kind: "user", id: me },
          async (q) => (await q.query("select user_id from public.profiles")).rows,
        );
        expect(rows).toEqual([{ user_id: me }]);
      }));

    it("refusé : un organisateur ne voit pas le profil d'un autre", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const other = await db.createUser();
        const rows = await db.as(
          { kind: "user", id: me },
          async (q) =>
            (await q.query("select 1 from public.profiles where user_id = $1", [other])).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("refusé : un visiteur sans session n'a aucun accès", () =>
      withTestDb(async (db) => {
        await db.createUser();
        await expect(
          db.as({ kind: "visitor" }, (q) => q.query("select * from public.profiles")),
        ).rejects.toThrow(/permission denied/);
      }));

    it("refusé : un invité anonyme ne voit aucun profil", () =>
      withTestDb(async (db) => {
        await db.createUser();
        const guest = await db.createUser({ anonymous: true });
        const rows = await db.as(
          { kind: "guest", id: guest },
          async (q) => (await q.query("select 1 from public.profiles")).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("autorisé : un administrateur lit tous les profils", () =>
      withTestDb(async (db) => {
        const admin = await db.createUser();
        const user = await db.createUser();
        await db.makeAdmin(admin);
        const rows = await db.as(
          { kind: "user", id: admin },
          async (q) =>
            (
              await q.query("select user_id from public.profiles where user_id = any($1)", [
                [admin, user],
              ])
            ).rows,
        );
        expect(rows).toHaveLength(2);
      }));

    it("refusé : un administrateur supprimé (deleted_at) perd ses droits", () =>
      withTestDb(async (db) => {
        const admin = await db.createUser();
        const user = await db.createUser();
        await db.makeAdmin(admin);
        await db.query("update public.profiles set deleted_at = now() where user_id = $1", [admin]);
        const rows = await db.as(
          { kind: "user", id: admin },
          async (q) =>
            (await q.query("select user_id from public.profiles where user_id = $1", [user])).rows,
        );
        expect(rows).toHaveLength(0);
      }));
  });

  describe("modification", () => {
    it("autorisé : un organisateur modifie son nom et sa langue (F-003)", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const count = await db.as(
          { kind: "user", id: me },
          async (q) =>
            (
              await q.query(
                "update public.profiles set display_name = 'Tom', locale = 'en' where user_id = $1",
                [me],
              )
            ).rowCount,
        );
        expect(count).toBe(1);
      }));

    it("met à jour updated_at à chaque modification", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await db.query(
          "update public.profiles set updated_at = now() - interval '1 day' where user_id = $1",
          [me],
        );
        await db.query("update public.profiles set display_name = 'Tom' where user_id = $1", [me]);
        const { rows } = await db.query(
          "select updated_at > now() - interval '1 minute' as fresh from public.profiles where user_id = $1",
          [me],
        );
        expect(rows[0]?.fresh).toBe(true);
      }));

    it("refusé : un organisateur ne peut pas se donner le rôle administrateur", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(
          db.as({ kind: "user", id: me }, (q) =>
            q.query("update public.profiles set role = 'admin' where user_id = $1", [me]),
          ),
        ).rejects.toThrow(/permission denied/);
      }));

    it("refusé : un organisateur ne peut pas modifier deleted_at ni user_id", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        for (const assignment of ["deleted_at = now()", `user_id = '${me}'`]) {
          await expect(
            db.as({ kind: "user", id: me }, (q) =>
              q.query(`update public.profiles set ${assignment} where user_id = $1`, [me]),
            ),
          ).rejects.toThrow(/permission denied/);
        }
      }));

    it("refusé : un organisateur ne modifie pas le profil d'un autre", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const other = await db.createUser();
        const count = await db.as(
          { kind: "user", id: me },
          async (q) =>
            (
              await q.query(
                "update public.profiles set display_name = 'Pirate' where user_id = $1",
                [other],
              )
            ).rowCount,
        );
        expect(count).toBe(0);
      }));

    it("refusé : une langue inconnue est rejetée", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(
          db.as({ kind: "user", id: me }, (q) =>
            q.query("update public.profiles set locale = 'xx' where user_id = $1", [me]),
          ),
        ).rejects.toThrow(/check constraint/);
      }));
  });

  describe("création et suppression", () => {
    it("refusé : un organisateur ne peut pas insérer de profil directement", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(
          db.as({ kind: "user", id: me }, (q) =>
            q.query("insert into public.profiles (user_id) values (gen_random_uuid())"),
          ),
        ).rejects.toThrow(/permission denied/);
      }));

    it("refusé : un organisateur ne peut pas supprimer de profil", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(
          db.as({ kind: "user", id: me }, (q) => q.query("delete from public.profiles")),
        ).rejects.toThrow(/permission denied/);
      }));

    it("autorisé : le service role gère les profils (suppression de compte, F-004)", () =>
      withTestDb(async (db) => {
        const user = await db.createUser();
        const count = await db.as(
          { kind: "service" },
          async (q) =>
            (await q.query("delete from public.profiles where user_id = $1", [user])).rowCount,
        );
        expect(count).toBe(1);
      }));
  });
});
