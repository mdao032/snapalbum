import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, withTestDb, type TestDb } from "./harness";

interface Reservation {
  [key: string]: unknown;
}

const sha = () => randomBytes(32).toString("hex");

/** Calls `reserve_media_slot` as the server does (service role) with sensible defaults. */
async function reserve(
  db: TestDb,
  event: string,
  user: string,
  overrides: Reservation = {},
): Promise<{
  ok: boolean;
  result?: string;
  reason?: string;
  media_id?: string;
  moderation?: string;
}> {
  const mediaId = randomUUID();
  const p = {
    event,
    user,
    media: mediaId,
    sha256: sha(),
    kind: "photo",
    mime: "image/jpeg",
    original: null,
    display: 2000,
    thumb: 200,
    width: 2048,
    height: 1536,
    duration: null,
    takenAt: null,
    keyOriginal: null,
    keyDisplay: `events/${event}/display/${mediaId}.webp`,
    keyThumb: `events/${event}/thumb/${mediaId}.webp`,
    maxMedia: 200,
    maxVideos: 10,
    ...overrides,
  };
  const { rows } = await db.as({ kind: "service" }, (q) =>
    q.query<{
      r: { ok: boolean; result?: string; reason?: string; media_id?: string; moderation?: string };
    }>(
      `select public.reserve_media_slot($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) as r`,
      [
        p.event,
        p.user,
        p.media,
        p.sha256,
        p.kind,
        p.mime,
        p.original,
        p.display,
        p.thumb,
        p.width,
        p.height,
        p.duration,
        p.takenAt,
        p.keyOriginal,
        p.keyDisplay,
        p.keyThumb,
        p.maxMedia,
        p.maxVideos,
      ],
    ),
  );
  return rows[0]!.r;
}

async function world(
  db: TestDb,
  eventOverrides: Record<string, unknown> = {},
  guestOverrides: Record<string, unknown> = {},
) {
  const organiser = await db.createUser();
  // A window around now, so reservations are open unless a test says otherwise.
  const now = Date.now();
  const settings = {
    gallery_visible: true,
    require_approval: false,
    upload_opens_at: new Date(now - 86_400_000).toISOString(),
    upload_closes_at: new Date(now + 86_400_000).toISOString(),
  };
  const event = await db.createEvent(organiser, {
    expires_at: new Date(now + 30 * 86_400_000).toISOString(),
    settings: JSON.stringify(settings),
    ...eventOverrides,
  });
  const user = await db.createUser({ anonymous: true });
  const guest = await db.createGuest(event, user, guestOverrides);
  return { organiser, event, user, guest };
}

async function counters(db: TestDb, event: string) {
  const { rows } = await db.query<{ media_count: number; bytes_used: string }>(
    "select media_count, bytes_used from public.events where id = $1",
    [event],
  );
  return { count: rows[0]!.media_count, bytes: Number(rows[0]!.bytes_used) };
}

describe("S-001: reserve_media_slot, droits d'exécution", () => {
  it("refusé : ni un invité, ni un organisateur, ni un visiteur ne peut appeler la fonction", () =>
    withTestDb(async (db) => {
      const { event, user, organiser } = await world(db);
      for (const actor of [
        { kind: "guest", id: user },
        { kind: "user", id: organiser },
        { kind: "visitor" },
      ] as const) {
        await expect(
          db.as(actor, (q) =>
            q.query(
              `select public.reserve_media_slot($1,$2,$3,$4,'photo','image/jpeg',null,10,10,1,1,null,null,null,$5,$6,10,10)`,
              [
                event,
                user,
                randomUUID(),
                sha(),
                `events/${event}/display/x.webp`,
                `events/${event}/thumb/x.webp`,
              ],
            ),
          ),
        ).rejects.toThrow(/permission denied/);
      }
    }));
});

describe("SPEC 7.1: réservation d'une place", () => {
  it("autorisé : réserve la place, crée le média en attente et met à jour les compteurs", () =>
    withTestDb(async (db) => {
      const { event, user, guest } = await world(db);
      const result = await reserve(db, event, user, { display: 2000, thumb: 200 });
      expect(result).toMatchObject({ ok: true, result: "reserved", moderation: "approved" });

      const { rows } = await db.query(
        "select guest_id, status, kind from public.media where id = $1",
        [result.media_id],
      );
      expect(rows[0]).toEqual({ guest_id: guest, status: "pending", kind: "photo" });
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 2200 });
    }));

  it("autorisé : une vidéo se réserve avec son seul fichier original et sa miniature", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const id = randomUUID();
      const result = await reserve(db, event, user, {
        kind: "video",
        mime: "video/mp4",
        media: id,
        original: 30_000_000,
        display: null,
        duration: 12.5,
        keyOriginal: `events/${event}/original/${id}.mp4`,
        keyDisplay: null,
      });
      expect(result).toMatchObject({ ok: true, result: "reserved" });
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 30_000_200 });
    }));

  it("autorisé : la validation préalable place le média en attente de modération (F-071)", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db, {
        settings: JSON.stringify({
          require_approval: true,
          upload_opens_at: new Date(Date.now() - 1000).toISOString(),
          upload_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
      expect(await reserve(db, event, user)).toMatchObject({ ok: true, moderation: "pending" });
    }));
});

describe("SPEC 7.1: refus de la réservation", () => {
  it.each([
    ["empreinte invalide", { sha256: "zz" }],
    ["type de fichier inattendu", { mime: "application/x-sh" }],
    ["miniature absente", { thumb: null }],
    ["taille nulle", { display: 0 }],
    ["taille démesurée", { display: 6_000_000_000 }],
    ["photo sans version d'affichage", { display: null }],
    ["vidéo avec version d'affichage", { kind: "video", original: 1000, display: 1000 }],
    ["vidéo sans fichier original", { kind: "video", original: null, display: null }],
    ["genre inconnu", { kind: "gif" }],
    ["largeur hors limites", { width: 0 }],
    ["durée négative", { duration: -1 }],
    ["quota négatif", { maxMedia: -1 }],
  ])("S-002: refuse une demande mal formée : %s", (_label, overrides) =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      expect(await reserve(db, event, user, overrides)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
      expect(await counters(db, event)).toEqual({ count: 0, bytes: 0 });
    }),
  );

  it("S-002: refuse une clé de stockage qui sort du dossier de l'événement", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const other = randomUUID();
      for (const overrides of [
        { keyThumb: `events/${other}/thumb/x.webp` },
        { keyDisplay: `events/${other}/display/x.webp` },
        { keyOriginal: `events/${other}/original/x.jpg` },
        { keyThumb: "thumb/x.webp" },
        { keyThumb: null },
      ]) {
        expect(await reserve(db, event, user, overrides)).toEqual({
          ok: false,
          reason: "invalid_input",
        });
      }
    }));

  it("refuse : événement inconnu, suspendu ou en suppression, expiré", async () => {
    await withTestDb(async (db) => {
      const { user } = await world(db);
      expect(await reserve(db, randomUUID(), user)).toEqual({
        ok: false,
        reason: "event_not_found",
      });
    });
    for (const status of ["suspended", "pending_deletion"]) {
      await withTestDb(async (db) => {
        const { event, user } = await world(db, { status });
        expect(await reserve(db, event, user)).toEqual({ ok: false, reason: "event_suspended" });
      });
    }
    await withTestDb(async (db) => {
      const { event, user } = await world(db, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(await reserve(db, event, user)).toEqual({ ok: false, reason: "upload_window_closed" });
    });
  });

  it("refuse : quelqu'un qui n'est pas invité de cet événement, un invité bloqué, des conditions non acceptées", async () => {
    await withTestDb(async (db) => {
      const { event } = await world(db);
      const stranger = await db.createUser({ anonymous: true });
      expect(await reserve(db, event, stranger)).toEqual({ ok: false, reason: "not_a_guest" });
    });
    await withTestDb(async (db) => {
      const { event, user } = await world(db, {}, { blocked_at: new Date().toISOString() });
      expect(await reserve(db, event, user)).toEqual({ ok: false, reason: "guest_blocked" });
    });
    await withTestDb(async (db) => {
      const { event, user } = await world(db, {}, { terms_accepted_at: null });
      expect(await reserve(db, event, user)).toEqual({ ok: false, reason: "terms_required" });
    });
  });

  it("F-016: refuse avant l'ouverture et après la fermeture de la fenêtre d'envoi", async () => {
    const day = 86_400_000;
    for (const [opens, closes] of [
      [Date.now() + day, Date.now() + 2 * day],
      [Date.now() - 2 * day, Date.now() - day],
    ]) {
      await withTestDb(async (db) => {
        const { event, user } = await world(db, {
          settings: JSON.stringify({
            upload_opens_at: new Date(opens!).toISOString(),
            upload_closes_at: new Date(closes!).toISOString(),
          }),
        });
        expect(await reserve(db, event, user)).toEqual({
          ok: false,
          reason: "upload_window_closed",
        });
      });
    }
  });

  it("S-001: des réglages écrits n'importe comment ferment la fenêtre sans jamais faire échouer la fonction", async () => {
    // (A settings value that is not a JSON object is already refused by a check constraint of `events`.)
    const broken = [
      "{}",
      '{"upload_opens_at":"pas une date","upload_closes_at":"2030-01-01T00:00:00Z"}',
      '{"upload_opens_at":12,"upload_closes_at":true}',
      '{"upload_opens_at":"2030-01-01T00:00:00Z","upload_closes_at":"2029-01-01T00:00:00Z"}',
      '{"upload_opens_at":"2020-01-01T00:00:00Z","upload_closes_at":"2020-01-01T00:00:00Z"}',
      '{"upload_opens_at":{"a":1},"upload_closes_at":[1]}',
    ];
    for (const settings of broken) {
      await withTestDb(async (db) => {
        const { event, user } = await world(db, { settings });
        expect(await reserve(db, event, user), settings).toEqual({
          ok: false,
          reason: "upload_window_closed",
        });
      });
    }
  });

  it("R1: refuse quand l'album est plein, sans toucher aux médias déjà reçus", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      expect(await reserve(db, event, user, { maxMedia: 2 })).toMatchObject({ ok: true });
      expect(await reserve(db, event, user, { maxMedia: 2 })).toMatchObject({ ok: true });
      expect(await reserve(db, event, user, { maxMedia: 2 })).toEqual({
        ok: false,
        reason: "album_full",
      });
      expect((await counters(db, event)).count).toBe(2);
    }));

  it("R1: refuse la vidéo suivante quand la limite de vidéos de l'offre est atteinte, mais pas les photos", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const video = (media: string) => ({
        kind: "video",
        mime: "video/mp4",
        media,
        original: 5000,
        display: null,
        maxVideos: 1,
        keyOriginal: `events/${event}/original/${media}.mp4`,
        keyDisplay: null,
      });
      expect(await reserve(db, event, user, video(randomUUID()))).toMatchObject({ ok: true });
      expect(await reserve(db, event, user, video(randomUUID()))).toEqual({
        ok: false,
        reason: "video_limit_reached",
      });
      expect(await reserve(db, event, user, { maxVideos: 1 })).toMatchObject({ ok: true });
    }));

  it("R1: sans limite de vidéos (offres payantes), les vidéos ne sont limitées que par le quota total", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      for (let i = 0; i < 3; i += 1) {
        const media = randomUUID();
        expect(
          await reserve(db, event, user, {
            kind: "video",
            mime: "video/mp4",
            media,
            original: 5000,
            display: null,
            maxVideos: null,
            keyOriginal: `events/${event}/original/${media}.mp4`,
            keyDisplay: null,
          }),
        ).toMatchObject({ ok: true });
      }
    }));
});

describe("NF-012: envois idempotents", () => {
  it("NF-012: le même fichier envoyé par un autre invité est déjà reçu, sans nouvelle place", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const other = await db.createUser({ anonymous: true });
      await db.createGuest(event, other);
      const hash = sha();
      const first = await reserve(db, event, user, { sha256: hash });
      const again = await reserve(db, event, other, { sha256: hash });
      expect(again).toMatchObject({ ok: true, result: "duplicate", media_id: first.media_id });
      expect((await counters(db, event)).count).toBe(1);
    }));

  it("NF-012: l'invité qui reprend sa réservation inachevée retrouve le même média, tailles mises à jour", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const hash = sha();
      const first = await reserve(db, event, user, { sha256: hash, display: 2000, thumb: 200 });
      const again = await reserve(db, event, user, { sha256: hash, display: 3000, thumb: 300 });
      expect(again).toMatchObject({ ok: true, result: "resumed", media_id: first.media_id });
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 3300 });
    }));

  it("NF-012: un média supprimé peut être renvoyé : sa place est libérée", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const hash = sha();
      const first = await reserve(db, event, user, { sha256: hash });
      await db.query("update public.media set status = 'deleted' where id = $1", [first.media_id]);
      expect((await counters(db, event)).count).toBe(0);
      const again = await reserve(db, event, user, { sha256: hash });
      expect(again).toMatchObject({ ok: true, result: "reserved" });
      expect(again.media_id).not.toBe(first.media_id);
    }));

  it("NF-012: un doublon n'est pas refusé même quand l'album est plein", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const hash = sha();
      await reserve(db, event, user, { sha256: hash, maxMedia: 1 });
      expect(await reserve(db, event, user, { sha256: hash, maxMedia: 1 })).toMatchObject({
        ok: true,
        result: "resumed",
      });
    }));

  it("R1: les réservations jamais confirmées libèrent leur place après trois heures", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const stale = await reserve(db, event, user, { maxMedia: 1 });
      expect(await reserve(db, event, user, { maxMedia: 1 })).toEqual({
        ok: false,
        reason: "album_full",
      });
      await db.query(
        "update public.media set created_at = now() - interval '4 hours' where id = $1",
        [stale.media_id],
      );
      expect(await reserve(db, event, user, { maxMedia: 1 })).toMatchObject({
        ok: true,
        result: "reserved",
      });
      const { rows } = await db.query(
        "select count(*)::int as n from public.media where event_id = $1",
        [event],
      );
      expect(rows[0]).toEqual({ n: 1 });
    }));

  it("R1: une réservation confirmée n'est jamais libérée par ce nettoyage", () =>
    withTestDb(async (db) => {
      const { event, user } = await world(db);
      const done = await reserve(db, event, user, { maxMedia: 1 });
      await db.query(
        "update public.media set status = 'ready', created_at = now() - interval '9 hours' where id = $1",
        [done.media_id],
      );
      expect(await reserve(db, event, user, { maxMedia: 1 })).toEqual({
        ok: false,
        reason: "album_full",
      });
      expect((await counters(db, event)).count).toBe(1);
    }));
});

describe("SPEC 7: compteurs maintenus par déclencheurs", () => {
  it("les compteurs suivent chaque changement d'état d'un média", () =>
    withTestDb(async (db) => {
      const { event, guest } = await world(db);
      const media = await db.createMedia(event, guest, {
        bytes_display: 1000,
        bytes_thumb: 100,
        bytes_original: 5000,
      });
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 6100 });

      await db.query("update public.media set status = 'hidden' where id = $1", [media]);
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 6100 });

      await db.query("update public.media set bytes_original = null where id = $1", [media]);
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 1100 });

      await db.query("update public.media set status = 'rejected' where id = $1", [media]);
      expect(await counters(db, event)).toEqual({ count: 0, bytes: 0 });

      await db.query("update public.media set status = 'ready' where id = $1", [media]);
      expect(await counters(db, event)).toEqual({ count: 1, bytes: 1100 });

      await db.query("delete from public.media where id = $1", [media]);
      expect(await counters(db, event)).toEqual({ count: 0, bytes: 0 });
    }));

  it("supprimer un événement supprime ses invités, médias et envois en morceaux", () =>
    withTestDb(async (db) => {
      const { event, guest } = await world(db);
      const media = await db.createMedia(event, guest);
      await db.query(
        "insert into public.uploads (media_id, multipart_upload_id, expires_at) values ($1, 'u', now())",
        [media],
      );
      await db.query("delete from public.events where id = $1", [event]);
      for (const table of ["guests", "media", "uploads"]) {
        const { rows } = await db.query(`select count(*)::int as n from public.${table}`);
        expect(rows[0], table).toEqual({ n: 0 });
      }
    }));

  it("un média ne peut pas pointer vers un dossier d'un autre événement", () =>
    withTestDb(async (db) => {
      const { event, guest } = await world(db);
      await expect(
        db.createMedia(event, guest, { key_display: `events/${randomUUID()}/display/x.webp` }),
      ).rejects.toThrow(/check constraint/);
    }));
});

describe("SPEC 7.1: atomicité du quota", () => {
  it("R1: vingt réservations simultanées sur un album de trois places en accordent exactement trois", async () => {
    const connect = async () => {
      const client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();
      return client;
    };
    const setup = await connect();
    const organiser = randomUUID();
    const guests: string[] = [];
    let event = "";
    try {
      // Committed data on purpose: the reservations run on separate connections.
      await setup.query(
        "insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)",
        [organiser, `${organiser}@example.test`],
      );
      const now = Date.now();
      const settings = JSON.stringify({
        upload_opens_at: new Date(now - 86_400_000).toISOString(),
        upload_closes_at: new Date(now + 86_400_000).toISOString(),
      });
      const created = await setup.query<{ id: string }>(
        `insert into public.events (owner_id, public_code, title, event_date, type, expires_at, settings)
         values ($1, $2, 'Concurrence', '2026-09-12', 'wedding', now() + interval '30 days', $3) returning id`,
        [
          organiser,
          randomBytes(8)
            .toString("hex")
            .slice(0, 10)
            .replace(/[01oil]/g, "k"),
          settings,
        ],
      );
      event = created.rows[0]!.id;
      for (let i = 0; i < 20; i += 1) {
        const id = randomUUID();
        guests.push(id);
        await setup.query(
          "insert into auth.users (id, aud, role, is_anonymous) values ($1, 'authenticated', 'authenticated', true)",
          [id],
        );
        await setup.query(
          "insert into public.guests (event_id, auth_user_id, terms_accepted_at) values ($1, $2, now())",
          [event, id],
        );
      }

      const clients = await Promise.all(guests.map(() => connect()));
      try {
        const results = await Promise.all(
          clients.map(async (client, index) => {
            const media = randomUUID();
            const { rows } = await client.query<{ r: { ok: boolean; reason?: string } }>(
              `select public.reserve_media_slot($1,$2,$3,$4,'photo','image/jpeg',null,2000,200,1,1,null,null,null,$5,$6,3,10) as r`,
              [
                event,
                guests[index],
                media,
                sha(),
                `events/${event}/display/${media}.webp`,
                `events/${event}/thumb/${media}.webp`,
              ],
            );
            return rows[0]!.r;
          }),
        );
        expect(results.filter((r) => r.ok)).toHaveLength(3);
        expect(results.filter((r) => !r.ok).every((r) => r.reason === "album_full")).toBe(true);
        const { rows } = await setup.query(
          "select media_count, bytes_used from public.events where id = $1",
          [event],
        );
        expect(rows[0]).toEqual({ media_count: 3, bytes_used: "6600" });
      } finally {
        await Promise.all(clients.map((client) => client.end()));
      }
    } finally {
      if (event) await setup.query("delete from public.events where id = $1", [event]);
      await setup.query("delete from auth.users where id = any($1)", [[organiser, ...guests]]);
      await setup.end();
    }
  }, 60_000);
});
