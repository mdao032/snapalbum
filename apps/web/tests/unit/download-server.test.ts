import { describe, expect, it, vi } from "vitest";
import { PLAN_PAGE_SIZE, SIGN_BATCH_SIZE, planAlbum, signAlbumFiles } from "@/server/download";
import type { DownloadDeps } from "@/server/download";
import type { Storage } from "@/server/storage";
import { fakeAdmin, type Row } from "./fake-admin";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OTHER_EVENT = "4a2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d99";
const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const ANNA = "0ddddddd-4444-4444-8444-444444444444";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const storage = {
  presignRead: vi.fn(async (key: string) => `https://signed.test/${key}`),
} as unknown as Storage;

const media = (n: number, overrides: Row = {}): Row => {
  const at = new Date(Date.UTC(2026, 8, 12, 10, n)).toISOString();
  return {
    id: id(n),
    event_id: EVENT,
    guest_id: ANNA,
    kind: "photo",
    status: "ready",
    moderation: "approved",
    taken_at: at,
    captured_at: at,
    created_at: at,
    key_original: `events/${EVENT}/original/${n}.jpg`,
    key_display: `events/${EVENT}/display/${n}.webp`,
    bytes_original: 4_000_000,
    bytes_display: 400_000,
    ...overrides,
  };
};

function world(plan: string, extra: Record<string, Row[]> = {}) {
  const deps: DownloadDeps = {
    admin: fakeAdmin({
      events: [
        { id: EVENT, owner_id: OWNER, status: "active", title: "Mariage de Léa et Tom", plan },
      ],
      guests: [
        { id: ANNA, event_id: EVENT, display_name: "Anna" },
        { id: "g2", event_id: EVENT, display_name: null },
      ],
      media: [],
      ...extra,
    }),
    storage,
  };
  return deps;
}

describe("F-080, F-083: ce que contient le téléchargement", () => {
  it("F-083: les médias approuvés et prêts, dans l'ordre de prise de vue, avec leur invité et leur taille", async () => {
    const deps = world("event", {
      media: [
        media(3),
        media(1),
        media(2, { guest_id: "g2" }),
        media(4, { moderation: "pending" }),
        media(5, { status: "hidden" }),
        media(6, { event_id: OTHER_EVENT }),
      ],
    });
    const result = await planAlbum(deps, OWNER, EVENT, { variant: "originals" });
    if (!result.ok) throw new Error("refused");
    expect(result.body.items.map((item) => item.mediaId)).toEqual([id(1), id(2), id(3)]);
    expect(result.body.items[0]).toMatchObject({
      guestName: "Anna",
      bytes: 4_000_000,
      extension: "jpg",
      at: "2026-09-12T10:01:00.000Z",
    });
    expect(result.body.items[1]!.guestName).toBeNull();
    expect(result.body).toMatchObject({
      variant: "originals",
      originalsAllowed: true,
      nextCursor: null,
      title: "Mariage de Léa et Tom",
    });
  });

  it("F-080: l'offre gratuite n'a que les versions optimisées, quoi que demande le navigateur", async () => {
    const deps = world("free", { media: [media(1)] });
    const result = await planAlbum(deps, OWNER, EVENT, { variant: "originals" });
    if (!result.ok) throw new Error("refused");
    expect(result.body).toMatchObject({ variant: "optimized", originalsAllowed: false });
    expect(result.body.items[0]).toMatchObject({ bytes: 400_000, extension: "webp" });
  });

  it("F-080: les versions optimisées d'une offre payante pèsent moins, une vidéo reste en original", async () => {
    const deps = world("event", {
      media: [
        media(1),
        media(2, {
          kind: "video",
          key_display: null,
          key_original: `events/${EVENT}/original/2.mp4`,
          bytes_original: 90_000_000,
          bytes_display: null,
        }),
      ],
    });
    const result = await planAlbum(deps, OWNER, EVENT, { variant: "optimized" });
    if (!result.ok) throw new Error("refused");
    expect(result.body.items.map((item) => [item.kind, item.extension, item.bytes])).toEqual([
      ["photo", "webp", 400_000],
      ["video", "mp4", 90_000_000],
    ]);
  });

  it("F-080: sans original conservé, l'offre payante retombe sur la version d'affichage", async () => {
    const deps = world("event", {
      media: [media(1, { key_original: null, bytes_original: null })],
    });
    const result = await planAlbum(deps, OWNER, EVENT, { variant: "originals" });
    if (!result.ok) throw new Error("refused");
    expect(result.body.items[0]).toMatchObject({ extension: "webp", bytes: 400_000 });
  });

  it("F-080: plus de 1 000 médias : la page suivante reprend exactement après la dernière, sans doublon", async () => {
    const many = Array.from({ length: PLAN_PAGE_SIZE + 5 }, (_, i) => media(i + 1));
    const deps = world("event", { media: many });
    const first = await planAlbum(deps, OWNER, EVENT, { variant: "originals" });
    if (!first.ok) throw new Error("refused");
    expect(first.body.items).toHaveLength(PLAN_PAGE_SIZE);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await planAlbum(deps, OWNER, EVENT, {
      variant: "originals",
      cursor: first.body.nextCursor!,
    });
    if (!second.ok) throw new Error("refused");
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items].map((item) => item.mediaId);
    expect(new Set(all).size).toBe(PLAN_PAGE_SIZE + 5);
  });

  it("NF-043, S-001: un curseur illisible, un autre organisateur, un événement suspendu sont refusés", async () => {
    const deps = world("event", { media: [media(1)] });
    expect(await planAlbum(deps, OWNER, EVENT, { variant: "originals", cursor: "x" })).toEqual({
      ok: false,
      status: 400,
      code: "validation_failed",
    });
    expect(await planAlbum(deps, STRANGER, EVENT, { variant: "originals" })).toMatchObject({
      status: 404,
    });
    const suspended = world("event", {
      events: [{ id: EVENT, owner_id: OWNER, status: "suspended", title: "x", plan: "event" }],
    });
    expect(await planAlbum(suspended, OWNER, EVENT, { variant: "originals" })).toMatchObject({
      status: 404,
    });
  });
});

describe("SPEC 9.1: adresses de téléchargement", () => {
  it("SPEC 9.1: des adresses pour les médias de l'album de l'organisateur, pas pour les autres", async () => {
    const deps = world("event", {
      media: [
        media(1),
        media(2, { moderation: "pending" }),
        media(3, { status: "hidden" }),
        media(4, { event_id: OTHER_EVENT }),
      ],
    });
    const result = await signAlbumFiles(
      deps,
      OWNER,
      EVENT,
      [id(1), id(2), id(3), id(4)],
      "originals",
    );
    if (!result.ok) throw new Error("refused");
    expect(result.body.files).toEqual([
      { mediaId: id(1), url: `https://signed.test/events/${EVENT}/original/1.jpg` },
    ]);
  });

  it("F-080: la variante suit l'offre : optimisée pour la gratuite, au choix pour la payante", async () => {
    const free = await signAlbumFiles(
      world("free", { media: [media(1)] }),
      OWNER,
      EVENT,
      [id(1)],
      "originals",
    );
    if (!free.ok) throw new Error("refused");
    expect(free.body.files[0]!.url).toContain("/display/1.webp");
    const paid = world("event", { media: [media(1)] });
    const original = await signAlbumFiles(paid, OWNER, EVENT, [id(1)], "originals");
    const optimized = await signAlbumFiles(paid, OWNER, EVENT, [id(1)], "optimized");
    if (!original.ok || !optimized.ok) throw new Error("refused");
    expect(original.body.files[0]!.url).toContain("/original/1.jpg");
    expect(optimized.body.files[0]!.url).toContain("/display/1.webp");
  });

  it("NF-043, S-001: un lot vide ou trop grand est refusé, un autre organisateur est refusé", async () => {
    const deps = world("event", { media: [media(1)] });
    expect(await signAlbumFiles(deps, OWNER, EVENT, [], "originals")).toMatchObject({
      status: 400,
    });
    const many = Array.from({ length: SIGN_BATCH_SIZE + 1 }, (_, i) => id(i + 1));
    expect(await signAlbumFiles(deps, OWNER, EVENT, many, "originals")).toMatchObject({
      status: 400,
    });
    expect(await signAlbumFiles(deps, STRANGER, EVENT, [id(1)], "originals")).toMatchObject({
      status: 404,
    });
  });
});
