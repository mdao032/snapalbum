import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { countOptimizedOnlyPhotos, createEvent, getEventPlan } from "@/server/events";
import { createStorage } from "@/server/storage";
import { reserveUpload, type UploadDeps } from "@/server/uploads";

/**
 * R2 on the real database: originals are kept only for what is sent after the upgrade, and the
 * organiser is told how many photos only have their optimised version (F-045). Needs
 * `pnpm db:start` and `pnpm storage:start`.
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
const bucket = `snapalbum-plans-${randomUUID().slice(0, 8)}`;
const MB = 1024 * 1024;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

let deps: UploadDeps;
const createdUsers: string[] = [];
const createdEvents: string[] = [];

async function newEventWithGuest() {
  const owner = await admin.auth.admin.createUser({
    email: `plans-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (owner.error || !owner.data.user) throw owner.error ?? new Error("no user");
  createdUsers.push(owner.data.user.id);
  const created = await createEvent(admin, owner.data.user.id, {
    title: "Mariage de Léa et Tom",
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);

  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInAnonymously();
  if (signed.error || !signed.data.user) throw signed.error ?? new Error("no guest");
  createdUsers.push(signed.data.user.id);
  const { error } = await admin.from("guests").insert({
    event_id: created.event.id,
    auth_user_id: signed.data.user.id,
    terms_accepted_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { event: created.event, guest: signed.data.user.id };
}

const photo = (eventCode: string) => ({
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
});

async function reserveReady(guest: string, eventCode: string) {
  const result = await reserveUpload(deps, { id: guest }, photo(eventCode) as never);
  if (!result.ok || result.body.status !== "reserved") throw new Error("not reserved");
  await admin.from("media").update({ status: "ready" }).eq("id", result.body.mediaId);
  return result.body;
}

beforeAll(async () => {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  deps = {
    admin,
    storage: createStorage({
      endpoint,
      bucket,
      region: "us-east-1",
      forcePathStyle: true,
      ...credentials,
    }),
  };
});

afterAll(async () => {
  for (const id of createdEvents) {
    await deps.storage.deleteEventObjects(`events/${id}/`).catch(() => undefined);
    await admin.from("events").delete().eq("id", id);
  }
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
}, 60_000);

describe("R2: originaux conservés seulement après le passage en payant", () => {
  it("F-045, R2: les photos du temps gratuit n'ont pas d'original, les suivantes en ont, et le tableau de bord les compte", async () => {
    const { event, guest } = await newEventWithGuest();
    expect(await getEventPlan(admin, event.id)).toBe("free");

    const first = await reserveReady(guest, event.public_code);
    const second = await reserveReady(guest, event.public_code);
    expect(first.original).toBeNull();
    expect(second.original).toBeNull();
    expect(await countOptimizedOnlyPhotos(admin, event.id)).toBe(2);

    await admin.from("events").update({ plan: "event" }).eq("id", event.id);
    expect(await getEventPlan(admin, event.id)).toBe("event");

    const third = await reserveReady(guest, event.public_code);
    expect(third.original).not.toBeNull();
    // Only the two photos sent before the upgrade lack an original.
    expect(await countOptimizedOnlyPhotos(admin, event.id)).toBe(2);
  }, 60_000);

  it("une photo supprimée ou encore en cours d'envoi n'est pas comptée ; un événement inconnu est gratuit", async () => {
    const { event, guest } = await newEventWithGuest();
    const sent = await reserveReady(guest, event.public_code);
    const pending = await reserveUpload(deps, { id: guest }, photo(event.public_code) as never);
    expect(pending.ok).toBe(true);
    expect(await countOptimizedOnlyPhotos(admin, event.id)).toBe(1);

    await admin.from("media").update({ status: "deleted" }).eq("id", sent.mediaId);
    expect(await countOptimizedOnlyPhotos(admin, event.id)).toBe(0);
    expect(await getEventPlan(admin, randomUUID())).toBe("free");
  }, 60_000);
});
