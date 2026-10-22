import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTestDb, type TestDb } from "./harness";

const fingerprint = () => randomBytes(32).toString("hex");

async function setup(db: TestDb) {
  const organiser = await db.createUser();
  const event = await db.createEvent(organiser);
  const guestUser = await db.createUser({ anonymous: true });
  const guest = await db.createGuest(event, guestUser);
  const media = await db.createMedia(event, guest);
  return { organiser, event, guestUser, guest, media };
}

const addReport = (db: TestDb, media: string, reason = "inappropriate") =>
  db.query(
    "insert into public.reports (media_id, reason, reporter_fingerprint) values ($1, $2, $3)",
    [media, reason, fingerprint()],
  );

describe("S-001: table reports (F-073)", () => {
  it("autorisé : l'organisateur de l'événement lit les signalements de ses médias", () =>
    withTestDb(async (db) => {
      const { organiser, media } = await setup(db);
      await addReport(db, media);
      const rows = await db.as(
        { kind: "user", id: organiser },
        async (q) => (await q.query("select id from public.reports")).rows,
      );
      expect(rows).toHaveLength(1);
    }));

  it("autorisé : un administrateur lit tous les signalements", () =>
    withTestDb(async (db) => {
      const { media } = await setup(db);
      await addReport(db, media);
      const admin = await db.createUser();
      await db.makeAdmin(admin);
      const rows = await db.as(
        { kind: "user", id: admin },
        async (q) => (await q.query("select id from public.reports")).rows,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }));

  it("refusé : un autre organisateur, un invité (même auteur du média) et un visiteur ne voient rien", () =>
    withTestDb(async (db) => {
      const { media, guestUser } = await setup(db);
      await addReport(db, media);
      const stranger = await db.createUser();
      const asStranger = await db.as(
        { kind: "user", id: stranger },
        async (q) => (await q.query("select id from public.reports")).rows,
      );
      expect(asStranger).toHaveLength(0);
      const asGuest = await db.as(
        { kind: "guest", id: guestUser },
        async (q) => (await q.query("select id from public.reports")).rows,
      );
      expect(asGuest).toHaveLength(0);
      await expect(
        db.as({ kind: "visitor" }, (q) => q.query("select * from public.reports")),
      ).rejects.toThrow(/permission denied/);
    }));

  it.each([
    [
      "insert",
      "insert into public.reports (media_id, reason, reporter_fingerprint) select id, 'other', repeat('a', 64) from public.media",
    ],
    ["update", "update public.reports set resolved_at = now()"],
    ["delete", "delete from public.reports"],
  ])(
    "refusé : l'organisateur ne peut pas faire de %s directement (écriture réservée au serveur)",
    (_name, sql) =>
      withTestDb(async (db) => {
        const { organiser, media } = await setup(db);
        await addReport(db, media);
        await expect(db.as({ kind: "user", id: organiser }, (q) => q.query(sql))).rejects.toThrow(
          /permission denied/,
        );
      }),
  );

  it("F-073: la même personne ne signale qu'une fois le même média, un motif inconnu est refusé", () =>
    withTestDb(async (db) => {
      const { media } = await setup(db);
      const same = fingerprint();
      // Each refusal runs in its own savepoint: a failed statement must not abort the test.
      const insert = (reason: string, who: string) =>
        db.as({ kind: "service" }, (q) =>
          q.query(
            "insert into public.reports (media_id, reason, reporter_fingerprint) values ($1, $2, $3)",
            [media, reason, who],
          ),
        );
      await insert("other", same);
      await expect(insert("private", same)).rejects.toThrow(/unique/);
      await expect(insert("spam", fingerprint())).rejects.toThrow(/check/);
      await expect(insert("other", "pas-une-empreinte")).rejects.toThrow(/check/);
    }));

  it("F-073: supprimer le média supprime ses signalements", () =>
    withTestDb(async (db) => {
      const { media } = await setup(db);
      await addReport(db, media);
      await db.query("delete from public.media where id = $1", [media]);
      const { rows } = await db.query("select id from public.reports where media_id = $1", [media]);
      expect(rows).toHaveLength(0);
    }));
});

describe("S-001: table audit_log", () => {
  const log = (db: TestDb, actor: string) =>
    db.query(
      "insert into public.audit_log (actor_id, action, target_type, metadata) values ($1, 'media.delete', 'event', '{\"count\": 3}')",
      [actor],
    );

  it("autorisé : un administrateur lit le journal", () =>
    withTestDb(async (db) => {
      const { organiser } = await setup(db);
      await log(db, organiser);
      const admin = await db.createUser();
      await db.makeAdmin(admin);
      const rows = await db.as(
        { kind: "user", id: admin },
        async (q) => (await q.query("select id from public.audit_log")).rows,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }));

  it("refusé : ni l'organisateur (même auteur de l'action), ni un invité, ni un visiteur ne lisent le journal", () =>
    withTestDb(async (db) => {
      const { organiser, guestUser } = await setup(db);
      await log(db, organiser);
      for (const actor of [
        { kind: "user", id: organiser },
        { kind: "guest", id: guestUser },
      ] as const) {
        const rows = await db.as(
          actor,
          async (q) => (await q.query("select id from public.audit_log")).rows,
        );
        expect(rows).toHaveLength(0);
      }
      await expect(
        db.as({ kind: "visitor" }, (q) => q.query("select * from public.audit_log")),
      ).rejects.toThrow(/permission denied/);
    }));

  it("refusé : personne ne peut écrire dans le journal sauf le serveur", () =>
    withTestDb(async (db) => {
      const { organiser } = await setup(db);
      await expect(
        db.as({ kind: "user", id: organiser }, (q) =>
          q.query("insert into public.audit_log (action, target_type) values ('x', 'y')"),
        ),
      ).rejects.toThrow(/permission denied/);
    }));
});

describe("F-070: décompte des médias par invité (exact au-delà de 1 000)", () => {
  it("F-070: compte les médias visibles et masqués de chaque invité, pas les supprimés ni ceux d'un autre événement", () =>
    withTestDb(async (db) => {
      const { event, guest } = await setup(db);
      await db.createMedia(event, guest, { status: "hidden" });
      await db.createMedia(event, guest, { status: "deleted" });
      const other = await setup(db);
      const { rows } = await db.query<{ guest_id: string; media_count: string }>(
        "select * from public.moderation_guest_counts($1)",
        [event],
      );
      // `setup` made one ready media, plus the hidden one above: the deleted one is not counted.
      expect(rows).toEqual([{ guest_id: guest, media_count: "2" }]);
      const { rows: others } = await db.query("select * from public.moderation_guest_counts($1)", [
        other.event,
      ]);
      expect(others).toHaveLength(1);
    }));

  it("S-001: la fonction n'est appelable que par le serveur", () =>
    withTestDb(async (db) => {
      const { event, organiser } = await setup(db);
      await expect(
        db.as({ kind: "user", id: organiser }, (q) =>
          q.query("select * from public.moderation_guest_counts($1)", [event]),
        ),
      ).rejects.toThrow(/permission denied/);
    }));
});
