import { describe, expect, it, vi } from "vitest";
import {
  dismissReports,
  listModeration,
  moderateMedia,
  moderationCounts,
  moderationFile,
  reporterFingerprint,
  reportMedia,
  setGuestBlocked,
  type ModerationDeps,
} from "@/server/moderation";
import type { Storage } from "@/server/storage";
import { fakeAdmin, type Row } from "./fake-admin";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OTHER_EVENT = "4a2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d99";
const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const GUEST = "0ddddddd-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-22T10:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const deleted: string[] = [];
const storage = {
  presignRead: vi.fn(async (key: string) => `https://signed.test/${key}`),
  deleteObject: vi.fn(async (key: string) => {
    deleted.push(key);
  }),
} as unknown as Storage;

const media = (n: number, overrides: Row = {}): Row => ({
  id: id(n),
  event_id: EVENT,
  guest_id: GUEST,
  kind: "photo",
  status: "ready",
  moderation: "approved",
  key_thumb: `events/${EVENT}/thumb/${n}.webp`,
  key_display: `events/${EVENT}/display/${n}.webp`,
  key_original: `events/${EVENT}/original/${n}.jpg`,
  created_at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
  ...overrides,
});

function world(extra: Record<string, Row[]> = {}, insertErrors = {}) {
  const tables: Record<string, Row[]> = {
    events: [{ id: EVENT, owner_id: OWNER, status: "active" }],
    guests: [
      { id: GUEST, event_id: EVENT, display_name: "Anna", blocked_at: null },
      { id: "guest-2", event_id: EVENT, display_name: null, blocked_at: "2026-10-01T00:00:00Z" },
    ],
    media: [],
    reports: [],
    audit_log: [],
    ...extra,
  };
  const deps: ModerationDeps = {
    admin: fakeAdmin(tables, {}, insertErrors),
    storage,
    now: () => NOW,
  };
  return { tables, deps };
}

const statusOf = (tables: Record<string, Row[]>, n: number) =>
  (({ status, moderation }) => ({ status, moderation }))(
    tables.media!.find((row) => row.id === id(n))! as { status: string; moderation: string },
  );

describe("F-070, F-071: actions de modération", () => {
  it("F-071: approuver (en attente ou refusé) et refuser (en attente seulement)", async () => {
    const { tables, deps } = world({
      media: [
        media(1, { moderation: "pending" }),
        media(2, { moderation: "rejected" }),
        media(3, { moderation: "pending" }),
        media(4),
      ],
    });
    expect(await moderateMedia(deps, OWNER, EVENT, "approve", [id(1), id(2), id(4)])).toEqual({
      ok: true,
      body: { changed: 2 },
    });
    expect(statusOf(tables, 1).moderation).toBe("approved");
    expect(statusOf(tables, 2).moderation).toBe("approved");
    // Refusing: only a waiting photo; an approved one is hidden instead.
    expect(await moderateMedia(deps, OWNER, EVENT, "reject", [id(3), id(4)])).toMatchObject({
      body: { changed: 1 },
    });
    expect(statusOf(tables, 3).moderation).toBe("rejected");
    expect(statusOf(tables, 4).moderation).toBe("approved");
  });

  it("F-070: masquer puis rétablir, et seulement dans le bon état", async () => {
    const { tables, deps } = world({ media: [media(1), media(2, { status: "hidden" })] });
    expect(await moderateMedia(deps, OWNER, EVENT, "hide", [id(1), id(2)])).toMatchObject({
      body: { changed: 1 },
    });
    expect(statusOf(tables, 1).status).toBe("hidden");
    expect(await moderateMedia(deps, OWNER, EVENT, "restore", [id(1), id(2)])).toMatchObject({
      body: { changed: 2 },
    });
    expect(statusOf(tables, 2).status).toBe("ready");
  });

  it("F-070: supprimer efface les trois fichiers de chaque média, règle les signalements et journalise", async () => {
    deleted.length = 0;
    const { tables, deps } = world({
      media: [media(1), media(2, { status: "hidden" }), media(3, { status: "deleted" })],
      reports: [{ id: "r1", media_id: id(1), resolved_at: null }],
    });
    const result = await moderateMedia(deps, OWNER, EVENT, "delete", [id(1), id(2), id(3)]);
    expect(result).toEqual({ ok: true, body: { changed: 2 } });
    expect(statusOf(tables, 1).status).toBe("deleted");
    expect(deleted).toHaveLength(6);
    expect(deleted).toContain(`events/${EVENT}/original/1.jpg`);
    expect(tables.reports![0]!.resolved_at).toBe("2026-10-22T10:00:00.000Z");
    expect(tables.audit_log).toHaveLength(1);
    expect(tables.audit_log![0]).toMatchObject({
      actor_id: OWNER,
      action: "media.delete",
      target_id: EVENT,
      metadata: { count: 2 },
    });
  });

  it("F-070: approuver et rétablir ne sont pas journalisés, masquer et refuser le sont", async () => {
    const { tables, deps } = world({
      media: [media(1, { moderation: "pending" }), media(2, { moderation: "pending" }), media(3)],
    });
    await moderateMedia(deps, OWNER, EVENT, "approve", [id(1)]);
    expect(tables.audit_log).toHaveLength(0);
    await moderateMedia(deps, OWNER, EVENT, "reject", [id(2)]);
    await moderateMedia(deps, OWNER, EVENT, "hide", [id(3)]);
    expect(tables.audit_log!.map((row) => row.action)).toEqual(["media.reject", "media.hide"]);
  });

  it("S-001: un autre organisateur est refusé ; des identifiants d'un autre événement ne changent rien", async () => {
    const { tables, deps } = world({ media: [media(1, { event_id: OTHER_EVENT })] });
    expect(await moderateMedia(deps, STRANGER, EVENT, "hide", [id(1)])).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
    expect(await moderateMedia(deps, OWNER, EVENT, "hide", [id(1)])).toMatchObject({
      body: { changed: 0 },
    });
    expect(statusOf(tables, 1).status).toBe("ready");
  });

  it("S-001: un événement suspendu ne se modère plus", async () => {
    const { deps } = world({ events: [{ id: EVENT, owner_id: OWNER, status: "suspended" }] });
    expect(await moderateMedia(deps, OWNER, EVENT, "hide", [id(1)])).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("NF-043: un lot vide, trop grand, ou avec des doublons", async () => {
    const { deps } = world({ media: [media(1)] });
    expect(await moderateMedia(deps, OWNER, EVENT, "hide", [])).toMatchObject({ status: 400 });
    const many = Array.from({ length: 201 }, (_, i) => id(i + 1));
    expect(await moderateMedia(deps, OWNER, EVENT, "hide", many)).toMatchObject({ status: 400 });
    // The same id many times counts once.
    expect(
      await moderateMedia(
        deps,
        OWNER,
        EVENT,
        "hide",
        Array.from({ length: 300 }, () => id(1)),
      ),
    ).toMatchObject({ ok: true, body: { changed: 1 } });
  });
});

describe("F-072: blocage d'un invité", () => {
  it("F-072: bloque, débloque et journalise ; un invité d'un autre événement est introuvable", async () => {
    const { tables, deps } = world();
    expect(await setGuestBlocked(deps, OWNER, EVENT, GUEST, true)).toEqual({
      ok: true,
      body: { blocked: true },
    });
    expect(tables.guests![0]!.blocked_at).toBe("2026-10-22T10:00:00.000Z");
    await setGuestBlocked(deps, OWNER, EVENT, GUEST, false);
    expect(tables.guests![0]!.blocked_at).toBeNull();
    expect(tables.audit_log!.map((row) => row.action)).toEqual(["guest.block", "guest.unblock"]);

    expect(await setGuestBlocked(deps, OWNER, EVENT, "inconnu", true)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await setGuestBlocked(deps, STRANGER, EVENT, GUEST, true)).toMatchObject({
      status: 404,
    });
  });
});

describe("F-073: signalements", () => {
  it("F-073: l'empreinte est un hachage salé, différent pour un invité et une adresse", () => {
    const a = reporterFingerprint("sel", { userId: "u1" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(reporterFingerprint("sel", { userId: "u1" }));
    expect(a).not.toBe(reporterFingerprint("autre", { userId: "u1" }));
    expect(reporterFingerprint("sel", { ip: "1.2.3.4" })).not.toBe(
      reporterFingerprint("sel", { ip: "1.2.3.5" }),
    );
    expect(reporterFingerprint("sel", {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it("F-073: signaler un média visible l'enregistre, un doublon est accepté, un média non montré est refusé", async () => {
    const { tables, deps } = world({
      media: [media(1), media(2, { status: "hidden" }), media(3, { event_id: OTHER_EVENT })],
    });
    const who = reporterFingerprint("sel", { userId: "u1" });
    expect(await reportMedia(deps.admin, EVENT, who, id(1), "other")).toEqual({
      ok: true,
      body: { ok: true },
    });
    expect(tables.reports).toHaveLength(1);
    expect(tables.reports![0]).toMatchObject({ media_id: id(1), reason: "other" });
    for (const n of [2, 3, 9]) {
      expect(await reportMedia(deps.admin, EVENT, who, id(n), "other")).toMatchObject({
        ok: false,
        status: 404,
      });
    }
  });

  it("F-073: un doublon (violation d'unicité) n'est pas une erreur, une autre erreur l'est", async () => {
    const duplicate = world({ media: [media(1)] }, { reports: { code: "23505" } });
    expect(
      (await reportMedia(duplicate.deps.admin, EVENT, "a".repeat(64), id(1), "other")).ok,
    ).toBe(true);
    const broken = world({ media: [media(1)] }, { reports: { code: "XX000" } });
    await expect(
      reportMedia(broken.deps.admin, EVENT, "a".repeat(64), id(1), "other"),
    ).rejects.toBeDefined();
  });

  it("F-073: ignorer un signalement le règle sans toucher au média, seulement pour son événement", async () => {
    const { tables, deps } = world({
      media: [media(1), media(2, { event_id: OTHER_EVENT })],
      reports: [
        { id: "r1", media_id: id(1), resolved_at: null },
        { id: "r2", media_id: id(2), resolved_at: null },
      ],
    });
    expect(await dismissReports(deps, OWNER, EVENT, [id(1), id(2)])).toEqual({
      ok: true,
      body: { changed: 1 },
    });
    expect(tables.reports![0]!.resolved_at).toBe("2026-10-22T10:00:00.000Z");
    expect(tables.reports![1]!.resolved_at).toBeNull();
    expect(statusOf(tables, 1).status).toBe("ready");
    expect(await dismissReports(deps, OWNER, EVENT, [id(2)])).toMatchObject({
      body: { changed: 0 },
    });
    expect(await dismissReports(deps, STRANGER, EVENT, [id(1)])).toMatchObject({ status: 404 });
    expect(await dismissReports(deps, OWNER, EVENT, [])).toMatchObject({ status: 400 });
  });
});

describe("F-070, F-071: listes", () => {
  const all = () =>
    world({
      media: [
        media(1, { moderation: "pending" }),
        media(2),
        media(3, { status: "hidden" }),
        media(4, { moderation: "rejected" }),
        media(5),
        media(6, { event_id: OTHER_EVENT }),
      ],
      reports: [
        { id: "r1", media_id: id(5), resolved_at: null },
        { id: "r2", media_id: id(5), resolved_at: null },
        { id: "r3", media_id: id(2), resolved_at: "2026-10-02T00:00:00Z" },
      ],
    });

  it("F-071: chaque liste montre les médias de son état et les compteurs les comptent", async () => {
    const { deps } = all();
    const ids = async (filter: "pending" | "visible" | "hidden" | "refused" | "reported") => {
      const result = await listModeration(deps, OWNER, EVENT, { filter });
      if (!result.ok) throw new Error("refused");
      return result.body.items.map((item) => item.mediaId);
    };
    expect(await ids("pending")).toEqual([id(1)]);
    expect(await ids("visible")).toEqual([id(5), id(2)]);
    expect(await ids("hidden")).toEqual([id(3)]);
    expect(await ids("refused")).toEqual([id(4)]);
    expect(await ids("reported")).toEqual([id(5)]);
    expect(await moderationCounts(deps.admin, EVENT)).toEqual({
      pending: 1,
      visible: 2,
      hidden: 1,
      refused: 1,
      reported: 1,
    });
  });

  it("F-070: la première page donne les invités (bloqués d'abord) et le nombre de signalements par média", async () => {
    const { deps } = all();
    const result = await listModeration(deps, OWNER, EVENT, { filter: "reported" });
    if (!result.ok) throw new Error("refused");
    expect(result.body.items[0]).toMatchObject({
      mediaId: id(5),
      reports: 2,
      guestName: "Anna",
      thumbUrl: `https://signed.test/events/${EVENT}/thumb/5.webp`,
    });
    expect(result.body.guests.map((guest) => [guest.id, guest.blocked])).toEqual([
      ["guest-2", true],
      [GUEST, false],
    ]);
    expect(result.body.guests.find((guest) => guest.id === GUEST)?.count).toBe(5);
  });

  it("F-070: les pages se suivent par curseur, sans invités ni doublon après la première", async () => {
    const { deps } = all();
    const first = await listModeration(deps, OWNER, EVENT, { filter: "visible", limit: 1 });
    if (!first.ok) throw new Error("refused");
    expect(first.body.items.map((item) => item.mediaId)).toEqual([id(5)]);
    const second = await listModeration(deps, OWNER, EVENT, {
      filter: "visible",
      limit: 1,
      cursor: first.body.nextCursor!,
    });
    if (!second.ok) throw new Error("refused");
    expect(second.body.items.map((item) => item.mediaId)).toEqual([id(2)]);
    expect(second.body.guests).toEqual([]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("NF-043, S-001: un curseur illisible est refusé, un autre organisateur est refusé", async () => {
    const { deps } = all();
    expect(await listModeration(deps, OWNER, EVENT, { filter: "visible", cursor: "x" })).toEqual({
      ok: false,
      status: 400,
      code: "validation_failed",
    });
    expect(await listModeration(deps, STRANGER, EVENT, { filter: "visible" })).toMatchObject({
      status: 404,
    });
  });

  it("F-071: l'image à examiner : la version d'affichage d'une photo, l'original d'une vidéo", async () => {
    const { deps } = world({
      media: [
        media(1),
        media(2, { kind: "video", key_display: null }),
        media(3, { status: "deleted" }),
      ],
    });
    expect(await moderationFile(deps, OWNER, EVENT, id(1))).toEqual({
      ok: true,
      body: { url: `https://signed.test/events/${EVENT}/display/1.webp`, kind: "photo" },
    });
    expect(await moderationFile(deps, OWNER, EVENT, id(2))).toEqual({
      ok: true,
      body: { url: `https://signed.test/events/${EVENT}/original/2.jpg`, kind: "video" },
    });
    expect(await moderationFile(deps, OWNER, EVENT, id(3))).toMatchObject({ status: 404 });
    expect(await moderationFile(deps, STRANGER, EVENT, id(1))).toMatchObject({ status: 404 });
  });
});
