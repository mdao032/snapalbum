import { describe, expect, it } from "vitest";
import { withTestDb } from "./harness";

describe("S-001: table events", () => {
  describe("lecture", () => {
    it("autorisé : un organisateur lit ses propres événements", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const mine = await db.createEvent(me);
        const rows = await db.as(
          { kind: "user", id: me },
          async (q) => (await q.query("select id from public.events")).rows,
        );
        expect(rows).toEqual([{ id: mine }]);
      }));

    it("autorisé : un organisateur voit son événement suspendu ou en cours de suppression", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await db.createEvent(me, { status: "suspended" });
        await db.createEvent(me, {
          status: "pending_deletion",
          deleted_at: "2026-10-01T00:00:00Z",
        });
        const rows = await db.as(
          { kind: "user", id: me },
          async (q) => (await q.query("select id from public.events")).rows,
        );
        expect(rows).toHaveLength(2);
      }));

    it("refusé : un organisateur ne voit pas les événements d'un autre", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const other = await db.createUser();
        await db.createEvent(me);
        const theirs = await db.createEvent(other);
        const rows = await db.as(
          { kind: "user", id: me },
          async (q) => (await q.query("select id from public.events where id = $1", [theirs])).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("refusé : un visiteur sans session n'a aucun accès", () =>
      withTestDb(async (db) => {
        await db.createEvent(await db.createUser());
        await expect(
          db.as({ kind: "visitor" }, (q) => q.query("select * from public.events")),
        ).rejects.toThrow(/permission denied/);
      }));

    it("refusé : un invité anonyme ne voit aucun événement", () =>
      withTestDb(async (db) => {
        await db.createEvent(await db.createUser());
        const guest = await db.createUser({ anonymous: true });
        const rows = await db.as(
          { kind: "guest", id: guest },
          async (q) => (await q.query("select id from public.events")).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("autorisé : un administrateur lit tous les événements", () =>
      withTestDb(async (db) => {
        const admin = await db.createUser();
        await db.makeAdmin(admin);
        const a = await db.createEvent(await db.createUser());
        const b = await db.createEvent(await db.createUser());
        const rows = await db.as(
          { kind: "user", id: admin },
          async (q) =>
            (await q.query("select id from public.events where id = any($1)", [[a, b]])).rows,
        );
        expect(rows).toHaveLength(2);
      }));
  });

  describe("modification par l'organisateur", () => {
    it("autorisé : modifie le nom, la langue, le message, l'accent et les réglages (F-011, F-015)", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const event = await db.createEvent(me);
        const count = await db.as(
          { kind: "user", id: me },
          async (q) =>
            (
              await q.query(
                `update public.events
                    set title = 'Nouveau nom', locale = 'en', welcome_message = 'Bienvenue',
                        accent_color = '#6d4aff', settings = '{"gallery_visible": false}'
                  where id = $1`,
                [event],
              )
            ).rowCount,
        );
        expect(count).toBe(1);
      }));

    it("refusé : ne peut modifier ni l'offre, ni le statut, ni les compteurs, ni l'expiration", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const event = await db.createEvent(me);
        const forbidden = [
          "plan = 'pro'",
          "status = 'suspended'",
          "media_count = 5",
          "bytes_used = 5",
          "expires_at = null",
          "deleted_at = now()",
          "event_date = '2027-01-01'",
          "public_code = 'abcdefghjk'",
          `owner_id = '${me}'`,
        ];
        for (const assignment of forbidden) {
          await expect(
            db.as({ kind: "user", id: me }, (q) =>
              q.query(`update public.events set ${assignment} where id = $1`, [event]),
            ),
            assignment,
          ).rejects.toThrow(/permission denied/);
        }
      }));

    it("refusé : ne modifie pas l'événement d'un autre", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const theirs = await db.createEvent(await db.createUser());
        const count = await db.as(
          { kind: "user", id: me },
          async (q) =>
            (await q.query("update public.events set title = 'Pirate' where id = $1", [theirs]))
              .rowCount,
        );
        expect(count).toBe(0);
      }));

    it("refusé : ne modifie plus un événement suspendu ni en cours de suppression", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        for (const status of ["suspended", "pending_deletion"]) {
          const event = await db.createEvent(me, { status });
          const count = await db.as(
            { kind: "user", id: me },
            async (q) =>
              (await q.query("update public.events set title = 'Changé' where id = $1", [event]))
                .rowCount,
          );
          expect(count, status).toBe(0);
        }
      }));

    it("refusé : un invité anonyme ne modifie rien", () =>
      withTestDb(async (db) => {
        const event = await db.createEvent(await db.createUser());
        const guest = await db.createUser({ anonymous: true });
        const count = await db.as(
          { kind: "guest", id: guest },
          async (q) =>
            (await q.query("update public.events set title = 'Pirate' where id = $1", [event]))
              .rowCount,
        );
        expect(count).toBe(0);
      }));

    it("met à jour updated_at à chaque modification", () =>
      withTestDb(async (db) => {
        const event = await db.createEvent(await db.createUser());
        await db.query(
          "update public.events set updated_at = now() - interval '1 day' where id = $1",
          [event],
        );
        await db.query("update public.events set title = 'Autre nom' where id = $1", [event]);
        const { rows } = await db.query(
          "select updated_at > now() - interval '1 minute' as fresh from public.events where id = $1",
          [event],
        );
        expect(rows[0]?.fresh).toBe(true);
      }));
  });

  describe("création et suppression", () => {
    it("refusé : un organisateur ne crée pas d'événement directement (quota vérifié par le serveur)", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(
          db.as({ kind: "user", id: me }, (q) =>
            q.query(
              `insert into public.events (owner_id, public_code, title, event_date, type)
               values ($1, 'k7m2x9qvbr', 'Test', '2026-09-12', 'other')`,
              [me],
            ),
          ),
        ).rejects.toThrow(/permission denied/);
      }));

    it("refusé : un organisateur ne supprime pas d'événement directement (délai de 7 jours, R5)", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await db.createEvent(me);
        await expect(
          db.as({ kind: "user", id: me }, (q) => q.query("delete from public.events")),
        ).rejects.toThrow(/permission denied/);
      }));

    it("autorisé : le service role crée et supprime des événements", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        const created = await db.as({ kind: "service" }, async (q) =>
          q.query(
            `insert into public.events (owner_id, public_code, title, event_date, type)
             values ($1, 'k7m2x9qvbr', 'Test', '2026-09-12', 'other') returning id`,
            [me],
          ),
        );
        expect(created.rowCount).toBe(1);
        const removed = await db.as({ kind: "service" }, async (q) =>
          q.query("delete from public.events where public_code = 'k7m2x9qvbr'"),
        );
        expect(removed.rowCount).toBe(1);
      }));
  });

  describe("contraintes d'intégrité", () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["code trop court", { public_code: "k7m2x9qvb" }, /check constraint/],
      ["code avec caractère ambigu", { public_code: "k7m2x9qvb0" }, /check constraint/],
      ["nom vide", { title: "   " }, /check constraint/],
      ["nom de plus de 80 caractères", { title: "a".repeat(81) }, /check constraint/],
      ["type inconnu", { type: "festival" }, /check constraint/],
      ["langue inconnue", { locale: "de" }, /check constraint/],
      [
        "message de plus de 500 caractères",
        { welcome_message: "a".repeat(501) },
        /check constraint/,
      ],
      ["couleur mal formée", { accent_color: "violet" }, /check constraint/],
      ["offre inconnue", { plan: "gold" }, /check constraint/],
      ["statut inconnu", { status: "deleted" }, /check constraint/],
      ["réglages qui ne sont pas un objet", { settings: "[]" }, /check constraint/],
      ["compteur négatif", { media_count: -1 }, /check constraint/],
    ];

    it.each(cases)("refuse : %s", (_label, overrides, expected) =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await expect(db.createEvent(me, overrides)).rejects.toThrow(expected);
      }),
    );

    it("F-012: refuse deux événements avec le même code public", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await db.createEvent(me, { public_code: "k7m2x9qvbr" });
        await expect(db.createEvent(me, { public_code: "k7m2x9qvbr" })).rejects.toThrow(
          /duplicate key/,
        );
      }));

    it("empêche de supprimer un compte qui possède des événements (purge d'abord)", () =>
      withTestDb(async (db) => {
        const me = await db.createUser();
        await db.createEvent(me);
        await expect(db.query("delete from auth.users where id = $1", [me])).rejects.toThrow(
          /violates foreign key constraint/,
        );
      }));
  });
});
