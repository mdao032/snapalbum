import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { galleryRequestSchema } from "@snapalbum/shared";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { createEvent } from "@/server/events";
import {
  MAX_ACTIVE_SHARE_LINKS,
  createShareLink,
  gallery,
  listShareLinks,
  revokeShareLink,
  type GalleryDeps,
} from "@/server/gallery";
import { createStorage, type Storage } from "@/server/storage";

/**
 * The album against the real local database (Supabase) and a local S3 emulator: who may look,
 * keyset pagination, sorting, filters, signed addresses, share links. Needs `pnpm db:start` and
 * `pnpm storage:start`.
 */

function localEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const env = localEnv();
const endpoint = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const credentials = { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" };
const bucket = `snapalbum-gallery-${randomUUID().slice(0, 8)}`;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

let storage: Storage;
let deps: GalleryDeps;
const createdUsers: string[] = [];
const createdEvents: string[] = [];

async function newUser(options: { anonymous?: boolean } = {}): Promise<string> {
  if (options.anonymous) {
    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInAnonymously();
    if (error || !data.user) throw error ?? new Error("anonymous sign-in failed");
    createdUsers.push(data.user.id);
    return data.user.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: `gal-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

async function newEvent() {
  const owner = await newUser();
  const created = await createEvent(admin, owner, {
    title: "Mariage de Léa et Tom",
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return { event: created.event, owner };
}

async function newGuest(eventId: string, displayName: string | null = null) {
  const userId = await newUser({ anonymous: true });
  const { data, error } = await admin
    .from("guests")
    .insert({
      event_id: eventId,
      auth_user_id: userId,
      display_name: displayName,
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { userId, guestId: data.id };
}

async function putObject(key: string, body: string, contentType = "image/webp") {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

interface MediaOptions {
  kind?: "photo" | "video";
  moderation?: "approved" | "pending";
  status?: "ready" | "hidden" | "pending";
  takenAt?: string | null;
  createdAt?: string;
  withFiles?: boolean;
}

/** A media row (and, by default, its files in the storage), as an upload leaves them. */
async function addMedia(eventId: string, guestId: string, options: MediaOptions = {}) {
  const id = randomUUID();
  const kind = options.kind ?? "photo";
  const prefix = `events/${eventId}`;
  const keys = {
    key_thumb: `${prefix}/thumb/${id}.webp`,
    key_display: kind === "photo" ? `${prefix}/display/${id}.webp` : null,
    key_original: kind === "video" ? `${prefix}/original/${id}.mp4` : null,
  };
  if (options.withFiles !== false) {
    await putObject(keys.key_thumb, `thumb-${id}`);
    if (keys.key_display) await putObject(keys.key_display, `display-${id}`);
    if (keys.key_original) await putObject(keys.key_original, `video-${id}`, "video/mp4");
  }
  const { error } = await admin.from("media").insert({
    id,
    event_id: eventId,
    guest_id: guestId,
    kind,
    status: options.status ?? "ready",
    moderation: options.moderation ?? "approved",
    sha256: randomBytes(32).toString("hex"),
    mime_type: kind === "photo" ? "image/webp" : "video/mp4",
    bytes_display: kind === "photo" ? 100 : null,
    bytes_original: kind === "video" ? 100 : null,
    bytes_thumb: 50,
    width: 1200,
    height: 800,
    blurhash: "L#Iqkc2owxX6tfW:jtfjdef7fQf7",
    taken_at: options.takenAt === undefined ? null : options.takenAt,
    ...(options.createdAt ? { created_at: options.createdAt } : {}),
    ...keys,
  });
  if (error) throw error;
  return id;
}

const request = (body: unknown) => galleryRequestSchema.parse(body);
const eventAccess = (code: string) => ({ type: "event" as const, eventCode: code });
const list = (user: { id: string } | null, code: string, change: Record<string, unknown> = {}) =>
  gallery(deps, user, request({ action: "list", access: eventAccess(code), ...change }));

async function listOk(user: { id: string } | null, code: string, change = {}) {
  const result = await list(user, code, change);
  if (!result.ok || result.body.action !== "list")
    throw new Error(`refused: ${JSON.stringify(result)}`);
  return result.body;
}

beforeAll(async () => {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  storage = createStorage({
    endpoint,
    bucket,
    region: "us-east-1",
    forcePathStyle: true,
    ...credentials,
  });
  deps = { admin, storage };
});

afterAll(async () => {
  for (const id of createdEvents) {
    await storage.deleteEventObjects(`events/${id}/`).catch(() => undefined);
    await admin.from("events").delete().eq("id", id);
  }
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
}, 60_000);

describe("F-039: qui voit la galerie", () => {
  it("F-039: un invité voit les médias approuvés et prêts, pas les autres", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id, "Élodie");
    const shown = await addMedia(event.id, guest.guestId);
    await addMedia(event.id, guest.guestId, { moderation: "pending" });
    await addMedia(event.id, guest.guestId, { status: "hidden" });
    await addMedia(event.id, guest.guestId, { status: "pending" });

    const page = await listOk({ id: guest.userId }, event.public_code);
    expect(page.items.map((item) => item.mediaId)).toEqual([shown]);
    expect(page.total).toBe(1);
  });

  it("F-053: chaque miniature a une adresse signée lisible, un blurhash et ses dimensions", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    await addMedia(event.id, guest.guestId);

    const page = await listOk({ id: guest.userId }, event.public_code);
    const [item] = page.items;
    expect(item).toMatchObject({ kind: "photo", width: 1200, height: 800 });
    expect(item!.blurhash).toBe("L#Iqkc2owxX6tfW:jtfjdef7fQf7");
    const response = await fetch(item!.thumbUrl!);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`thumb-${item!.mediaId}`);
    expect(page.urlsValidSeconds).toBe(3600);
  });

  it("F-039: un autre invité de l'événement voit aussi la galerie", async () => {
    const { event } = await newEvent();
    const author = await newGuest(event.id);
    const viewer = await newGuest(event.id);
    await addMedia(event.id, author.guestId);
    expect((await listOk({ id: viewer.userId }, event.public_code)).items).toHaveLength(1);
  });

  it("F-039: sans session la galerie d'un événement est refusée", async () => {
    const { event } = await newEvent();
    expect(await list(null, event.public_code)).toMatchObject({ ok: false, status: 401 });
  });

  it("F-039, S-001: quelqu'un qui n'a pas participé à l'événement ne voit rien", async () => {
    const { event } = await newEvent();
    const author = await newGuest(event.id);
    await addMedia(event.id, author.guestId);
    const stranger = await newUser({ anonymous: true });
    expect(await list({ id: stranger }, event.public_code)).toMatchObject({
      ok: false,
      status: 403,
      code: "forbidden",
    });
  });

  it("F-039: un invité d'un autre événement ne voit pas celui-ci", async () => {
    const { event } = await newEvent();
    const other = await newEvent();
    const intruder = await newGuest(other.event.id);
    await addMedia(event.id, (await newGuest(event.id)).guestId);
    expect(await list({ id: intruder.userId }, event.public_code)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("F-072: un invité bloqué ne voit plus la galerie", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    await admin
      .from("guests")
      .update({ blocked_at: new Date().toISOString() })
      .eq("id", guest.guestId);
    expect(await list({ id: guest.userId }, event.public_code)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("F-015, F-039: si l'organisateur ferme la galerie, les invités la voient fermée mais lui la voit", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    await addMedia(event.id, guest.guestId);
    await admin
      .from("events")
      .update({ settings: { ...(event.settings as object), gallery_visible: false } })
      .eq("id", event.id);

    expect(await list({ id: guest.userId }, event.public_code)).toMatchObject({
      ok: false,
      status: 403,
      code: "gallery_closed",
    });
    expect((await listOk({ id: owner }, event.public_code)).items).toHaveLength(1);
  });

  it("F-039: un événement suspendu ou inconnu est introuvable", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    expect(await list({ id: guest.userId }, "2222222222")).toMatchObject({
      ok: false,
      status: 404,
    });
    await admin.from("events").update({ status: "suspended" }).eq("id", event.id);
    expect(await list({ id: guest.userId }, event.public_code)).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("F-050, F-052: pagination, tri et filtres", () => {
  it("F-050: on parcourt 25 médias en pages de 10 sans doublon ni oubli, total seulement en première page", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const base = Date.parse("2026-09-12T10:00:00Z");
    const ids: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      ids.push(
        await addMedia(event.id, guest.guestId, {
          takenAt: new Date(base + i * 60_000).toISOString(),
          withFiles: false,
        }),
      );
    }
    const user = { id: guest.userId };

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listOk(user, event.public_code, { limit: 10, cursor, order: "asc" });
      expect(page.total).toBe(cursor ? null : 25);
      seen.push(...page.items.map((item) => item.mediaId));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
  });

  it("F-050: un envoi qui arrive entre deux pages ne décale pas la suite", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const base = Date.parse("2026-09-12T10:00:00Z");
    for (let i = 0; i < 6; i += 1) {
      await addMedia(event.id, guest.guestId, {
        takenAt: new Date(base + i * 60_000).toISOString(),
        withFiles: false,
      });
    }
    const user = { id: guest.userId };
    const first = await listOk(user, event.public_code, { limit: 3 });
    // The newest photo arrives while the guest is reading: it is not on this page and does not move the next.
    await addMedia(event.id, guest.guestId, {
      takenAt: new Date(base + 99 * 60_000).toISOString(),
      withFiles: false,
    });
    const second = await listOk(user, event.public_code, { limit: 3, cursor: first.nextCursor! });
    const all = [...first.items, ...second.items].map((item) => item.mediaId);
    expect(new Set(all).size).toBe(6);
  });

  it("F-050: des médias de même date sont départagés sans en perdre ni en répéter", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const same = "2026-09-12T10:00:00Z";
    for (let i = 0; i < 12; i += 1) {
      await addMedia(event.id, guest.guestId, { takenAt: same, withFiles: false });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listOk({ id: guest.userId }, event.public_code, { limit: 5, cursor });
      seen.push(...page.items.map((item) => item.mediaId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("F-052: tri par date de prise de vue, dans les deux sens, une photo sans date prend la date d'envoi", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const old = await addMedia(event.id, guest.guestId, {
      takenAt: "2020-01-01T10:00:00Z",
      withFiles: false,
    });
    const recent = await addMedia(event.id, guest.guestId, {
      takenAt: "2026-09-12T10:00:00Z",
      withFiles: false,
    });
    // No taken date: sorted by its upload date, which is now (the most recent).
    const undated = await addMedia(event.id, guest.guestId, { takenAt: null, withFiles: false });
    const user = { id: guest.userId };

    const newest = await listOk(user, event.public_code, { sort: "taken", order: "desc" });
    expect(newest.items.map((i) => i.mediaId)).toEqual([undated, recent, old]);
    const oldest = await listOk(user, event.public_code, { sort: "taken", order: "asc" });
    expect(oldest.items.map((i) => i.mediaId)).toEqual([old, recent, undated]);
  });

  it("F-052: tri par date d'envoi, indépendamment de la date de prise de vue", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const first = await addMedia(event.id, guest.guestId, {
      takenAt: "2026-09-12T10:00:00Z",
      createdAt: "2026-10-01T10:00:00Z",
      withFiles: false,
    });
    const second = await addMedia(event.id, guest.guestId, {
      takenAt: "2020-01-01T10:00:00Z",
      createdAt: "2026-10-02T10:00:00Z",
      withFiles: false,
    });
    const user = { id: guest.userId };

    const sentNewest = await listOk(user, event.public_code, { sort: "sent", order: "desc" });
    expect(sentNewest.items.map((i) => i.mediaId)).toEqual([second, first]);
    const takenNewest = await listOk(user, event.public_code, { sort: "taken", order: "desc" });
    expect(takenNewest.items.map((i) => i.mediaId)).toEqual([first, second]);

    // The cursor of one order is also followed in pages for the other sort.
    const page = await listOk(user, event.public_code, { sort: "sent", order: "desc", limit: 1 });
    const next = await listOk(user, event.public_code, {
      sort: "sent",
      order: "desc",
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect([page.items[0]!.mediaId, next.items[0]!.mediaId]).toEqual([second, first]);
    expect(next.nextCursor).toBeNull();
  });

  it("F-052: filtre photos ou vidéos, et par invité, avec la liste des invités et leur nombre", async () => {
    const { event } = await newEvent();
    const anna = await newGuest(event.id, "Anna");
    const nameless = await newGuest(event.id);
    const photo1 = await addMedia(event.id, anna.guestId, { withFiles: false });
    const video = await addMedia(event.id, anna.guestId, { kind: "video", withFiles: false });
    const photo2 = await addMedia(event.id, nameless.guestId, { withFiles: false });
    await addMedia(event.id, nameless.guestId, { moderation: "pending", withFiles: false });
    const user = { id: anna.userId };

    const photos = await listOk(user, event.public_code, { kind: "photo" });
    expect(photos.items.map((i) => i.mediaId).sort()).toEqual([photo1, photo2].sort());
    expect(photos.total).toBe(2);
    const videos = await listOk(user, event.public_code, { kind: "video" });
    expect(videos.items.map((i) => i.mediaId)).toEqual([video]);

    const byAnna = await listOk(user, event.public_code, { guestId: anna.guestId });
    expect(byAnna.items.map((i) => i.mediaId).sort()).toEqual([photo1, video].sort());
    expect(byAnna.total).toBe(2);

    // The list of guests counts only what the gallery shows.
    expect(byAnna.guests).toEqual([
      { id: anna.guestId, name: "Anna", count: 2 },
      { id: nameless.guestId, name: null, count: 1 },
    ]);
    const second = await listOk(user, event.public_code, { limit: 1, cursor: undefined });
    expect(second.guests).toHaveLength(2);
    const later = await listOk(user, event.public_code, { limit: 1, cursor: second.nextCursor! });
    expect(later.guests).toEqual([]);
  });

  it("NF-043: un curseur forgé est refusé", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    expect(
      await list({ id: guest.userId }, event.public_code, { cursor: "pas-un-curseur" }),
    ).toMatchObject({ ok: false, status: 400, code: "validation_failed" });
    const forged = Buffer.from(JSON.stringify(["x),id.gt.0", randomUUID()])).toString("base64url");
    expect(await list({ id: guest.userId }, event.public_code, { cursor: forged })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("F-056: une photo envoyée deux fois n'apparaît qu'une fois dans la galerie", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const sha = randomBytes(32).toString("hex");
    const insert = (id: string) =>
      admin.from("media").insert({
        id,
        event_id: event.id,
        guest_id: guest.guestId,
        kind: "photo",
        status: "ready",
        sha256: sha,
        mime_type: "image/webp",
        bytes_display: 10,
        bytes_thumb: 10,
        key_thumb: `events/${event.id}/thumb/${id}.webp`,
        key_display: `events/${event.id}/display/${id}.webp`,
      });
    expect((await insert(randomUUID())).error).toBeNull();
    // The database itself refuses the second copy: exact duplicates cannot reach the gallery.
    expect((await insert(randomUUID())).error?.code).toBe("23505");
    expect((await listOk({ id: guest.userId }, event.public_code)).items).toHaveLength(1);
  });
});

describe("SPEC 9.1: adresses signées de lecture", () => {
  it("SPEC 9.1: renouvelle les miniatures demandées, et seulement celles que la galerie montre", async () => {
    const { event } = await newEvent();
    const other = await newEvent();
    const guest = await newGuest(event.id);
    const shown = await addMedia(event.id, guest.guestId);
    const pending = await addMedia(event.id, guest.guestId, { moderation: "pending" });
    const foreign = await addMedia(other.event.id, (await newGuest(other.event.id)).guestId);

    const result = await gallery(
      deps,
      { id: guest.userId },
      request({
        action: "thumbs",
        access: eventAccess(event.public_code),
        mediaIds: [shown, pending, foreign],
      }),
    );
    if (!result.ok || result.body.action !== "thumbs") throw new Error("refused");
    expect(result.body.urls.map((entry) => entry.mediaId)).toEqual([shown]);
    expect((await fetch(result.body.urls[0]!.thumbUrl!)).status).toBe(200);
  });

  it("F-051: une photo donne son affichage et un téléchargement nommé d'après l'événement", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const photo = await addMedia(event.id, guest.guestId);

    const result = await gallery(
      deps,
      { id: guest.userId },
      request({ action: "files", access: eventAccess(event.public_code), mediaIds: [photo] }),
    );
    if (!result.ok || result.body.action !== "files") throw new Error("refused");
    const [file] = result.body.files;
    expect(file).toMatchObject({ mediaId: photo, videoUrl: null });
    expect(await (await fetch(file!.displayUrl!)).text()).toBe(`display-${photo}`);
    const download = await fetch(file!.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      `attachment; filename="mariage-de-lea-et-tom-${photo.slice(0, 8)}.webp"`,
    );
  });

  it("F-051: une vidéo donne le fichier à lire et à télécharger, jamais un média caché", async () => {
    const { event } = await newEvent();
    const guest = await newGuest(event.id);
    const video = await addMedia(event.id, guest.guestId, { kind: "video" });
    const hidden = await addMedia(event.id, guest.guestId, { status: "hidden" });

    const result = await gallery(
      deps,
      { id: guest.userId },
      request({
        action: "files",
        access: eventAccess(event.public_code),
        mediaIds: [video, hidden],
      }),
    );
    if (!result.ok || result.body.action !== "files") throw new Error("refused");
    expect(result.body.files).toHaveLength(1);
    const [file] = result.body.files;
    expect(file).toMatchObject({ mediaId: video, displayUrl: null });
    expect(await (await fetch(file!.videoUrl!)).text()).toBe(`video-${video}`);
    expect((await fetch(file!.downloadUrl)).headers.get("content-disposition")).toContain(".mp4");
  });
});

describe("F-054: lien de partage en lecture seule", () => {
  const shareAccess = (token: string) => ({ type: "share" as const, token });

  it("F-054: le propriétaire crée un lien, le titulaire voit les médias approuvés sans session ni noms", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id, "Anna");
    const shown = await addMedia(event.id, guest.guestId);
    await addMedia(event.id, guest.guestId, { moderation: "pending" });

    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");
    expect(created.link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const result = await gallery(
      deps,
      null,
      request({ action: "list", access: shareAccess(created.link.token) }),
    );
    if (!result.ok || result.body.action !== "list") throw new Error("refused");
    expect(result.body.items.map((item) => item.mediaId)).toEqual([shown]);
    expect(result.body.guests).toEqual([]);
    expect(JSON.stringify(result.body)).not.toContain("Anna");

    // The filter by guest is ignored on a link: it cannot be used to tell guests apart.
    const filtered = await gallery(
      deps,
      null,
      request({ action: "list", access: shareAccess(created.link.token), guestId: randomUUID() }),
    );
    if (!filtered.ok || filtered.body.action !== "list") throw new Error("refused");
    expect(filtered.body.items).toHaveLength(1);
  });

  it("F-054: le lien fonctionne même si l'organisateur a fermé la galerie aux invités", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    await addMedia(event.id, guest.guestId);
    await admin
      .from("events")
      .update({ settings: { ...(event.settings as object), gallery_visible: false } })
      .eq("id", event.id);
    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");
    const result = await gallery(
      deps,
      null,
      request({ action: "list", access: shareAccess(created.link.token) }),
    );
    expect(result.ok).toBe(true);
  });

  it("F-054: révoquer le lien le fait cesser de fonctionner aussitôt", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    await addMedia(event.id, guest.guestId);
    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");
    const ask = () =>
      gallery(deps, null, request({ action: "list", access: shareAccess(created.link.token) }));
    expect((await ask()).ok).toBe(true);

    expect(await revokeShareLink(admin, owner, event.id, created.link.id)).toBe(true);
    expect(await ask()).toMatchObject({ ok: false, status: 404, code: "not_found" });
    // Revoking again is harmless, and the revoked link stays listed as a record.
    expect(await revokeShareLink(admin, owner, event.id, created.link.id)).toBe(true);
    const links = await listShareLinks(admin, owner, event.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.revokedAt).not.toBeNull();
  });

  it("F-054: un jeton inconnu ou le lien d'un événement suspendu est introuvable", async () => {
    const { event, owner } = await newEvent();
    expect(
      await gallery(deps, null, request({ action: "list", access: shareAccess("a".repeat(32)) })),
    ).toMatchObject({ ok: false, status: 404 });

    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");
    await admin.from("events").update({ status: "suspended" }).eq("id", event.id);
    expect(
      await gallery(
        deps,
        null,
        request({ action: "list", access: shareAccess(created.link.token) }),
      ),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("F-054: un lien donne aussi les fichiers du visionneur, mais seulement de son événement", async () => {
    const { event, owner } = await newEvent();
    const other = await newEvent();
    const guest = await newGuest(event.id);
    const mine = await addMedia(event.id, guest.guestId);
    const foreign = await addMedia(other.event.id, (await newGuest(other.event.id)).guestId);
    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");

    const result = await gallery(
      deps,
      null,
      request({
        action: "files",
        access: shareAccess(created.link.token),
        mediaIds: [mine, foreign],
      }),
    );
    if (!result.ok || result.body.action !== "files") throw new Error("refused");
    expect(result.body.files.map((file) => file.mediaId)).toEqual([mine]);
  });

  it("S-001: un autre organisateur ne peut ni créer, ni lister, ni révoquer les liens d'un événement", async () => {
    const { event, owner } = await newEvent();
    const stranger = await newUser();
    expect(await createShareLink(admin, stranger, event.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    const created = await createShareLink(admin, owner, event.id);
    if (!created.ok) throw new Error("not created");
    expect(await listShareLinks(admin, stranger, event.id)).toEqual([]);
    expect(await revokeShareLink(admin, stranger, event.id, created.link.id)).toBe(false);
    expect((await listShareLinks(admin, owner, event.id))[0]!.revokedAt).toBeNull();
  });

  it("F-054: le nombre de liens actifs est limité, un lien révoqué libère une place", async () => {
    const { event, owner } = await newEvent();
    const links = [];
    for (let i = 0; i < MAX_ACTIVE_SHARE_LINKS; i += 1) {
      const created = await createShareLink(admin, owner, event.id);
      if (!created.ok) throw new Error("not created");
      links.push(created.link);
    }
    expect(await createShareLink(admin, owner, event.id)).toEqual({
      ok: false,
      reason: "too_many",
    });
    await revokeShareLink(admin, owner, event.id, links[0]!.id);
    expect((await createShareLink(admin, owner, event.id)).ok).toBe(true);
  });
});
