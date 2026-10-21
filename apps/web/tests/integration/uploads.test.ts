import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { createEvent } from "@/server/events";
import { createStorage, type Storage } from "@/server/storage";
import { completeUpload, multipartAction, reserveUpload, type UploadDeps } from "@/server/uploads";

/**
 * The whole upload pipeline against the real local database (Supabase) and a local S3 emulator:
 * reservation by the Postgres function, signed addresses, direct upload, confirmation checks.
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
const bucket = `snapalbum-uploads-${randomUUID().slice(0, 8)}`;
const MB = 1024 * 1024;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

let storage: Storage;
let deps: UploadDeps;
const createdUsers: string[] = [];
const createdEvents: string[] = [];

const WEBP = (size: number) => {
  const bytes = new Uint8Array(size).fill(1);
  bytes.set([
    ...Array.from("RIFF", (c) => c.charCodeAt(0)),
    1,
    2,
    3,
    4,
    ...Array.from("WEBP", (c) => c.charCodeAt(0)),
  ]);
  return bytes;
};
const JPEG = (size: number) => {
  const bytes = new Uint8Array(size).fill(2);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
const MP4 = (size: number) => {
  const bytes = new Uint8Array(size).fill(3);
  bytes.set([0, 0, 0, 24, ...Array.from("ftypisom", (c) => c.charCodeAt(0))]);
  return bytes;
};
const HTML = (size: number) => {
  const bytes = new Uint8Array(size).fill(32);
  bytes.set(Array.from("<html><script>alert(1)</script>", (c) => c.charCodeAt(0)));
  return bytes;
};

async function put(target: { url: string; headers: Record<string, string> }, body: Uint8Array) {
  const response = await fetch(target.url, {
    method: "PUT",
    headers: target.headers,
    body: new Blob([body as BlobPart]),
  });
  expect(response.status).toBe(200);
  return response;
}

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
    email: `up-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

/** An event with its own organiser: an organiser may only have one active free event. */
async function newEvent() {
  const today = new Date().toISOString().slice(0, 10);
  const created = await createEvent(admin, await newUser(), {
    title: "Mariage de Léa et Tom",
    eventDate: today,
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return created.event;
}

async function newGuest(eventId: string, overrides: Record<string, unknown> = {}) {
  const userId = await newUser({ anonymous: true });
  const { error } = await admin.from("guests").insert({
    event_id: eventId,
    auth_user_id: userId,
    terms_accepted_at: new Date().toISOString(),
    ...overrides,
  });
  if (error) throw error;
  return userId;
}

const request = (eventCode: string, change: Record<string, unknown> = {}) => ({
  eventCode,
  kind: "photo" as const,
  sha256: randomBytes(32).toString("hex"),
  mimeType: "image/jpeg",
  extension: "jpg" as const,
  bytes: 3 * MB,
  displayBytes: 4000,
  thumbBytes: 800,
  previewFormat: "webp" as const,
  width: 4000,
  height: 3000,
  ...change,
});

async function counters(eventId: string) {
  const { data } = await admin
    .from("events")
    .select("media_count, bytes_used")
    .eq("id", eventId)
    .single();
  return { count: data?.media_count, bytes: data?.bytes_used };
}

async function reserveOk(user: string, input: ReturnType<typeof request>) {
  const result = await reserveUpload(deps, { id: user }, input as never);
  if (!result.ok || result.body.status !== "reserved")
    throw new Error(`not reserved: ${JSON.stringify(result)}`);
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

describe("SPEC 8.1: envoi d'une photo, de bout en bout", () => {
  it("réserve, envoie directement, confirme : le média est prêt et les compteurs exacts", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const body = request(event.public_code);

    const reserved = await reserveOk(user, body);
    expect(reserved.original).toBeNull();
    await put(reserved.display!, WEBP(4000));
    await put(reserved.thumb, WEBP(800));

    const done = await completeUpload(deps, { id: user }, reserved.mediaId);
    expect(done).toEqual({ ok: true, body: { mediaId: reserved.mediaId, status: "ready" } });

    const { data } = await admin
      .from("media")
      .select("status, key_original, bytes_display")
      .eq("id", reserved.mediaId)
      .single();
    expect(data).toEqual({ status: "ready", key_original: null, bytes_display: 4000 });
    expect(await counters(event.id)).toEqual({ count: 1, bytes: 4800 });
  }, 60_000);

  it("NF-012: renvoyer le même fichier ne prend aucune place", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const body = request(event.public_code);
    const reserved = await reserveOk(user, body);
    await put(reserved.display!, WEBP(4000));
    await put(reserved.thumb, WEBP(800));
    await completeUpload(deps, { id: user }, reserved.mediaId);

    const again = await reserveUpload(deps, { id: user }, body as never);
    expect(again).toEqual({
      ok: true,
      body: { status: "already_received", mediaId: reserved.mediaId },
    });
    expect((await counters(event.id)).count).toBe(1);
  }, 60_000);

  it("NF-010: la confirmation d'un envoi inachevé n'abîme rien : on envoie le reste puis on confirme", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const reserved = await reserveOk(user, request(event.public_code));

    await put(reserved.thumb, WEBP(800));
    expect(await completeUpload(deps, { id: user }, reserved.mediaId)).toMatchObject({
      ok: false,
      code: "upload_incomplete",
    });
    expect((await counters(event.id)).count).toBe(1);

    await put(reserved.display!, WEBP(4000));
    expect(await completeUpload(deps, { id: user }, reserved.mediaId)).toMatchObject({ ok: true });
  }, 60_000);

  it("NF-012: reprendre une réservation inachevée redonne de nouvelles adresses pour le même média", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const body = request(event.public_code);
    const first = await reserveOk(user, body);
    const second = await reserveOk(user, body);
    expect(second.mediaId).toBe(first.mediaId);
    expect((await counters(event.id)).count).toBe(1);
  }, 60_000);

  it("S-002: un fichier qui n'est pas une image est supprimé à la confirmation, et sa place libérée", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const reserved = await reserveOk(user, request(event.public_code));
    await put(reserved.display!, HTML(4000));
    await put(reserved.thumb, WEBP(800));

    expect(await completeUpload(deps, { id: user }, reserved.mediaId)).toEqual({
      ok: false,
      status: 422,
      code: "invalid_file",
    });
    const { data } = await admin.from("media").select("id").eq("id", reserved.mediaId);
    expect(data).toEqual([]);
    expect(await counters(event.id)).toEqual({ count: 0, bytes: 0 });
    expect(await storage.head(`events/${event.id}/display/${reserved.mediaId}.webp`)).toBeNull();
  }, 60_000);

  it("S-001: seul l'invité qui a réservé peut confirmer son média", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const other = await newGuest(event.id);
    const reserved = await reserveOk(user, request(event.public_code));
    await put(reserved.display!, WEBP(4000));
    await put(reserved.thumb, WEBP(800));
    expect(await completeUpload(deps, { id: other }, reserved.mediaId)).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
  }, 60_000);
});

describe("SPEC 7.1: refus à la réservation, avec la vraie base", () => {
  it("R1: un album plein refuse la photo suivante sans rien changer", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    await admin.from("events").update({ media_count: 200 }).eq("id", event.id);
    expect(await reserveUpload(deps, { id: user }, request(event.public_code) as never)).toEqual({
      ok: false,
      status: 409,
      code: "album_full",
    });
    expect((await counters(event.id)).count).toBe(200);
  });

  it("F-016: hors de la période d'envoi, la réservation est refusée", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const past = {
      gallery_visible: true,
      require_approval: false,
      upload_opens_at: "2020-01-01T00:00:00.000Z",
      upload_closes_at: "2020-02-01T00:00:00.000Z",
    };
    await admin.from("events").update({ settings: past }).eq("id", event.id);
    expect(await reserveUpload(deps, { id: user }, request(event.public_code) as never)).toEqual({
      ok: false,
      status: 403,
      code: "upload_window_closed",
    });
  });

  it("F-035: quelqu'un qui n'est pas invité, un invité bloqué ou sans conditions acceptées sont refusés", async () => {
    const event = await newEvent();
    const stranger = await newUser({ anonymous: true });
    expect(
      await reserveUpload(deps, { id: stranger }, request(event.public_code) as never),
    ).toMatchObject({ code: "forbidden" });

    const blocked = await newGuest(event.id, { blocked_at: new Date().toISOString() });
    expect(
      await reserveUpload(deps, { id: blocked }, request(event.public_code) as never),
    ).toMatchObject({ code: "guest_blocked" });

    const noTerms = await newGuest(event.id, { terms_accepted_at: null });
    expect(
      await reserveUpload(deps, { id: noTerms }, request(event.public_code) as never),
    ).toMatchObject({ code: "terms_required" });
  });

  it("F-043: un événement en suppression n'accepte plus d'envoi", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    await admin
      .from("events")
      .update({ status: "pending_deletion", deleted_at: new Date().toISOString() })
      .eq("id", event.id);
    expect(
      await reserveUpload(deps, { id: user }, request(event.public_code) as never),
    ).toMatchObject({
      status: 403,
      code: "event_suspended",
    });
  });

  it("un code d'événement inconnu est introuvable", async () => {
    const user = await newUser({ anonymous: true });
    expect(await reserveUpload(deps, { id: user }, request("zzzzzzzzzz") as never)).toMatchObject({
      status: 404,
    });
  });

  it("F-071: la validation préalable place l'envoi en attente de modération", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const settings = {
      gallery_visible: true,
      require_approval: true,
      upload_opens_at: new Date(Date.now() - 86_400_000).toISOString(),
      upload_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    await admin.from("events").update({ settings }).eq("id", event.id);
    const reserved = await reserveOk(user, request(event.public_code));
    await put(reserved.display!, JPEG(4000));
    await put(reserved.thumb, WEBP(800));
    expect(await completeUpload(deps, { id: user }, reserved.mediaId)).toMatchObject({
      ok: true,
      body: { status: "pending_moderation" },
    });
  }, 60_000);
});

describe("NF-013: vidéo de plus de 50 Mo en morceaux, de bout en bout", () => {
  const VIDEO_BYTES = 55 * MB;

  it("envoie 6 morceaux, reprend après une coupure, assemble puis confirme", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const reserved = await reserveOk(
      user,
      request(event.public_code, {
        kind: "video",
        mimeType: "video/mp4",
        extension: "mp4",
        bytes: VIDEO_BYTES,
        displayBytes: undefined,
        durationSeconds: 20,
      }),
    );
    expect(reserved.original).toBeNull();
    expect(reserved.multipart).toEqual({ partSize: 10 * MB, partCount: 6 });
    expect(reserved.display).toBeNull();

    const call = (action: "create" | "status" | "complete" | "abort") =>
      multipartAction(deps, { id: user }, { action, mediaId: reserved.mediaId });
    expect(await call("create")).toMatchObject({ ok: true, body: { partCount: 6 } });

    const video = MP4(VIDEO_BYTES);
    const sendPart = async (partNumber: number) => {
      const signed = await multipartAction(
        deps,
        { id: user },
        { action: "part", mediaId: reserved.mediaId, partNumber },
      );
      if (!signed.ok || signed.body.action !== "part") throw new Error("part not signed");
      const start = (partNumber - 1) * 10 * MB;
      await put(signed.body.target, video.subarray(start, Math.min(start + 10 * MB, VIDEO_BYTES)));
    };

    // First attempt: two parts, then the connection drops.
    await sendPart(1);
    await sendPart(2);
    // Back online: the server says what it has, the browser sends the rest.
    const status = await call("status");
    expect(status).toEqual({
      ok: true,
      body: {
        action: "status",
        parts: [
          { partNumber: 1, size: 10 * MB },
          { partNumber: 2, size: 10 * MB },
        ],
      },
    });
    expect(await call("complete")).toMatchObject({ ok: false, code: "upload_incomplete" });
    for (const part of [3, 4, 5, 6]) await sendPart(part);

    expect(await call("complete")).toEqual({ ok: true, body: { action: "complete" } });
    await put(reserved.thumb, WEBP(800));
    expect(await completeUpload(deps, { id: user }, reserved.mediaId)).toMatchObject({
      ok: true,
      body: { status: "ready" },
    });
    expect((await storage.head(`events/${event.id}/original/${reserved.mediaId}.mp4`))?.size).toBe(
      VIDEO_BYTES,
    );
    expect((await counters(event.id)).count).toBe(1);
  }, 180_000);

  it("annuler l'envoi libère ce qui avait été reçu, et on peut recommencer", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const reserved = await reserveOk(
      user,
      request(event.public_code, {
        kind: "video",
        mimeType: "video/mp4",
        extension: "mp4",
        bytes: VIDEO_BYTES,
        displayBytes: undefined,
        durationSeconds: 20,
      }),
    );
    const call = (action: "create" | "abort") =>
      multipartAction(deps, { id: user }, { action, mediaId: reserved.mediaId });
    await call("create");
    const signed = await multipartAction(
      deps,
      { id: user },
      { action: "part", mediaId: reserved.mediaId, partNumber: 1 },
    );
    if (!signed.ok || signed.body.action !== "part") throw new Error("part not signed");
    await put(signed.body.target, MP4(10 * MB));

    expect(await call("abort")).toEqual({ ok: true, body: { action: "abort" } });
    const { data } = await admin.from("uploads").select("id").eq("media_id", reserved.mediaId);
    expect(data).toEqual([]);
    // Nothing is left to continue: a part now needs a fresh start.
    expect(
      await multipartAction(
        deps,
        { id: user },
        { action: "part", mediaId: reserved.mediaId, partNumber: 2 },
      ),
    ).toMatchObject({ ok: false, code: "upload_incomplete" });
    expect(await call("create")).toMatchObject({ ok: true });
  }, 120_000);

  it("R1: une vidéo trop longue pour l'offre est refusée avant toute réservation", async () => {
    const event = await newEvent();
    const user = await newGuest(event.id);
    const result = await reserveUpload(
      deps,
      { id: user },
      request(event.public_code, {
        kind: "video",
        mimeType: "video/mp4",
        extension: "mp4",
        bytes: 20 * MB,
        displayBytes: undefined,
        durationSeconds: 45,
      }) as never,
    );
    expect(result).toMatchObject({ ok: false, code: "video_too_long" });
    expect((await counters(event.id)).count).toBe(0);
  });
});
