import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { PLAN_PAGE_SIZE, planAlbum, signAlbumFiles, type DownloadDeps } from "@/server/download";
import { createEvent } from "@/server/events";
import { createStorage, type Storage } from "@/server/storage";

/**
 * What the album download contains, against the real local database and a local S3 emulator
 * (F-080, F-083): order, paging past 1 000 files, the offer deciding the variant, signed addresses
 * that really give the file. Needs `pnpm db:start` and `pnpm storage:start`.
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
const bucket = `snapalbum-download-${randomUUID().slice(0, 8)}`;
const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

let storage: Storage;
let deps: DownloadDeps;
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
    email: `dl-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

async function newEvent(plan: "free" | "event" = "free") {
  const owner = await newUser();
  const created = await createEvent(admin, owner, {
    title: "Mariage de Léa et Tom",
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  if (plan !== "free") await admin.from("events").update({ plan }).eq("id", created.event.id);
  const guestUser = await newUser({ anonymous: true });
  const { data, error } = await admin
    .from("guests")
    .insert({
      event_id: created.event.id,
      auth_user_id: guestUser,
      display_name: "Anna",
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { event: created.event, owner, guestId: data.id };
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
}, 120_000);

describe("F-080, F-083: le contenu du téléchargement, avec la vraie base", () => {
  it("F-080: l'organisateur obtient la liste dans l'ordre, puis des adresses qui donnent vraiment les fichiers", async () => {
    const { event, owner, guestId } = await newEvent("event");
    const rows = [3, 1, 2].map((n) => {
      const id = randomUUID();
      return {
        id,
        n,
        keys: {
          key_thumb: `events/${event.id}/thumb/${id}.webp`,
          key_display: `events/${event.id}/display/${id}.webp`,
          key_original: `events/${event.id}/original/${id}.jpg`,
        },
      };
    });
    for (const row of rows) {
      for (const key of Object.values(row.keys)) {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: `file-${key}` }));
      }
    }
    const { error } = await admin.from("media").insert(
      rows.map((row) => ({
        id: row.id,
        event_id: event.id,
        guest_id: guestId,
        kind: "photo",
        status: "ready",
        moderation: "approved",
        sha256: randomBytes(32).toString("hex"),
        mime_type: "image/jpeg",
        bytes_original: 4000,
        bytes_display: 400,
        bytes_thumb: 40,
        taken_at: new Date(Date.UTC(2026, 8, 12, 10, row.n)).toISOString(),
        ...row.keys,
      })),
    );
    if (error) throw error;

    const plan = await planAlbum(deps, owner, event.id, { variant: "originals" });
    if (!plan.ok) throw new Error("refused");
    // Taken order: 1, 2, 3.
    expect(plan.body.items.map((item) => item.at)).toEqual([
      "2026-09-12T10:01:00.000Z",
      "2026-09-12T10:02:00.000Z",
      "2026-09-12T10:03:00.000Z",
    ]);
    expect(plan.body.items.every((item) => item.guestName === "Anna" && item.bytes === 4000)).toBe(
      true,
    );

    const signed = await signAlbumFiles(
      deps,
      owner,
      event.id,
      plan.body.items.map((i) => i.mediaId),
      "originals",
    );
    if (!signed.ok) throw new Error("refused");
    expect(signed.body.files).toHaveLength(3);
    for (const file of signed.body.files) {
      const row = rows.find((candidate) => candidate.id === file.mediaId)!;
      expect(await (await fetch(file.url)).text()).toBe(`file-${row.keys.key_original}`);
    }

    // Optimised: the display versions, lighter.
    const light = await signAlbumFiles(deps, owner, event.id, [rows[0]!.id], "optimized");
    if (!light.ok) throw new Error("refused");
    expect(await (await fetch(light.body.files[0]!.url)).text()).toBe(
      `file-${rows[0]!.keys.key_display}`,
    );
  });

  it("F-080: l'offre gratuite ne donne que les versions optimisées, même si les originaux sont demandés", async () => {
    const { event, owner, guestId } = await newEvent("free");
    const id = randomUUID();
    const display = `events/${event.id}/display/${id}.webp`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: display, Body: "display" }));
    await admin.from("media").insert({
      id,
      event_id: event.id,
      guest_id: guestId,
      kind: "photo",
      status: "ready",
      sha256: randomBytes(32).toString("hex"),
      mime_type: "image/webp",
      bytes_display: 7,
      bytes_thumb: 1,
      key_thumb: `events/${event.id}/thumb/${id}.webp`,
      key_display: display,
    });
    const plan = await planAlbum(deps, owner, event.id, { variant: "originals" });
    if (!plan.ok) throw new Error("refused");
    expect(plan.body).toMatchObject({ variant: "optimized", originalsAllowed: false });
    const signed = await signAlbumFiles(deps, owner, event.id, [id], "originals");
    if (!signed.ok) throw new Error("refused");
    expect(await (await fetch(signed.body.files[0]!.url)).text()).toBe("display");
  });

  it("F-080: au-delà de 1 000 médias la liste se parcourt par pages, sans doublon ni oubli, dans l'ordre", async () => {
    const { event, owner, guestId } = await newEvent("event");
    const total = PLAN_PAGE_SIZE + 37;
    const base = Date.parse("2026-09-12T00:00:00Z");
    const rows = Array.from({ length: total }, (_, i) => {
      const id = randomUUID();
      return {
        id,
        event_id: event.id,
        guest_id: guestId,
        kind: "photo",
        status: "ready",
        moderation: "approved",
        sha256: randomBytes(32).toString("hex"),
        mime_type: "image/webp",
        bytes_display: 10,
        bytes_thumb: 1,
        taken_at: new Date(base + i * 1000).toISOString(),
        key_thumb: `events/${event.id}/thumb/${id}.webp`,
        key_display: `events/${event.id}/display/${id}.webp`,
      };
    });
    for (let start = 0; start < rows.length; start += 500) {
      const { error } = await admin.from("media").insert(rows.slice(start, start + 500));
      if (error) throw error;
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await planAlbum(deps, owner, event.id, { variant: "optimized", cursor });
      if (!page.ok) throw new Error("refused");
      seen.push(...page.body.items.map((item) => item.mediaId));
      cursor = page.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(2);
    expect(seen).toEqual(rows.map((row) => row.id));
  }, 120_000);

  it("S-001: un autre organisateur n'obtient ni la liste ni des adresses", async () => {
    const { event, guestId } = await newEvent("event");
    const stranger = await newUser();
    expect(await planAlbum(deps, stranger, event.id, { variant: "originals" })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await signAlbumFiles(deps, stranger, event.id, [guestId], "originals")).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
