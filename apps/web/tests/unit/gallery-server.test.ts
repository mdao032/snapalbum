import { galleryRequestSchema } from "@snapalbum/shared";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ACTIVE_SHARE_LINKS,
  createShareLink,
  decodeCursor,
  downloadName,
  encodeCursor,
  gallery,
  listShareLinks,
  resolveGalleryAccess,
  revokeShareLink,
} from "@/server/gallery";
import { shareLinkViews } from "@/server/share-links";
import type { Storage } from "@/server/storage";
import { fakeAdmin, type Row } from "./fake-admin";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OTHER_EVENT = "4a2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d99";
const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const GUEST_USER = "0bbbbbbb-2222-4222-8222-222222222222";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const GUEST_ID = "0ddddddd-4444-4444-8444-444444444444";
const TOKEN = "t".repeat(32);
const CODE = "k7m2x9qvbr";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const storage = {
  presignRead: vi.fn(async (key: string, options?: { downloadName?: string }) =>
    options?.downloadName
      ? `https://signed.test/${key}?dl=${options.downloadName}`
      : `https://signed.test/${key}`,
  ),
} as unknown as Storage;

const eventRow = (overrides: Row = {}): Row => ({
  id: EVENT,
  public_code: CODE,
  title: "Mariage de Léa et Tom",
  accent_color: "#6d4aff",
  status: "active",
  owner_id: OWNER,
  settings: { gallery_visible: true },
  locale: "fr",
  ...overrides,
});

const guestRow = (overrides: Row = {}): Row => ({
  id: GUEST_ID,
  event_id: EVENT,
  auth_user_id: GUEST_USER,
  blocked_at: null,
  display_name: "Anna",
  ...overrides,
});

function mediaRow(n: number, overrides: Row = {}): Row {
  const taken = new Date(Date.UTC(2026, 8, 12, 10, n)).toISOString();
  return {
    id: id(n),
    event_id: EVENT,
    guest_id: GUEST_ID,
    kind: "photo",
    status: "ready",
    moderation: "approved",
    width: 1200,
    height: 800,
    duration_s: null,
    blurhash: "L#Iqkc2owxX6tfW:jtfjdef7fQf7",
    key_thumb: `events/${EVENT}/thumb/${id(n)}.webp`,
    key_display: `events/${EVENT}/display/${id(n)}.webp`,
    key_original: null,
    taken_at: taken,
    created_at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
    captured_at: taken,
    ...overrides,
  };
}

const guestAccess = { type: "event" as const, eventCode: CODE };
const shareAccess = { type: "share" as const, token: TOKEN };
const list = (change: Record<string, unknown> = {}, access: unknown = guestAccess) =>
  galleryRequestSchema.parse({ action: "list", access, ...change });

function world(extra: Record<string, Row[]> = {}) {
  return fakeAdmin(
    {
      events: [eventRow()],
      guests: [guestRow()],
      media: [],
      share_links: [{ id: "link-0", event_id: EVENT, token: TOKEN, revoked_at: null }],
      ...extra,
    },
    {
      gallery_guests: () => [{ guest_id: GUEST_ID, display_name: "Anna", media_count: 3 }],
    },
  );
}

describe("F-039, F-054: qui peut voir la galerie", () => {
  it("F-039: un invité de l'événement avec la galerie ouverte est accepté", async () => {
    const result = await resolveGalleryAccess(world(), { id: GUEST_USER }, guestAccess);
    expect(result).toEqual({
      ok: true,
      body: {
        eventId: EVENT,
        title: "Mariage de Léa et Tom",
        accentColor: "#6d4aff",
        showGuests: true,
      },
    });
  });

  it.each([
    ["sans session", null, {}, 401, "unauthorized"],
    ["un inconnu", { id: STRANGER }, {}, 403, "forbidden"],
    [
      "un invité bloqué",
      { id: GUEST_USER },
      { guests: [guestRow({ blocked_at: "2026-10-01" })] },
      403,
      "forbidden",
    ],
    [
      "une galerie fermée",
      { id: GUEST_USER },
      { events: [eventRow({ settings: { gallery_visible: false } })] },
      403,
      "gallery_closed",
    ],
    [
      "un réglage absent",
      { id: GUEST_USER },
      { events: [eventRow({ settings: {} })] },
      403,
      "gallery_closed",
    ],
    [
      "un événement suspendu",
      { id: GUEST_USER },
      { events: [eventRow({ status: "suspended" })] },
      404,
      "not_found",
    ],
  ] as const)("F-039: refuse %s", async (_name, user, extra, status, code) => {
    const result = await resolveGalleryAccess(
      world(extra as Record<string, Row[]>),
      user,
      guestAccess,
    );
    expect(result).toEqual({ ok: false, status, code });
  });

  it("F-039: un code d'événement inconnu est introuvable", async () => {
    const result = await resolveGalleryAccess(
      world(),
      { id: GUEST_USER },
      { type: "event", eventCode: "2222222222" },
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("F-039: l'organisateur voit la galerie même fermée aux invités", async () => {
    const closed = world({ events: [eventRow({ settings: { gallery_visible: false } })] });
    expect(await resolveGalleryAccess(closed, { id: OWNER }, guestAccess)).toMatchObject({
      ok: true,
    });
  });

  it("F-054: un lien valide donne accès sans session, sans noms d'invités, même galerie fermée", async () => {
    const closed = world({ events: [eventRow({ settings: { gallery_visible: false } })] });
    expect(await resolveGalleryAccess(closed, null, shareAccess)).toEqual({
      ok: true,
      body: {
        eventId: EVENT,
        title: "Mariage de Léa et Tom",
        accentColor: "#6d4aff",
        showGuests: false,
      },
    });
  });

  it("F-054: un lien révoqué, inconnu, ou d'un événement suspendu est introuvable", async () => {
    const revoked = world({
      share_links: [{ id: "l", event_id: EVENT, token: TOKEN, revoked_at: "2026-10-02T00:00:00Z" }],
    });
    expect(await resolveGalleryAccess(revoked, null, shareAccess)).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
    expect(
      await resolveGalleryAccess(world(), null, { type: "share", token: "u".repeat(32) }),
    ).toMatchObject({ ok: false, status: 404 });
    const suspended = world({ events: [eventRow({ status: "suspended" })] });
    expect(await resolveGalleryAccess(suspended, null, shareAccess)).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("F-050, F-052: pages de la galerie", () => {
  const twelve = () => Array.from({ length: 12 }, (_, i) => mediaRow(i + 1));

  it("F-050: la première page donne les adresses de miniature, le total et les invités", async () => {
    const admin = world({ media: twelve() });
    const result = await gallery({ admin, storage }, { id: GUEST_USER }, list({ limit: 5 }));
    if (!result.ok || result.body.action !== "list") throw new Error("refused");
    expect(result.body.items).toHaveLength(5);
    expect(result.body.total).toBe(12);
    expect(result.body.guests).toEqual([{ id: GUEST_ID, name: "Anna", count: 3 }]);
    expect(result.body.nextCursor).not.toBeNull();
    expect(result.body.urlsValidSeconds).toBe(3600);
    expect(result.body.items[0]).toMatchObject({
      mediaId: id(12),
      thumbUrl: `https://signed.test/events/${EVENT}/thumb/${id(12)}.webp`,
      width: 1200,
      kind: "photo",
    });
  });

  it("F-050: les pages se suivent sans doublon ni oubli, la dernière n'a plus de curseur", async () => {
    const admin = world({ media: twelve() });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await gallery(
        { admin, storage },
        { id: GUEST_USER },
        list({ limit: 5, cursor }),
      );
      if (!result.ok || result.body.action !== "list") throw new Error("refused");
      if (cursor) {
        expect(result.body.total).toBeNull();
        expect(result.body.guests).toEqual([]);
      }
      seen.push(...result.body.items.map((item) => item.mediaId));
      cursor = result.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => id(12 - i)));
  });

  it("F-052: tri croissant et tri par date d'envoi", async () => {
    const media = [
      mediaRow(1, { captured_at: "2026-09-12T20:00:00Z", created_at: "2026-10-01T10:00:00Z" }),
      mediaRow(2, { captured_at: "2026-09-12T10:00:00Z", created_at: "2026-10-02T10:00:00Z" }),
    ];
    const admin = world({ media });
    const ids = async (change: Record<string, unknown>) => {
      const result = await gallery({ admin, storage }, { id: GUEST_USER }, list(change));
      if (!result.ok || result.body.action !== "list") throw new Error("refused");
      return result.body.items.map((item) => item.mediaId);
    };
    expect(await ids({ sort: "taken", order: "asc" })).toEqual([id(2), id(1)]);
    expect(await ids({ sort: "taken", order: "desc" })).toEqual([id(1), id(2)]);
    expect(await ids({ sort: "sent", order: "desc" })).toEqual([id(2), id(1)]);
  });

  it("F-052: seuls les médias approuvés et prêts sont montrés, filtrés par type et par invité", async () => {
    const other = "0eeeeeee-5555-4555-8555-555555555555";
    const media = [
      mediaRow(1),
      mediaRow(2, { kind: "video" }),
      mediaRow(3, { guest_id: other }),
      mediaRow(4, { moderation: "pending" }),
      mediaRow(5, { status: "hidden" }),
      mediaRow(6, { event_id: OTHER_EVENT }),
    ];
    const admin = world({ media });
    const ids = async (
      change: Record<string, unknown>,
      access: unknown = guestAccess,
      user = { id: GUEST_USER },
    ) => {
      const result = await gallery(
        { admin, storage },
        user as { id: string },
        list(change, access),
      );
      if (!result.ok || result.body.action !== "list") throw new Error("refused");
      return {
        ids: result.body.items.map((item) => item.mediaId).sort(),
        total: result.body.total,
      };
    };
    expect(await ids({})).toEqual({ ids: [id(1), id(2), id(3)], total: 3 });
    expect(await ids({ kind: "video" })).toEqual({ ids: [id(2)], total: 1 });
    expect(await ids({ guestId: other })).toEqual({ ids: [id(3)], total: 1 });
    // On a share link the guest filter does nothing: it cannot single guests out.
    expect(await ids({ guestId: other }, shareAccess, null as never)).toEqual({
      ids: [id(1), id(2), id(3)],
      total: 3,
    });
  });

  it("NF-043: un curseur illisible est refusé, un curseur fabriqué par le serveur est relu", async () => {
    const admin = world({ media: twelve() });
    const result = await gallery(
      { admin, storage },
      { id: GUEST_USER },
      list({ cursor: "n-importe-quoi" }),
    );
    expect(result).toEqual({ ok: false, status: 400, code: "validation_failed" });

    const cursor = encodeCursor("2026-09-12T10:00:00+00:00", id(3));
    expect(decodeCursor(cursor)).toEqual(["2026-09-12T10:00:00+00:00", id(3)]);
    expect(decodeCursor(Buffer.from(JSON.stringify(["x", "y"])).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("pas du json").toString("base64url"))).toBeNull();
  });

  it("F-039: la galerie vide donne une liste vide, pas une erreur", async () => {
    const result = await gallery({ admin: world(), storage }, { id: GUEST_USER }, list());
    if (!result.ok || result.body.action !== "list") throw new Error("refused");
    expect(result.body).toMatchObject({ items: [], total: 0, nextCursor: null });
  });
});

describe("SPEC 9.1, F-051: adresses de lecture", () => {
  it("SPEC 9.1: les miniatures renouvelées ne concernent que ce que la galerie montre", async () => {
    const media = [
      mediaRow(1),
      mediaRow(2, { moderation: "pending" }),
      mediaRow(3, { event_id: OTHER_EVENT }),
    ];
    const result = await gallery(
      { admin: world({ media }), storage },
      { id: GUEST_USER },
      galleryRequestSchema.parse({
        action: "thumbs",
        access: guestAccess,
        mediaIds: [id(1), id(2), id(3)],
      }),
    );
    if (!result.ok || result.body.action !== "thumbs") throw new Error("refused");
    expect(result.body.urls).toEqual([
      { mediaId: id(1), thumbUrl: `https://signed.test/events/${EVENT}/thumb/${id(1)}.webp` },
    ]);
  });

  it("F-051: une photo donne l'affichage et un téléchargement nommé, une vidéo le fichier à lire", async () => {
    const original = `events/${EVENT}/original/${id(2)}.mp4`;
    const media = [
      mediaRow(1, { key_original: `events/${EVENT}/original/${id(1)}.jpg` }),
      mediaRow(2, { kind: "video", key_display: null, key_original: original }),
      mediaRow(3, { key_original: null }),
    ];
    const result = await gallery(
      { admin: world({ media }), storage },
      { id: GUEST_USER },
      galleryRequestSchema.parse({
        action: "files",
        access: guestAccess,
        mediaIds: [id(1), id(2), id(3)],
      }),
    );
    if (!result.ok || result.body.action !== "files") throw new Error("refused");
    const byId = new Map(result.body.files.map((file) => [file.mediaId, file]));

    // A photo kept in its original: shown from the display version, saved from the original.
    expect(byId.get(id(1))).toEqual({
      mediaId: id(1),
      displayUrl: `https://signed.test/events/${EVENT}/display/${id(1)}.webp`,
      videoUrl: null,
      downloadUrl: `https://signed.test/events/${EVENT}/original/${id(1)}.jpg?dl=mariage-de-lea-et-tom-00000000.jpg`,
    });
    expect(byId.get(id(2))).toMatchObject({
      displayUrl: null,
      videoUrl: `https://signed.test/${original}`,
      downloadUrl: `https://signed.test/${original}?dl=mariage-de-lea-et-tom-00000000.mp4`,
    });
    // No original kept (free plan): the display version is what can be saved.
    expect(byId.get(id(3))?.downloadUrl).toContain(`/display/${id(3)}.webp?dl=`);
  });

  it("F-051: le nom du fichier téléchargé garde l'extension, sans accents ni caractères étranges", () => {
    expect(downloadName("Mariage de Léa & Tom !", id(7), "events/e/original/m.HEIC")).toBe(
      "mariage-de-lea-tom-00000000.heic",
    );
    expect(downloadName("???", id(7), "events/e/original/m")).toBe("album-00000000.bin");
    expect(downloadName("x".repeat(100), id(7), "a.mp4")).toBe(`${"x".repeat(40)}-00000000.mp4`);
  });

  it("F-054: l'accès par lien donne aussi les fichiers, jamais ceux d'un autre événement", async () => {
    const media = [mediaRow(1), mediaRow(2, { event_id: OTHER_EVENT })];
    const result = await gallery(
      { admin: world({ media }), storage },
      null,
      galleryRequestSchema.parse({
        action: "files",
        access: shareAccess,
        mediaIds: [id(1), id(2)],
      }),
    );
    if (!result.ok || result.body.action !== "files") throw new Error("refused");
    expect(result.body.files.map((file) => file.mediaId)).toEqual([id(1)]);
  });
});

describe("F-054: gestion des liens de partage", () => {
  const ownerWorld = (links: Row[] = []) => world({ share_links: links });

  it("F-054: crée un lien de 32 caractères pour le propriétaire seulement", async () => {
    const admin = ownerWorld();
    const created = await createShareLink(admin, OWNER, EVENT);
    if (!created.ok) throw new Error("not created");
    expect(created.link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.link.revokedAt).toBeNull();
    expect(await createShareLink(admin, STRANGER, EVENT)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("F-054: refuse un sixième lien actif, un lien révoqué ne compte plus", async () => {
    const links = Array.from({ length: MAX_ACTIVE_SHARE_LINKS }, (_, i) => ({
      id: `l${i}`,
      event_id: EVENT,
      token: String(i).repeat(32),
      created_at: "2026-10-01T10:00:00Z",
      revoked_at: null,
    }));
    const admin = ownerWorld(links);
    expect(await createShareLink(admin, OWNER, EVENT)).toEqual({ ok: false, reason: "too_many" });
    expect(await revokeShareLink(admin, OWNER, EVENT, "l0")).toBe(true);
    expect((await createShareLink(admin, OWNER, EVENT)).ok).toBe(true);
  });

  it("F-054: révoquer deux fois est sans effet, un lien inconnu ou étranger est refusé", async () => {
    const links = [
      {
        id: "l1",
        event_id: EVENT,
        token: "a".repeat(32),
        created_at: "2026-10-01T10:00:00Z",
        revoked_at: null,
      },
    ];
    const admin = ownerWorld(links);
    expect(await revokeShareLink(admin, OWNER, EVENT, "l1")).toBe(true);
    expect(await revokeShareLink(admin, OWNER, EVENT, "l1")).toBe(true);
    expect(await revokeShareLink(admin, OWNER, EVENT, "inconnu")).toBe(false);
    expect(await revokeShareLink(admin, STRANGER, EVENT, "l1")).toBe(false);
  });

  it("F-054: la liste vient du plus récent, vide pour qui n'est pas propriétaire", async () => {
    const links = [
      {
        id: "l1",
        event_id: EVENT,
        token: "a".repeat(32),
        created_at: "2026-10-01T10:00:00Z",
        revoked_at: null,
      },
      {
        id: "l2",
        event_id: EVENT,
        token: "b".repeat(32),
        created_at: "2026-10-02T10:00:00Z",
        revoked_at: "2026-10-03T10:00:00Z",
      },
    ];
    const admin = ownerWorld(links);
    const listed = await listShareLinks(admin, OWNER, EVENT);
    expect(listed.map((link) => link.id)).toEqual(["l2", "l1"]);
    expect(listed[0]!.revokedAt).toBe("2026-10-03T10:00:00.000Z");
    expect(await listShareLinks(admin, STRANGER, EVENT)).toEqual([]);
  });

  it("F-054: l'adresse donnée au propriétaire suit la langue de l'événement", async () => {
    const links = [
      {
        id: "l1",
        event_id: EVENT,
        token: "a".repeat(32),
        created_at: "2026-10-01T10:00:00Z",
        revoked_at: null,
      },
    ];
    const french = await shareLinkViews(ownerWorld(links), OWNER, EVENT);
    expect(french[0]!.url).toBe(`http://localhost:3000/g/${"a".repeat(32)}`);

    const english = world({ events: [eventRow({ locale: "en" })], share_links: links });
    expect((await shareLinkViews(english, OWNER, EVENT))[0]!.url).toBe(
      `http://localhost:3000/en/g/${"a".repeat(32)}`,
    );
    expect(await shareLinkViews(ownerWorld(links), STRANGER, EVENT)).toEqual([]);
  });
});
