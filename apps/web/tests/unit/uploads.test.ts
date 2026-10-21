import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  MULTIPART_PART_SIZE_BYTES,
  type MultipartRequest,
  type ParsedReserveUploadRequest,
} from "@snapalbum/shared";
import { completeUpload, expectedPartSize, multipartAction, reserveUpload } from "@/server/uploads";
import type { Storage } from "@/server/storage";

const MB = 1024 * 1024;
const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const MEDIA = "a1b2c3d4-0000-4000-8000-123456789abc";
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-21T10:00:00Z");

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([
  ...Array.from("RIFF", (c) => c.charCodeAt(0)),
  1,
  2,
  3,
  4,
  ...Array.from("WEBP", (c) => c.charCodeAt(0)),
]);
const MP4 = Uint8Array.from([
  0,
  0,
  0,
  24,
  ...Array.from("ftypisom", (c) => c.charCodeAt(0)),
  0,
  0,
  0,
  0,
]);
const HTML = Uint8Array.from(Array.from("<html><script>x</script>", (c) => c.charCodeAt(0)));

interface Script {
  event?: { id: string; plan: string } | null;
  rpc?: unknown;
  /** Rows returned by `maybeSingle`/`single`, by table. */
  media?: Record<string, unknown> | null;
  upload?: Record<string, unknown> | null;
  updateError?: unknown;
}

/** Fake service-role client: every step returns the chain, results come from the script. */
function fakeAdmin(script: Script) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: script.rpc, error: null }));
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "update", "insert", "delete"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    const row = () =>
      table === "events" ? script.event : table === "uploads" ? script.upload : script.media;
    chain.maybeSingle = async () => ({ data: row() ?? null, error: null });
    chain.single = async () => ({ data: row(), error: null });
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({ error: script.updateError ?? null, data: null });
    return chain;
  };
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, calls };
}

function fakeStorage(overrides: Partial<Record<keyof Storage, unknown>> = {}) {
  const storage = {
    presignUpload: vi.fn(
      async (key: string, options: { contentType: string; contentLength: number }) => ({
        url: `https://r2.test/${key}?signed=1`,
        headers: {
          "Content-Type": options.contentType,
          "Content-Length": String(options.contentLength),
        },
      }),
    ),
    presignPart: vi.fn(
      async (key: string, _id: string, n: number) => `https://r2.test/${key}?part=${n}`,
    ),
    head: vi.fn(async () => null),
    readStart: vi.fn(async () => JPEG),
    deleteObject: vi.fn(async () => undefined),
    createMultipart: vi.fn(async () => "multipart-id"),
    listParts: vi.fn(async () => []),
    completeMultipart: vi.fn(async () => undefined),
    abortMultipart: vi.fn(async () => undefined),
    ...overrides,
  };
  return storage as unknown as Storage & typeof storage;
}

const photo: ParsedReserveUploadRequest = {
  eventCode: "k7m2x9qvbr",
  kind: "photo",
  sha256: "a".repeat(64),
  mimeType: "image/jpeg",
  extension: "jpg",
  bytes: 3 * MB,
  displayBytes: 400_000,
  thumbBytes: 20_000,
  previewFormat: "webp",
  width: 4000,
  height: 3000,
};
const video: ParsedReserveUploadRequest = {
  ...photo,
  kind: "video",
  mimeType: "video/mp4",
  extension: "mp4",
  bytes: 30 * MB,
  displayBytes: undefined,
  durationSeconds: 20,
};

const deps = (admin: SupabaseClient, storage: Storage) => ({
  admin,
  storage,
  now: () => NOW,
  newId: () => MEDIA,
});

function reservedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA,
    event_id: EVENT,
    kind: "photo",
    status: "pending",
    moderation: "approved",
    mime_type: "image/jpeg",
    bytes_original: null,
    bytes_display: 400_000,
    bytes_thumb: 20_000,
    key_original: null,
    key_display: `events/${EVENT}/display/${MEDIA}.webp`,
    key_thumb: `events/${EVENT}/thumb/${MEDIA}.webp`,
    ...overrides,
  };
}

describe("SPEC 8.1: réservation d'un envoi", () => {
  it("SPEC 8.1: enregistre le blurhash de la miniature, une seule fois", async () => {
    const hash = "L#Iqkc2owxX6tfW:jtfjdef7fQf7";
    const first = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA, moderation: "approved" },
      media: reservedRow(),
    });
    await reserveUpload(
      deps(first.client, fakeStorage()),
      { id: USER },
      { ...photo, blurhash: hash },
    );
    expect(first.calls).toContainEqual({
      table: "media",
      method: "update",
      args: [{ blurhash: hash }],
    });

    // A resumed reservation keeps the placeholder it already has.
    const resumed = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA },
      media: reservedRow({ blurhash: "00L39k" }),
    });
    await reserveUpload(
      deps(resumed.client, fakeStorage()),
      { id: USER },
      { ...photo, blurhash: hash },
    );
    expect(resumed.calls.some((call) => call.method === "update")).toBe(false);

    // Older clients send none.
    const none = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA },
      media: reservedRow(),
    });
    await reserveUpload(deps(none.client, fakeStorage()), { id: USER }, photo);
    expect(none.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("SPEC 8.1: signe l'affichage et la miniature d'une photo gratuite, sans original (R2)", async () => {
    const { client, rpc } = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA, moderation: "approved" },
      media: reservedRow(),
    });
    const storage = fakeStorage();
    const result = await reserveUpload(deps(client, storage), { id: USER }, photo);

    expect(result.ok).toBe(true);
    if (!result.ok || result.body.status !== "reserved") throw new Error("not reserved");
    expect(result.body.original).toBeNull();
    expect(result.body.multipart).toBeNull();
    expect(result.body.display?.url).toContain(`display/${MEDIA}.webp`);
    expect(result.body.thumb.url).toContain(`thumb/${MEDIA}.webp`);
    expect(result.body.thumb.expiresAt).toBe("2026-10-21T10:15:00.000Z");

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_event_id: EVENT,
      p_user_id: USER,
      p_bytes_original: null,
      p_bytes_display: 400_000,
      p_key_original: null,
      p_max_media: 200,
      p_max_videos: 10,
    });
    // Signed with the exact declared size and the right type (S-002).
    expect(storage.presignUpload).toHaveBeenCalledWith(`events/${EVENT}/display/${MEDIA}.webp`, {
      contentType: "image/webp",
      contentLength: 400_000,
    });
  });

  it("R2: une photo sur une offre payante garde aussi son original, avec les limites de l'offre", async () => {
    const key = `events/${EVENT}/original/${MEDIA}.jpg`;
    const { client, rpc } = fakeAdmin({
      event: { id: EVENT, plan: "event" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA },
      media: reservedRow({ bytes_original: 3 * MB, key_original: key }),
    });
    const result = await reserveUpload(deps(client, fakeStorage()), { id: USER }, photo);
    if (!result.ok || result.body.status !== "reserved") throw new Error("not reserved");
    expect(result.body.original?.url).toContain("original");
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_key_original: key, p_max_media: 10_000, p_max_videos: null });
  });

  it("SPEC 8.1: une vidéo n'a pas de version d'affichage et garde son fichier tel quel", async () => {
    const key = `events/${EVENT}/original/${MEDIA}.mp4`;
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA },
      media: reservedRow({
        kind: "video",
        mime_type: "video/mp4",
        bytes_original: 30 * MB,
        bytes_display: null,
        key_original: key,
        key_display: null,
      }),
    });
    const result = await reserveUpload(deps(client, fakeStorage()), { id: USER }, video);
    if (!result.ok || result.body.status !== "reserved") throw new Error("not reserved");
    expect(result.body.display).toBeNull();
    expect(result.body.original?.url).toContain("original");
    expect(result.body.multipart).toBeNull();
  });

  it("NF-013: une vidéo de plus de 50 Mo s'envoie en morceaux, sans adresse unique", async () => {
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "event" },
      rpc: { ok: true, result: "reserved", media_id: MEDIA },
      media: reservedRow({
        kind: "video",
        mime_type: "video/mp4",
        bytes_original: 95 * MB,
        bytes_display: null,
        key_original: `events/${EVENT}/original/${MEDIA}.mp4`,
        key_display: null,
      }),
    });
    const result = await reserveUpload(
      deps(client, fakeStorage()),
      { id: USER },
      { ...video, bytes: 95 * MB },
    );
    if (!result.ok || result.body.status !== "reserved") throw new Error("not reserved");
    expect(result.body.original).toBeNull();
    expect(result.body.multipart).toEqual({ partSize: MULTIPART_PART_SIZE_BYTES, partCount: 10 });
  });

  it("NF-012: un fichier déjà reçu ne demande aucun envoi", async () => {
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "duplicate", media_id: MEDIA },
    });
    const storage = fakeStorage();
    const result = await reserveUpload(deps(client, storage), { id: USER }, photo);
    expect(result).toEqual({ ok: true, body: { status: "already_received", mediaId: MEDIA } });
    expect(storage.presignUpload).not.toHaveBeenCalled();
  });

  it("NF-012: une réservation reprise garde ses clés d'origine, même si le format d'aperçu a changé", async () => {
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: true, result: "resumed", media_id: MEDIA },
      media: reservedRow({
        key_display: `events/${EVENT}/display/${MEDIA}.jpg`,
        key_thumb: `events/${EVENT}/thumb/${MEDIA}.jpg`,
      }),
    });
    const storage = fakeStorage();
    await reserveUpload(deps(client, storage), { id: USER }, { ...photo, previewFormat: "webp" });
    const calls = (storage.presignUpload as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((call) => (call[1] as { contentType: string }).contentType);
    expect(types).toEqual(["image/jpeg", "image/jpeg"]);
  });

  it.each([
    ["event_not_found", 404, "not_found"],
    ["event_suspended", 403, "event_suspended"],
    ["upload_window_closed", 403, "upload_window_closed"],
    ["not_a_guest", 403, "forbidden"],
    ["guest_blocked", 403, "guest_blocked"],
    ["terms_required", 403, "terms_required"],
    ["album_full", 409, "album_full"],
    ["video_limit_reached", 409, "video_limit_reached"],
    ["invalid_input", 400, "validation_failed"],
    ["something_new", 500, "internal_error"],
  ])("R1: traduit le refus %s de la base en %i %s", async (reason, status, code) => {
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "free" },
      rpc: { ok: false, reason },
    });
    const storage = fakeStorage();
    expect(await reserveUpload(deps(client, storage), { id: USER }, photo)).toEqual({
      ok: false,
      status,
      code,
    });
    expect(storage.presignUpload).not.toHaveBeenCalled();
  });
});

describe("S-002: contrôles faits avant d'interroger la base", () => {
  async function refused(request: ParsedReserveUploadRequest, plan = "free") {
    const { client, rpc } = fakeAdmin({ event: { id: EVENT, plan }, rpc: { ok: true } });
    const result = await reserveUpload(deps(client, fakeStorage()), { id: USER }, request);
    expect(rpc).not.toHaveBeenCalled();
    return result;
  }

  it("un événement inconnu est introuvable", async () => {
    const { client, rpc } = fakeAdmin({ event: null });
    expect(await reserveUpload(deps(client, fakeStorage()), { id: USER }, photo)).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuse un type de fichier non accepté, ou qui ne correspond pas à son extension ou à son genre", async () => {
    for (const change of [
      { mimeType: "application/pdf", extension: "jpg" as const },
      { mimeType: "image/jpeg", extension: "png" as const },
      { mimeType: "video/mp4", extension: "mp4" as const },
    ]) {
      expect(await refused({ ...photo, ...change })).toEqual({
        ok: false,
        status: 415,
        code: "unsupported_format",
      });
    }
  });

  it("R1: refuse une vidéo trop longue, trop lourde, ou sans durée déclarée", async () => {
    expect(await refused({ ...video, durationSeconds: 31 })).toEqual({
      ok: false,
      status: 422,
      code: "video_too_long",
    });
    expect(await refused({ ...video, bytes: 101 * MB })).toEqual({
      ok: false,
      status: 413,
      code: "file_too_large",
    });
    expect(await refused({ ...video, durationSeconds: undefined })).toEqual({
      ok: false,
      status: 400,
      code: "validation_failed",
    });
  });

  it("R1: les limites viennent de l'offre : 3 minutes et 500 Mo sur l'offre Événement", async () => {
    const { client } = fakeAdmin({
      event: { id: EVENT, plan: "event" },
      rpc: { ok: false, reason: "album_full" },
    });
    const result = await reserveUpload(
      deps(client, fakeStorage()),
      { id: USER },
      { ...video, bytes: 400 * MB, durationSeconds: 170 },
    );
    expect(result).toMatchObject({ ok: false, code: "album_full" });
  });

  it("refuse une photo, une version d'affichage ou une miniature démesurées", async () => {
    expect(await refused({ ...photo, bytes: 51 * MB })).toMatchObject({
      status: 413,
      code: "file_too_large",
    });
    expect(await refused({ ...photo, displayBytes: 21 * MB })).toMatchObject({ status: 413 });
    expect(await refused({ ...photo, thumbBytes: 2 * MB })).toMatchObject({ status: 413 });
  });
});

describe("SPEC 8.1: confirmation d'un envoi", () => {
  const stored = (bytes: number) => ({ size: bytes, contentType: "image/webp", etag: '"x"' });

  function storageWith(
    files: Record<string, { size: number; start: Uint8Array } | null | undefined>,
  ) {
    return fakeStorage({
      head: vi.fn(async (key: string) => (files[key] ? stored(files[key]!.size) : null)),
      readStart: vi.fn(async (key: string) => files[key]?.start ?? new Uint8Array()),
    });
  }

  const display = `events/${EVENT}/display/${MEDIA}.webp`;
  const thumb = `events/${EVENT}/thumb/${MEDIA}.webp`;

  it("SPEC 8.1: passe le média en prêt quand tous les fichiers sont là, de la bonne taille et du bon type", async () => {
    const { client, calls } = fakeAdmin({ media: reservedRow() });
    const storage = storageWith({
      [display]: { size: 400_000, start: WEBP },
      [thumb]: { size: 20_000, start: WEBP },
    });
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toEqual({
      ok: true,
      body: { mediaId: MEDIA, status: "ready" },
    });
    expect(calls.find((c) => c.table === "media" && c.method === "update")?.args[0]).toEqual({
      status: "ready",
    });
  });

  it("F-071: un média en attente de validation répond pending_moderation", async () => {
    const { client } = fakeAdmin({ media: reservedRow({ moderation: "pending" }) });
    const storage = storageWith({
      [display]: { size: 400_000, start: JPEG },
      [thumb]: { size: 20_000, start: JPEG },
    });
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toMatchObject({
      ok: true,
      body: { status: "pending_moderation" },
    });
  });

  it("NF-012: confirmer deux fois est sans effet", async () => {
    const { client, calls } = fakeAdmin({ media: reservedRow({ status: "ready" }) });
    const storage = fakeStorage();
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toMatchObject({
      ok: true,
    });
    expect(storage.head).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("NF-010: un fichier absent ou de mauvaise taille est « pas terminé » : rien n'est supprimé, on peut réessayer", async () => {
    for (const files of [
      { [display]: { size: 400_000, start: WEBP } },
      { [display]: { size: 399_999, start: WEBP }, [thumb]: { size: 20_000, start: WEBP } },
    ]) {
      const { client, calls } = fakeAdmin({ media: reservedRow() });
      const storage = storageWith(files);
      expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toEqual({
        ok: false,
        status: 409,
        code: "upload_incomplete",
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(calls.some((c) => c.method === "delete")).toBe(false);
    }
  });

  it("S-002: un fichier qui n'est pas ce qu'il prétend être est supprimé et sa place libérée", async () => {
    const { client, calls } = fakeAdmin({ media: reservedRow() });
    const storage = storageWith({
      [display]: { size: 400_000, start: HTML },
      [thumb]: { size: 20_000, start: WEBP },
    });
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toEqual({
      ok: false,
      status: 422,
      code: "invalid_file",
    });
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(calls.some((c) => c.table === "media" && c.method === "delete")).toBe(true);
  });

  it("S-002: une vidéo déclarée dont le contenu est une image est refusée", async () => {
    const original = `events/${EVENT}/original/${MEDIA}.mp4`;
    const { client } = fakeAdmin({
      media: reservedRow({
        kind: "video",
        bytes_original: 5000,
        key_original: original,
        key_display: null,
        bytes_display: null,
      }),
    });
    const storage = storageWith({
      [original]: { size: 5000, start: JPEG },
      [thumb]: { size: 20_000, start: WEBP },
    });
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toMatchObject({
      code: "invalid_file",
    });
  });

  it("S-002: une vidéo valide est confirmée avec son original", async () => {
    const original = `events/${EVENT}/original/${MEDIA}.mp4`;
    const { client } = fakeAdmin({
      media: reservedRow({
        kind: "video",
        bytes_original: 5000,
        key_original: original,
        key_display: null,
        bytes_display: null,
      }),
    });
    const storage = storageWith({
      [original]: { size: 5000, start: MP4 },
      [thumb]: { size: 20_000, start: WEBP },
    });
    expect(await completeUpload(deps(client, storage), { id: USER }, MEDIA)).toMatchObject({
      ok: true,
    });
  });

  it("S-001: le média d'un autre invité, un média inconnu ou déjà supprimé sont introuvables", async () => {
    for (const media of [
      null,
      reservedRow({ status: "deleted" }),
      reservedRow({ status: "hidden" }),
    ]) {
      const { client } = fakeAdmin({ media });
      expect(await completeUpload(deps(client, fakeStorage()), { id: USER }, MEDIA)).toEqual({
        ok: false,
        status: 404,
        code: "not_found",
      });
    }
  });
});

describe("NF-013: envoi en morceaux (serveur)", () => {
  const original = `events/${EVENT}/original/${MEDIA}.mp4`;
  const bigVideo = (extra: Record<string, unknown> = {}) =>
    reservedRow({
      kind: "video",
      mime_type: "video/mp4",
      bytes_original: 95 * MB,
      bytes_display: null,
      key_original: original,
      key_display: null,
      ...extra,
    });
  const request = (action: MultipartRequest["action"], extra: object = {}) =>
    ({ action, mediaId: MEDIA, ...extra }) as MultipartRequest;
  const future = new Date(NOW.getTime() + 3_600_000).toISOString();
  const liveUpload = { id: "up1", multipart_upload_id: "mp-1", expires_at: future };

  it("NF-013: la taille attendue de chaque morceau : pleins, sauf le dernier", () => {
    expect(expectedPartSize(95 * MB, 1)).toBe(10 * MB);
    expect(expectedPartSize(95 * MB, 9)).toBe(10 * MB);
    expect(expectedPartSize(95 * MB, 10)).toBe(5 * MB);
    expect(expectedPartSize(95 * MB, 11)).toBe(0);
  });

  it("NF-013: démarre l'envoi en morceaux et l'enregistre", async () => {
    const { client, calls } = fakeAdmin({ media: bigVideo(), upload: null });
    const storage = fakeStorage();
    const result = await multipartAction(deps(client, storage), { id: USER }, request("create"));
    expect(result).toEqual({
      ok: true,
      body: { action: "create", partSize: 10 * MB, partCount: 10 },
    });
    expect(storage.createMultipart).toHaveBeenCalledWith(original, "video/mp4");
    expect(
      calls.find((c) => c.table === "uploads" && c.method === "insert")?.args[0],
    ).toMatchObject({
      media_id: MEDIA,
      multipart_upload_id: "multipart-id",
    });
  });

  it("NF-013: un envoi déjà démarré et valide est repris sans en créer un second", async () => {
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    const storage = fakeStorage();
    expect(
      await multipartAction(deps(client, storage), { id: USER }, request("create")),
    ).toMatchObject({ ok: true });
    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it("NF-013: un envoi expiré est abandonné puis recommencé", async () => {
    const { client } = fakeAdmin({
      media: bigVideo(),
      upload: { ...liveUpload, expires_at: new Date(NOW.getTime() - 1000).toISOString() },
    });
    const storage = fakeStorage();
    await multipartAction(deps(client, storage), { id: USER }, request("create"));
    expect(storage.abortMultipart).toHaveBeenCalledWith(original, "mp-1");
    expect(storage.createMultipart).toHaveBeenCalledTimes(1);
  });

  it("NF-013: signe un morceau avec sa taille exacte, le dernier plus petit", async () => {
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    const storage = fakeStorage();
    const first = await multipartAction(
      deps(client, storage),
      { id: USER },
      request("part", { partNumber: 1 }),
    );
    const last = await multipartAction(
      deps(client, storage),
      { id: USER },
      request("part", { partNumber: 10 }),
    );
    expect(first).toMatchObject({
      ok: true,
      body: { target: { headers: { "Content-Length": String(10 * MB) } } },
    });
    expect(last).toMatchObject({
      ok: true,
      body: { target: { headers: { "Content-Length": String(5 * MB) } } },
    });
    expect(storage.presignPart).toHaveBeenCalledWith(original, "mp-1", 10, {
      contentLength: 5 * MB,
    });
  });

  it("NF-013: refuse un numéro de morceau au-delà du dernier", async () => {
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    expect(
      await multipartAction(
        deps(client, fakeStorage()),
        { id: USER },
        request("part", { partNumber: 11 }),
      ),
    ).toEqual({
      ok: false,
      status: 400,
      code: "validation_failed",
    });
  });

  it("NF-013: dit quels morceaux sont déjà reçus, pour reprendre au bon endroit", async () => {
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    const storage = fakeStorage({
      listParts: vi.fn(async () => [
        { partNumber: 1, size: 10 * MB, etag: "a" },
        { partNumber: 2, size: 10 * MB, etag: "b" },
      ]),
    });
    expect(await multipartAction(deps(client, storage), { id: USER }, request("status"))).toEqual({
      ok: true,
      body: {
        action: "status",
        parts: [
          { partNumber: 1, size: 10 * MB },
          { partNumber: 2, size: 10 * MB },
        ],
      },
    });
  });

  it("NF-013: assemble le fichier quand tous les morceaux sont là, d'après le stockage et pas le navigateur", async () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({
      partNumber: i + 1,
      size: i === 9 ? 5 * MB : 10 * MB,
      etag: `etag-${i + 1}`,
    }));
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    const storage = fakeStorage({ listParts: vi.fn(async () => parts) });
    expect(await multipartAction(deps(client, storage), { id: USER }, request("complete"))).toEqual(
      {
        ok: true,
        body: { action: "complete" },
      },
    );
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      original,
      "mp-1",
      parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    );
  });

  it("NF-013: n'assemble pas un fichier incomplet ou dont un morceau a la mauvaise taille", async () => {
    for (const parts of [
      [{ partNumber: 1, size: 10 * MB, etag: "a" }],
      Array.from({ length: 10 }, (_, i) => ({ partNumber: i + 1, size: 10 * MB, etag: "x" })),
    ]) {
      const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
      const storage = fakeStorage({ listParts: vi.fn(async () => parts) });
      expect(
        await multipartAction(deps(client, storage), { id: USER }, request("complete")),
      ).toEqual({
        ok: false,
        status: 409,
        code: "upload_incomplete",
      });
      expect(storage.completeMultipart).not.toHaveBeenCalled();
    }
  });

  it("NF-013: abandonne l'envoi sur demande", async () => {
    const { client } = fakeAdmin({ media: bigVideo(), upload: liveUpload });
    const storage = fakeStorage();
    expect(await multipartAction(deps(client, storage), { id: USER }, request("abort"))).toEqual({
      ok: true,
      body: { action: "abort" },
    });
    expect(storage.abortMultipart).toHaveBeenCalledWith(original, "mp-1");
  });

  it("NF-013: sans envoi démarré ou après expiration, les actions demandent de recommencer", async () => {
    for (const upload of [
      null,
      { ...liveUpload, expires_at: new Date(NOW.getTime() - 1).toISOString() },
    ]) {
      const { client } = fakeAdmin({ media: bigVideo(), upload });
      for (const action of ["part", "status", "complete", "abort"] as const) {
        const result = await multipartAction(
          deps(client, fakeStorage()),
          { id: USER },
          request(action, action === "part" ? { partNumber: 1 } : {}),
        );
        expect(result).toEqual({ ok: false, status: 409, code: "upload_incomplete" });
      }
    }
  });

  it("S-001: seul l'invité propriétaire d'une vidéo en attente et assez grosse peut utiliser les morceaux", async () => {
    for (const media of [null, bigVideo({ status: "ready" })]) {
      const { client } = fakeAdmin({ media });
      expect(
        await multipartAction(deps(client, fakeStorage()), { id: USER }, request("create")),
      ).toEqual({
        ok: false,
        status: 404,
        code: "not_found",
      });
    }
    const small = fakeAdmin({ media: bigVideo({ bytes_original: 10 * MB }) });
    expect(
      await multipartAction(deps(small.client, fakeStorage()), { id: USER }, request("create")),
    ).toEqual({
      ok: false,
      status: 400,
      code: "validation_failed",
    });
    const noOriginal = fakeAdmin({ media: reservedRow() });
    expect(
      await multipartAction(
        deps(noOriginal.client, fakeStorage()),
        { id: USER },
        request("create"),
      ),
    ).toMatchObject({
      ok: false,
      code: "validation_failed",
    });
  });
});
