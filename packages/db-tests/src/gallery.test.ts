import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type TestDb } from "./harness";

const token = () => randomBytes(24).toString("base64url");

async function setup(db: TestDb) {
  const organiser = await db.createUser();
  const event = await db.createEvent(organiser);
  const guestUser = await db.createUser({ anonymous: true });
  const guest = await db.createGuest(event, guestUser);
  return { organiser, event, guestUser, guest };
}

describe("F-052: date de tri des médias", () => {
  it("F-052: captured_at vaut la date de prise de vue, ou la date d'envoi à défaut", () =>
    withTestDb(async (db) => {
      const { event, guest } = await setup(db);
      const withDate = await db.createMedia(event, guest, { taken_at: "2026-09-12T15:30:00Z" });
      const without = await db.createMedia(event, guest, { taken_at: null });
      const { rows } = await db.query<{ id: string; captured_at: Date; created_at: Date }>(
        "select id, captured_at, created_at from public.media where event_id = $1",
        [event],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(withDate)!.captured_at.toISOString()).toBe("2026-09-12T15:30:00.000Z");
      expect(byId.get(without)!.captured_at.getTime()).toBe(
        byId.get(without)!.created_at.getTime(),
      );
    }));

  it("F-052: captured_at suit la date de prise de vue quand elle est corrigée", () =>
    withTestDb(async (db) => {
      const { event, guest } = await setup(db);
      const media = await db.createMedia(event, guest, { taken_at: "2026-09-12T15:30:00Z" });
      await db.query("update public.media set taken_at = '2026-09-13T08:00:00Z' where id = $1", [
        media,
      ]);
      const { rows } = await db.query<{ captured_at: Date }>(
        "select captured_at from public.media where id = $1",
        [media],
      );
      expect(rows[0]!.captured_at.toISOString()).toBe("2026-09-13T08:00:00.000Z");
    }));
});

describe("S-001: table share_links", () => {
  it("autorisé : l'organisateur lit les liens de partage de ses événements", () =>
    withTestDb(async (db) => {
      const { organiser, event } = await setup(db);
      await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
        event,
        token(),
      ]);
      const rows = await db.as(
        { kind: "user", id: organiser },
        async (q) => (await q.query("select id from public.share_links")).rows,
      );
      expect(rows).toHaveLength(1);
    }));

  it("autorisé : un administrateur lit tous les liens de partage", () =>
    withTestDb(async (db) => {
      const { event } = await setup(db);
      await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
        event,
        token(),
      ]);
      const admin = await db.createUser();
      await db.makeAdmin(admin);
      const rows = await db.as(
        { kind: "user", id: admin },
        async (q) => (await q.query("select id from public.share_links")).rows,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }));

  it("refusé : un autre organisateur ne voit pas les liens d'un événement qui n'est pas le sien", () =>
    withTestDb(async (db) => {
      const { event } = await setup(db);
      await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
        event,
        token(),
      ]);
      const stranger = await db.createUser();
      const rows = await db.as(
        { kind: "user", id: stranger },
        async (q) =>
          (await q.query("select id from public.share_links where event_id = $1", [event])).rows,
      );
      expect(rows).toHaveLength(0);
    }));

  it("refusé : un invité ne voit aucun lien de partage, même de son événement", () =>
    withTestDb(async (db) => {
      const { event, guestUser } = await setup(db);
      await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
        event,
        token(),
      ]);
      const rows = await db.as(
        { kind: "guest", id: guestUser },
        async (q) => (await q.query("select id from public.share_links")).rows,
      );
      expect(rows).toHaveLength(0);
    }));

  it("refusé : un visiteur sans session n'a aucun accès", () =>
    withTestDb(async (db) => {
      await setup(db);
      await expect(
        db.as({ kind: "visitor" }, (q) => q.query("select * from public.share_links")),
      ).rejects.toThrow(/permission denied/);
    }));

  it.each([
    [
      "insert",
      "insert into public.share_links (event_id, token) values ($1, '" + "a".repeat(32) + "')",
    ],
    ["update", "update public.share_links set revoked_at = now() where event_id = $1"],
    ["delete", "delete from public.share_links where event_id = $1"],
  ])(
    "refusé : l'organisateur ne peut pas faire de %s directement (écriture réservée au serveur)",
    (_name, sql) =>
      withTestDb(async (db) => {
        const { organiser, event } = await setup(db);
        await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
          event,
          token(),
        ]);
        await expect(
          db.as({ kind: "user", id: organiser }, (q) => q.query(sql, [event])),
        ).rejects.toThrow(/permission denied/);
      }),
  );

  it("refusé : un jeton trop court est rejeté", () =>
    withTestDb(async (db) => {
      const { event } = await setup(db);
      await expect(
        db.query("insert into public.share_links (event_id, token) values ($1, 'court')", [event]),
      ).rejects.toThrow(/check/);
    }));

  it("refusé : deux liens ne peuvent pas partager le même jeton", () =>
    withTestDb(async (db) => {
      const { event } = await setup(db);
      const shared = token();
      await db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
        event,
        shared,
      ]);
      await expect(
        db.query("insert into public.share_links (event_id, token) values ($1, $2)", [
          event,
          shared,
        ]),
      ).rejects.toThrow(/unique/);
    }));
});
