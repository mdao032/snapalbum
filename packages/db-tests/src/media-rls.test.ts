import { describe, expect, it } from "vitest";
import { withTestDb, type TestDb } from "./harness";

/** An event with its organiser, and a guest with a media of their own. */
async function setup(db: TestDb, settings?: Record<string, unknown>) {
  const organiser = await db.createUser();
  const event = await db.createEvent(
    organiser,
    settings ? { settings: JSON.stringify(settings) } : {},
  );
  const guestUser = await db.createUser({ anonymous: true });
  const guest = await db.createGuest(event, guestUser);
  const media = await db.createMedia(event, guest);
  return { organiser, event, guestUser, guest, media };
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("S-001: table guests", () => {
  it("autorisé : un invité lit sa propre ligne, et seulement la sienne", () =>
    withTestDb(async (db) => {
      const { event, guestUser, guest } = await setup(db);
      const otherUser = await db.createUser({ anonymous: true });
      await db.createGuest(event, otherUser);
      const rows = await db.as(
        { kind: "guest", id: guestUser },
        async (q) => (await q.query<{ id: string }>("select id from public.guests")).rows,
      );
      expect(ids(rows)).toEqual([guest]);
    }));

  it("autorisé : l'organisateur lit les invités de ses événements", () =>
    withTestDb(async (db) => {
      const { organiser, guest } = await setup(db);
      await setup(db);
      const rows = await db.as(
        { kind: "user", id: organiser },
        async (q) => (await q.query<{ id: string }>("select id from public.guests")).rows,
      );
      expect(ids(rows)).toEqual([guest]);
    }));

  it("autorisé : un administrateur lit tous les invités", () =>
    withTestDb(async (db) => {
      await setup(db);
      await setup(db);
      const admin = await db.createUser();
      await db.makeAdmin(admin);
      const rows = await db.as(
        { kind: "user", id: admin },
        async (q) => (await q.query<{ id: string }>("select id from public.guests")).rows,
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    }));

  it("refusé : un autre organisateur ou un inconnu ne voit aucun invité", () =>
    withTestDb(async (db) => {
      const { event } = await setup(db);
      const stranger = await db.createUser();
      const rows = await db.as(
        { kind: "user", id: stranger },
        async (q) =>
          (await q.query("select id from public.guests where event_id = $1", [event])).rows,
      );
      expect(rows).toHaveLength(0);
    }));

  it("refusé : un visiteur sans session n'a aucun accès", () =>
    withTestDb(async (db) => {
      await setup(db);
      await expect(
        db.as({ kind: "visitor" }, (q) => q.query("select * from public.guests")),
      ).rejects.toThrow(/permission denied/);
    }));

  it("autorisé : un invité modifie son prénom", () =>
    withTestDb(async (db) => {
      const { guestUser, guest } = await setup(db);
      await db.as({ kind: "guest", id: guestUser }, (q) =>
        q.query("update public.guests set display_name = 'Élodie' where id = $1", [guest]),
      );
      const { rows } = await db.query("select display_name from public.guests where id = $1", [
        guest,
      ]);
      expect(rows[0]).toEqual({ display_name: "Élodie" });
    }));

  it.each([
    "blocked_at = now()",
    "terms_accepted_at = null",
    "notify_consent_at = now()",
    "event_id = gen_random_uuid()",
  ])("refusé : un invité ne peut pas écrire %s (colonnes réservées au serveur)", (assignment) =>
    withTestDb(async (db) => {
      const { guestUser, guest } = await setup(db);
      await expect(
        db.as({ kind: "guest", id: guestUser }, (q) =>
          q.query(`update public.guests set ${assignment} where id = $1`, [guest]),
        ),
      ).rejects.toThrow(/permission denied/);
    }),
  );

  it("refusé : un invité ne modifie pas le prénom d'un autre invité", () =>
    withTestDb(async (db) => {
      const { event, guest } = await setup(db);
      const otherUser = await db.createUser({ anonymous: true });
      await db.createGuest(event, otherUser);
      const result = await db.as({ kind: "guest", id: otherUser }, (q) =>
        q.query("update public.guests set display_name = 'Pirate' where id = $1", [guest]),
      );
      expect(result.rowCount).toBe(0);
    }));

  it("refusé : ni invité ni organisateur ne peut créer ou supprimer un invité", () =>
    withTestDb(async (db) => {
      const { organiser, event, guestUser, guest } = await setup(db);
      const other = await db.createUser({ anonymous: true });
      for (const actor of [
        { kind: "guest", id: guestUser },
        { kind: "user", id: organiser },
      ] as const) {
        await expect(
          db.as(actor, (q) =>
            q.query("insert into public.guests (event_id, auth_user_id) values ($1, $2)", [
              event,
              other,
            ]),
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.as(actor, (q) => q.query("delete from public.guests where id = $1", [guest])),
        ).rejects.toThrow(/permission denied/);
      }
    }));

  it("refusé : l'organisateur ne bloque pas un invité lui-même (passage par le serveur)", () =>
    withTestDb(async (db) => {
      const { organiser, guest } = await setup(db);
      await expect(
        db.as({ kind: "user", id: organiser }, (q) =>
          q.query("update public.guests set blocked_at = now() where id = $1", [guest]),
        ),
      ).rejects.toThrow(/permission denied/);
    }));
});

describe("S-001: table media", () => {
  it("autorisé : un invité lit ses propres médias, même masqués ou en attente de validation", () =>
    withTestDb(async (db) => {
      const { event, guestUser, guest } = await setup(db);
      const hidden = await db.createMedia(event, guest, { status: "hidden" });
      const waiting = await db.createMedia(event, guest, { moderation: "pending" });
      const rows = await db.as(
        { kind: "guest", id: guestUser },
        async (q) => (await q.query<{ id: string }>("select id from public.media")).rows,
      );
      expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([hidden, waiting]));
      expect(rows).toHaveLength(3);
    }));

  it("autorisé : l'organisateur lit tous les médias de ses événements, et d'eux seuls", () =>
    withTestDb(async (db) => {
      const { organiser, event, guest } = await setup(db);
      const pending = await db.createMedia(event, guest, {
        status: "pending",
        moderation: "pending",
      });
      await setup(db);
      const rows = await db.as(
        { kind: "user", id: organiser },
        async (q) => (await q.query<{ id: string }>("select id from public.media")).rows,
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toContain(pending);
    }));

  describe("galerie (F-039)", () => {
    it("autorisé : un invité voit les médias approuvés des autres quand la galerie est ouverte", () =>
      withTestDb(async (db) => {
        const { event, guest } = await setup(db, { gallery_visible: true });
        const viewer = await db.createUser({ anonymous: true });
        await db.createGuest(event, viewer);
        const rows = await db.as(
          { kind: "guest", id: viewer },
          async (q) =>
            (
              await q.query<{ id: string }>("select id from public.media where guest_id = $1", [
                guest,
              ])
            ).rows,
        );
        expect(rows).toHaveLength(1);
      }));

    it("refusé : galerie fermée par l'organisateur", () =>
      withTestDb(async (db) => {
        const { event, guest } = await setup(db, { gallery_visible: false });
        const viewer = await db.createUser({ anonymous: true });
        await db.createGuest(event, viewer);
        const rows = await db.as(
          { kind: "guest", id: viewer },
          async (q) =>
            (await q.query("select id from public.media where guest_id = $1", [guest])).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("refusé : une valeur de réglage qui n'est pas vraiment « vrai » ferme la galerie (jamais d'erreur)", () =>
      withTestDb(async (db) => {
        for (const value of ['"yes"', "1", "null", '{"a":1}']) {
          const { event, guest } = await setup(db, { gallery_visible: JSON.parse(value) });
          const viewer = await db.createUser({ anonymous: true });
          await db.createGuest(event, viewer);
          const rows = await db.as(
            { kind: "guest", id: viewer },
            async (q) =>
              (await q.query("select id from public.media where guest_id = $1", [guest])).rows,
          );
          expect(rows, value).toHaveLength(0);
        }
      }));

    it("refusé : média en attente de validation, masqué, rejeté ou pas encore confirmé", () =>
      withTestDb(async (db) => {
        const { event, guest } = await setup(db, { gallery_visible: true });
        for (const overrides of [
          { moderation: "pending" },
          { moderation: "rejected" },
          { status: "hidden" },
          { status: "pending" },
          { status: "deleted" },
        ]) {
          await db.createMedia(event, guest, overrides);
        }
        const viewer = await db.createUser({ anonymous: true });
        await db.createGuest(event, viewer);
        const rows = await db.as(
          { kind: "guest", id: viewer },
          async (q) =>
            (await q.query("select id from public.media where guest_id = $1", [guest])).rows,
        );
        expect(rows).toHaveLength(1);
      }));

    it("refusé : un invité bloqué ne voit plus la galerie", () =>
      withTestDb(async (db) => {
        const { event, guest } = await setup(db, { gallery_visible: true });
        const viewer = await db.createUser({ anonymous: true });
        await db.createGuest(event, viewer, { blocked_at: new Date().toISOString() });
        const rows = await db.as(
          { kind: "guest", id: viewer },
          async (q) =>
            (await q.query("select id from public.media where guest_id = $1", [guest])).rows,
        );
        expect(rows).toHaveLength(0);
      }));

    it("refusé : la galerie d'un autre événement, ou d'un événement suspendu", () =>
      withTestDb(async (db) => {
        const { guest } = await setup(db, { gallery_visible: true });
        const otherOrganiser = await db.createUser();
        const otherEvent = await db.createEvent(otherOrganiser);
        const stranger = await db.createUser({ anonymous: true });
        await db.createGuest(otherEvent, stranger);
        const none = await db.as(
          { kind: "guest", id: stranger },
          async (q) =>
            (await q.query("select id from public.media where guest_id = $1", [guest])).rows,
        );
        expect(none).toHaveLength(0);

        const suspendedOrganiser = await db.createUser();
        const suspended = await db.createEvent(suspendedOrganiser, {
          status: "suspended",
          settings: JSON.stringify({ gallery_visible: true }),
        });
        const author = await db.createUser({ anonymous: true });
        const authorGuest = await db.createGuest(suspended, author);
        await db.createMedia(suspended, authorGuest);
        const viewer = await db.createUser({ anonymous: true });
        await db.createGuest(suspended, viewer);
        const rows = await db.as(
          { kind: "guest", id: viewer },
          async (q) =>
            (await q.query("select id from public.media where guest_id = $1", [authorGuest])).rows,
        );
        expect(rows).toHaveLength(0);
      }));
  });

  it("refusé : un inconnu et un visiteur ne voient aucun média", () =>
    withTestDb(async (db) => {
      await setup(db, { gallery_visible: true });
      const stranger = await db.createUser();
      const rows = await db.as(
        { kind: "user", id: stranger },
        async (q) => (await q.query("select id from public.media")).rows,
      );
      expect(rows).toHaveLength(0);
      await expect(
        db.as({ kind: "visitor" }, (q) => q.query("select * from public.media")),
      ).rejects.toThrow(/permission denied/);
    }));

  it("refusé : personne n'écrit directement dans media (ni invité, ni organisateur)", () =>
    withTestDb(async (db) => {
      const { organiser, event, guestUser, guest, media } = await setup(db);
      for (const actor of [
        { kind: "guest", id: guestUser },
        { kind: "user", id: organiser },
      ] as const) {
        await expect(
          db.as(actor, (q) =>
            q.query(
              `insert into public.media (event_id, guest_id, kind, sha256, mime_type)
               values ($1, $2, 'photo', repeat('a', 64), 'image/jpeg')`,
              [event, guest],
            ),
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.as(actor, (q) =>
            q.query("update public.media set status = 'ready' where id = $1", [media]),
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.as(actor, (q) => q.query("delete from public.media where id = $1", [media])),
        ).rejects.toThrow(/permission denied/);
      }
    }));
});

describe("S-001: table uploads", () => {
  it("refusé : aucun acteur, pas même l'organisateur, ne lit ni n'écrit uploads", () =>
    withTestDb(async (db) => {
      const { organiser, guestUser, media } = await setup(db);
      await db.query(
        "insert into public.uploads (media_id, multipart_upload_id, expires_at) values ($1, 'u', now() + interval '1 day')",
        [media],
      );
      for (const actor of [
        { kind: "guest", id: guestUser },
        { kind: "user", id: organiser },
        { kind: "visitor" },
      ] as const) {
        await expect(db.as(actor, (q) => q.query("select * from public.uploads"))).rejects.toThrow(
          /permission denied/,
        );
      }
      await expect(
        db.as({ kind: "user", id: organiser }, (q) => q.query("delete from public.uploads")),
      ).rejects.toThrow(/permission denied/);
    }));

  it("autorisé : le service y accède (envoi en morceaux)", () =>
    withTestDb(async (db) => {
      const { media } = await setup(db);
      await db.as({ kind: "service" }, (q) =>
        q.query(
          "insert into public.uploads (media_id, multipart_upload_id, expires_at) values ($1, 'u', now() + interval '1 day')",
          [media],
        ),
      );
      const rows = await db.as(
        { kind: "service" },
        async (q) => (await q.query("select id from public.uploads")).rows,
      );
      expect(rows).toHaveLength(1);
    }));
});
