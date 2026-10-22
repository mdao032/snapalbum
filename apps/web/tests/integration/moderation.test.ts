import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { createEvent } from "@/server/events";
import { resolveGalleryAccess } from "@/server/gallery";
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
import { createStorage, type Storage } from "@/server/storage";

/**
 * Moderation against the real local database and a local S3 emulator (F-070 to F-073): the state
 * of each action, the files removed, the quota freed, the reports, the audit log, the lists.
 * Needs `pnpm db:start` and `pnpm storage:start`.
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
const bucket = `snapalbum-moderation-${randomUUID().slice(0, 8)}`;
const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

let storage: Storage;
let deps: ModerationDeps;
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
    email: `mod-${randomUUID()}@example.test`,
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

interface MediaOptions {
  status?: "ready" | "hidden";
  moderation?: "approved" | "pending" | "rejected";
  createdAt?: string;
}

/** A media with its three files in the storage, as an upload leaves it. */
async function addMedia(eventId: string, guestId: string, options: MediaOptions = {}) {
  const id = randomUUID();
  const prefix = `events/${eventId}`;
  const keys = {
    key_thumb: `${prefix}/thumb/${id}.webp`,
    key_display: `${prefix}/display/${id}.webp`,
    key_original: `${prefix}/original/${id}.jpg`,
  };
  for (const key of Object.values(keys)) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: `file-${key}` }));
  }
  const { error } = await admin.from("media").insert({
    id,
    event_id: eventId,
    guest_id: guestId,
    kind: "photo",
    status: options.status ?? "ready",
    moderation: options.moderation ?? "approved",
    sha256: randomBytes(32).toString("hex"),
    mime_type: "image/jpeg",
    bytes_original: 100,
    bytes_display: 50,
    bytes_thumb: 10,
    ...(options.createdAt ? { created_at: options.createdAt } : {}),
    ...keys,
  });
  if (error) throw error;
  return { id, keys };
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const rowOf = async (id: string) =>
  (await admin.from("media").select("status, moderation").eq("id", id).single()).data;

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

describe("F-070, F-071: actions sur les médias", () => {
  it("F-070: masquer retire le média de l'album, rétablir le remet", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    const shown = await addMedia(event.id, guest.guestId);
    const access = { type: "event" as const, eventCode: event.public_code };

    expect(await moderateMedia(deps, owner, event.id, "hide", [shown.id])).toEqual({
      ok: true,
      body: { changed: 1 },
    });
    expect((await rowOf(shown.id))?.status).toBe("hidden");
    // The album shows approved, ready media only: the hidden one is out of reach.
    const { data } = await admin
      .from("media")
      .select("id")
      .eq("event_id", event.id)
      .eq("status", "ready");
    expect(data).toEqual([]);
    expect(await resolveGalleryAccess(admin, { id: guest.userId }, access)).toMatchObject({
      ok: true,
    });

    expect((await moderateMedia(deps, owner, event.id, "restore", [shown.id])).ok).toBe(true);
    expect((await rowOf(shown.id))?.status).toBe("ready");
    // The files stay while hidden.
    expect(await exists(shown.keys.key_thumb)).toBe(true);
  });

  it("F-071: approuver un média en attente le rend visible, refuser le garde de côté (réversible)", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    const a = await addMedia(event.id, guest.guestId, { moderation: "pending" });
    const b = await addMedia(event.id, guest.guestId, { moderation: "pending" });

    expect(await moderateMedia(deps, owner, event.id, "approve", [a.id])).toMatchObject({
      body: { changed: 1 },
    });
    expect((await rowOf(a.id))?.moderation).toBe("approved");

    expect(await moderateMedia(deps, owner, event.id, "reject", [b.id])).toMatchObject({
      body: { changed: 1 },
    });
    expect((await rowOf(b.id))?.moderation).toBe("rejected");
    expect(await exists(b.keys.key_thumb)).toBe(true);
    // A refused photo can still be approved later.
    expect(await moderateMedia(deps, owner, event.id, "approve", [b.id])).toMatchObject({
      body: { changed: 1 },
    });
  });

  it("F-070: chaque action ne touche que les médias dans l'état voulu, et dit combien ont changé", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    const visible = await addMedia(event.id, guest.guestId);
    const hidden = await addMedia(event.id, guest.guestId, { status: "hidden" });

    // Restoring a visible one and refusing an approved one do nothing; hiding twice is harmless.
    expect(await moderateMedia(deps, owner, event.id, "restore", [visible.id])).toMatchObject({
      body: { changed: 0 },
    });
    expect(await moderateMedia(deps, owner, event.id, "reject", [visible.id])).toMatchObject({
      body: { changed: 0 },
    });
    expect(
      await moderateMedia(deps, owner, event.id, "hide", [visible.id, hidden.id]),
    ).toMatchObject({
      body: { changed: 1 },
    });
    expect(await moderateMedia(deps, owner, event.id, "hide", [visible.id])).toMatchObject({
      body: { changed: 0 },
    });
  });

  it("F-070: supprimer efface les fichiers, libère la place du quota et le journal s'en souvient", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    const first = await addMedia(event.id, guest.guestId);
    const second = await addMedia(event.id, guest.guestId);
    const before = (
      await admin.from("events").select("media_count, bytes_used").eq("id", event.id).single()
    ).data;
    expect(before?.media_count).toBe(2);

    const result = await moderateMedia(deps, owner, event.id, "delete", [first.id, second.id]);
    expect(result).toEqual({ ok: true, body: { changed: 2 } });
    for (const media of [first, second]) {
      expect((await rowOf(media.id))?.status).toBe("deleted");
      for (const key of Object.values(media.keys)) expect(await exists(key)).toBe(false);
    }
    const after = (
      await admin.from("events").select("media_count, bytes_used").eq("id", event.id).single()
    ).data;
    expect(after).toEqual({ media_count: 0, bytes_used: 0 });

    const { data: log } = await admin
      .from("audit_log")
      .select("actor_id, action, target_type, target_id, metadata")
      .eq("target_id", event.id);
    expect(log).toEqual([
      {
        actor_id: owner,
        action: "media.delete",
        target_type: "event",
        target_id: event.id,
        metadata: expect.objectContaining({ count: 2 }),
      },
    ]);
  });

  it("S-001: un autre organisateur ne peut rien faire sur cet événement, ni sur des identifiants qui n'y sont pas", async () => {
    const { event } = await newEvent();
    const other = await newEvent();
    const guest = await newGuest(event.id);
    const media = await addMedia(event.id, guest.guestId);
    const stranger = await newUser();

    expect(await moderateMedia(deps, stranger, event.id, "delete", [media.id])).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
    // The owner of ANOTHER event cannot reach this media through their own event id either.
    expect(
      await moderateMedia(deps, other.owner, other.event.id, "delete", [media.id]),
    ).toMatchObject({
      body: { changed: 0 },
    });
    expect((await rowOf(media.id))?.status).toBe("ready");
    expect(await exists(media.keys.key_thumb)).toBe(true);
    expect(await listModeration(deps, stranger, event.id, { filter: "visible" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("NF-043: un lot vide ou trop grand est refusé", async () => {
    const { event, owner } = await newEvent();
    expect(await moderateMedia(deps, owner, event.id, "hide", [])).toMatchObject({
      ok: false,
      status: 400,
    });
    const many = Array.from({ length: 201 }, () => randomUUID());
    expect(await moderateMedia(deps, owner, event.id, "hide", many)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("F-070, F-071: les listes de la modération", () => {
  it("F-071: chaque liste montre les médias de son état, les compteurs suivent", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id, "Anna");
    const pending = await addMedia(event.id, guest.guestId, { moderation: "pending" });
    const visible = await addMedia(event.id, guest.guestId);
    const hidden = await addMedia(event.id, guest.guestId, { status: "hidden" });
    const refused = await addMedia(event.id, guest.guestId, { moderation: "rejected" });

    const ids = async (filter: "pending" | "visible" | "hidden" | "refused" | "reported") => {
      const result = await listModeration(deps, owner, event.id, { filter });
      if (!result.ok) throw new Error("refused");
      return result.body.items.map((item) => item.mediaId);
    };
    expect(await ids("pending")).toEqual([pending.id]);
    expect(await ids("visible")).toEqual([visible.id]);
    expect(await ids("hidden")).toEqual([hidden.id]);
    expect(await ids("refused")).toEqual([refused.id]);
    expect(await ids("reported")).toEqual([]);
    expect(await moderationCounts(admin, event.id)).toEqual({
      pending: 1,
      visible: 1,
      hidden: 1,
      refused: 1,
      reported: 0,
    });
  });

  it("F-070: la liste se parcourt par pages sans doublon, avec le nom de l'invité et des miniatures lisibles", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id, "Anna");
    const base = Date.parse("2026-10-01T10:00:00Z");
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(
        (
          await addMedia(event.id, guest.guestId, {
            createdAt: new Date(base + i * 60_000).toISOString(),
          })
        ).id,
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await listModeration(deps, owner, event.id, {
        filter: "visible",
        cursor,
        limit: 2,
      });
      if (!result.ok) throw new Error("refused");
      if (pages === 0) {
        expect(result.body.guests).toEqual([
          { id: guest.guestId, name: "Anna", count: 5, blocked: false },
        ]);
        expect(result.body.items[0]!.guestName).toBe("Anna");
        expect((await fetch(result.body.items[0]!.thumbUrl!)).status).toBe(200);
      } else {
        expect(result.body.guests).toEqual([]);
      }
      seen.push(...result.body.items.map((item) => item.mediaId));
      cursor = result.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...created].reverse());
  });

  it("F-071: l'organisateur voit l'image d'un média masqué pour l'examiner, pas celle d'un autre événement", async () => {
    const { event, owner } = await newEvent();
    const other = await newEvent();
    const guest = await newGuest(event.id);
    const hidden = await addMedia(event.id, guest.guestId, { status: "hidden" });

    const file = await moderationFile(deps, owner, event.id, hidden.id);
    if (!file.ok) throw new Error("refused");
    expect(await (await fetch(file.body.url!)).text()).toBe(`file-${hidden.keys.key_display}`);
    expect(await moderationFile(deps, other.owner, other.event.id, hidden.id)).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("F-072: bloquer un invité", () => {
  it("F-072: l'invité bloqué perd l'accès à l'album, le débloquer le lui rend, tout est journalisé", async () => {
    const { event, owner } = await newEvent();
    const guest = await newGuest(event.id);
    const access = { type: "event" as const, eventCode: event.public_code };
    expect(await resolveGalleryAccess(admin, { id: guest.userId }, access)).toMatchObject({
      ok: true,
    });

    expect(await setGuestBlocked(deps, owner, event.id, guest.guestId, true)).toEqual({
      ok: true,
      body: { blocked: true },
    });
    const { data } = await admin
      .from("guests")
      .select("blocked_at")
      .eq("id", guest.guestId)
      .single();
    expect(data?.blocked_at).not.toBeNull();
    expect(await resolveGalleryAccess(admin, { id: guest.userId }, access)).toMatchObject({
      ok: false,
    });

    await setGuestBlocked(deps, owner, event.id, guest.guestId, false);
    expect(await resolveGalleryAccess(admin, { id: guest.userId }, access)).toMatchObject({
      ok: true,
    });
    const { data: log } = await admin.from("audit_log").select("action").eq("target_id", event.id);
    expect((log ?? []).map((row) => row.action).sort()).toEqual(["guest.block", "guest.unblock"]);
  });

  it("F-072, S-001: on ne bloque que les invités de son événement", async () => {
    const { event } = await newEvent();
    const other = await newEvent();
    const guest = await newGuest(event.id);
    expect(
      await setGuestBlocked(deps, other.owner, other.event.id, guest.guestId, true),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    const stranger = await newUser();
    expect(await setGuestBlocked(deps, stranger, event.id, guest.guestId, true)).toMatchObject({
      ok: false,
      status: 404,
    });
    const { data } = await admin
      .from("guests")
      .select("blocked_at")
      .eq("id", guest.guestId)
      .single();
    expect(data?.blocked_at).toBeNull();
  });
});

describe("F-073: signalements", () => {
  const salt = "test-salt";

  it("F-073: un signalement compte une fois par personne, apparaît dans « signalées » et se règle", async () => {
    const { event, owner } = await newEvent();
    const author = await newGuest(event.id);
    const media = await addMedia(event.id, author.guestId);
    const alice = reporterFingerprint(salt, { userId: randomUUID() });
    const bob = reporterFingerprint(salt, { ip: "203.0.113.9" });

    expect(await reportMedia(admin, event.id, alice, media.id, "inappropriate")).toEqual({
      ok: true,
      body: { ok: true },
    });
    // The same person again (even with another reason) is accepted and counted once.
    expect((await reportMedia(admin, event.id, alice, media.id, "private")).ok).toBe(true);
    await reportMedia(admin, event.id, bob, media.id, "other");

    const list = await listModeration(deps, owner, event.id, { filter: "reported" });
    if (!list.ok) throw new Error("refused");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ mediaId: media.id, reports: 2 });
    expect(list.body.counts.reported).toBe(1);

    expect(await dismissReports(deps, owner, event.id, [media.id])).toEqual({
      ok: true,
      body: { changed: 2 },
    });
    expect((await moderationCounts(admin, event.id)).reported).toBe(0);
    // Dismissing did not touch the photo.
    expect((await rowOf(media.id))?.status).toBe("ready");
  });

  it("F-073: masquer ou supprimer une photo signalée règle ses signalements", async () => {
    const { event, owner } = await newEvent();
    const author = await newGuest(event.id);
    const toHide = await addMedia(event.id, author.guestId);
    const toDelete = await addMedia(event.id, author.guestId);
    await reportMedia(
      admin,
      event.id,
      reporterFingerprint(salt, { ip: "1.1.1.1" }),
      toHide.id,
      "other",
    );
    await reportMedia(
      admin,
      event.id,
      reporterFingerprint(salt, { ip: "1.1.1.1" }),
      toDelete.id,
      "other",
    );
    expect((await moderationCounts(admin, event.id)).reported).toBe(2);

    await moderateMedia(deps, owner, event.id, "hide", [toHide.id]);
    await moderateMedia(deps, owner, event.id, "delete", [toDelete.id]);
    expect((await moderationCounts(admin, event.id)).reported).toBe(0);
    const { data } = await admin
      .from("reports")
      .select("resolved_at")
      .in("media_id", [toHide.id, toDelete.id]);
    expect((data ?? []).every((row) => row.resolved_at !== null)).toBe(true);
  });

  it("F-073: on ne signale que ce que l'album montre : ni un média masqué, ni en attente, ni d'un autre événement", async () => {
    const { event } = await newEvent();
    const other = await newEvent();
    const author = await newGuest(event.id);
    const hidden = await addMedia(event.id, author.guestId, { status: "hidden" });
    const pending = await addMedia(event.id, author.guestId, { moderation: "pending" });
    const foreign = await addMedia(other.event.id, (await newGuest(other.event.id)).guestId);
    const who = reporterFingerprint(salt, { ip: "2.2.2.2" });

    for (const media of [hidden, pending, foreign]) {
      expect(await reportMedia(admin, event.id, who, media.id, "other")).toMatchObject({
        ok: false,
        status: 404,
      });
    }
  });

  it("F-073: l'empreinte ne contient ni l'adresse ni l'identifiant, et change avec le sel", () => {
    const a = reporterFingerprint("sel-1", { ip: "203.0.113.9" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(reporterFingerprint("sel-2", { ip: "203.0.113.9" })).not.toBe(a);
    expect(reporterFingerprint("sel-1", { userId: "u1" })).not.toBe(
      reporterFingerprint("sel-1", { ip: "u1" }),
    );
  });
});
