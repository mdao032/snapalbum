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
import {
  adminOverview,
  checkStorageAlert,
  extendEvent,
  getAdminEvent,
  listAdminEvents,
  listAdminOrganisers,
  listAdminPurchases,
  listOpenReports,
  setEventSuspended,
} from "@/server/admin";
import type { Mailer, OutgoingEmail } from "@/server/email/mailer";
import { createEvent } from "@/server/events";
import { moderateMedia } from "@/server/moderation";
import { createStorage, type Storage } from "@/server/storage";

/**
 * The administrator area on the real database and a local S3 emulator (F-090 to F-092, SPEC 9.3):
 * figures, search, suspension, extension, reported media and their deletion, and the storage alert.
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
const bucket = `snapalbum-admin-${randomUUID().slice(0, 8)}`;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });
let storage: Storage;

const createdUsers: string[] = [];
const createdEvents: string[] = [];

async function newUser(options: { anonymous?: boolean; email?: string } = {}): Promise<string> {
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
    email: options.email ?? `adm-${randomUUID()}@example.test`,
    email_confirm: true,
    user_metadata: { locale: "fr" },
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

async function newEvent(owner: string, title: string, columns: Record<string, unknown> = {}) {
  const created = await createEvent(admin, owner, {
    title,
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  const { error } = await admin
    .from("events")
    .update({ plan: "event", ...columns })
    .eq("id", created.event.id);
  if (error) throw error;
  return created.event;
}

async function reportedPhoto(eventId: string) {
  const guestUser = await newUser({ anonymous: true });
  const { data: guest, error: guestError } = await admin
    .from("guests")
    .insert({
      event_id: eventId,
      auth_user_id: guestUser,
      display_name: "Camille",
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (guestError) throw guestError;
  const id = randomUUID();
  const keys = {
    key_original: `events/${eventId}/original/${id}.jpg`,
    key_display: `events/${eventId}/display/${id}.webp`,
    key_thumb: `events/${eventId}/thumb/${id}.webp`,
  };
  const { error } = await admin.from("media").insert({
    id,
    event_id: eventId,
    guest_id: guest.id,
    kind: "photo",
    status: "ready",
    moderation: "approved",
    sha256: randomBytes(32).toString("hex"),
    mime_type: "image/jpeg",
    bytes_display: 64,
    bytes_thumb: 64,
    ...keys,
  });
  if (error) throw error;
  for (const key of Object.values(keys)) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: randomBytes(64) }));
  }
  const { error: reportError } = await admin.from("reports").insert([
    { media_id: id, reason: "inappropriate", reporter_fingerprint: "a".repeat(64) },
    { media_id: id, reason: "other", reporter_fingerprint: "b".repeat(64) },
  ]);
  if (reportError) throw reportError;
  return { id, keys };
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
});

afterAll(async () => {
  for (const id of createdEvents) {
    await storage.deleteEventObjects(`events/${id}/`).catch(() => undefined);
    await admin.from("events").delete().eq("id", id);
  }
  await admin.from("purchases").delete().in("user_id", createdUsers);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
}, 60_000);

describe("F-090, F-092: chiffres, listes et recherche", () => {
  it("les chiffres bougent avec un événement, un média, un achat et un signalement", async () => {
    const before = await adminOverview(admin);
    const owner = await newUser();
    const event = await newEvent(owner, "Chiffres", { bytes_used: 4096 });
    await reportedPhoto(event.id);
    await admin.from("purchases").insert({
      event_id: event.id,
      event_title: "Chiffres",
      user_id: owner,
      amount_cents: 4900,
      currency: "eur",
      product: "event",
    });

    const after = await adminOverview(admin);
    expect(after.events_total - before.events_total).toBeGreaterThanOrEqual(1);
    expect(after.events_paid - before.events_paid).toBeGreaterThanOrEqual(1);
    expect(after.revenue_cents - before.revenue_cents).toBeGreaterThanOrEqual(4900);
    expect(after.open_reports - before.open_reports).toBeGreaterThanOrEqual(2);
    expect(after.bytes_total - before.bytes_total).toBeGreaterThanOrEqual(4096);
  });

  it("retrouve un événement et son organisateur, et liste les paiements", async () => {
    const email = `cherche-${randomUUID()}@example.test`;
    const owner = await newUser({ email });
    const tag = `Gala-${randomUUID().slice(0, 8)}`;
    const event = await newEvent(owner, tag);
    await admin.from("purchases").insert({
      event_id: event.id,
      event_title: tag,
      user_id: owner,
      amount_cents: 4900,
      currency: "eur",
      product: "event",
      stripe_payment_intent_id: `pi_${randomUUID()}`,
    });

    const byTitle = await listAdminEvents(admin, tag.toLowerCase(), 1);
    expect(byTitle.rows.map((row) => row.id)).toEqual([event.id]);
    expect(byTitle.rows[0]?.owner_email).toBe(email);
    expect((await listAdminEvents(admin, email, 1)).rows.map((row) => row.id)).toContain(event.id);

    const organisers = await listAdminOrganisers(admin, email, 1);
    expect(organisers.rows).toHaveLength(1);
    expect(organisers.rows[0]).toMatchObject({ email, events_count: 1, paid_cents: 4900 });

    const purchases = await listAdminPurchases(admin, 1);
    expect(purchases.total).toBeGreaterThan(0);
    expect(purchases.rows.length).toBeLessThanOrEqual(25);
  });
});

describe("F-091: suspendre, prolonger", () => {
  it("un événement suspendu n'est plus actif, se rétablit, et la prolongation ajoute des mois", async () => {
    const adminUser = await newUser();
    const owner = await newUser();
    const event = await newEvent(owner, "À suspendre", { expires_at: "2099-01-15T00:00:00Z" });

    expect(await setEventSuspended(admin, adminUser, event.id, true)).toEqual({ ok: true });
    const { data: suspended } = await admin
      .from("events")
      .select("status")
      .eq("id", event.id)
      .single();
    expect(suspended?.status).toBe("suspended");
    expect(await extendEvent(admin, adminUser, event.id, 3)).toEqual({ ok: true });
    expect(await setEventSuspended(admin, adminUser, event.id, false)).toEqual({ ok: true });
    expect(await setEventSuspended(admin, adminUser, event.id, false)).toMatchObject({
      ok: false,
    });

    const { data } = await admin
      .from("events")
      .select("status, expires_at")
      .eq("id", event.id)
      .single();
    expect(data?.status).toBe("active");
    expect(new Date(data!.expires_at!).toISOString()).toBe("2099-04-15T00:00:00.000Z");
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_id")
      .eq("target_id", event.id);
    expect((audit ?? []).map((line) => line.action).sort()).toEqual([
      "admin.event.extend",
      "admin.event.suspend",
      "admin.event.unsuspend",
    ]);
    expect(new Set((audit ?? []).map((line) => line.actor_id))).toEqual(new Set([adminUser]));
  });

  it("la fiche d'un événement donne l'organisateur, les paiements et les signalements", async () => {
    const email = `fiche-${randomUUID()}@example.test`;
    const owner = await newUser({ email });
    const event = await newEvent(owner, "Fiche");
    await reportedPhoto(event.id);

    const detail = await getAdminEvent(admin, storage, event.id);
    expect(detail?.ownerEmail).toBe(email);
    expect(detail?.reports).toHaveLength(1);
    expect(detail?.reports[0]).toMatchObject({ count: 2, eventTitle: "Fiche" });
    expect(detail?.reports[0]?.thumbUrl).toContain(event.id);
    expect(await getAdminEvent(admin, storage, randomUUID())).toBeNull();
  });
});

describe("F-090, F-091: signalements", () => {
  it("l'administrateur supprime un média signalé sur un événement suspendu : fichiers effacés, signalements fermés", async () => {
    const adminUser = await newUser();
    const owner = await newUser();
    const event = await newEvent(owner, "Signalé");
    const photo = await reportedPhoto(event.id);
    await setEventSuspended(admin, adminUser, event.id, true);

    expect((await listOpenReports(admin, storage, event.id)).map((item) => item.mediaId)).toEqual([
      photo.id,
    ]);
    const result = await moderateMedia(
      { admin, storage, asAdmin: true },
      adminUser,
      event.id,
      "delete",
      [photo.id],
    );
    expect(result).toEqual({ ok: true, body: { changed: 1 } });

    for (const key of Object.values(photo.keys)) expect(await storage.head(key)).toBeNull();
    expect(await listOpenReports(admin, storage, event.id)).toEqual([]);
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_id")
      .eq("target_id", event.id)
      .eq("action", "admin.media.delete");
    expect(audit).toEqual([{ action: "admin.media.delete", actor_id: adminUser }]);
  });
});

describe("SPEC 9.3: alerte de stockage", () => {
  it("au-dessus du seuil, l'administrateur reçoit un e-mail, une seule fois par semaine", async () => {
    await admin.from("audit_log").delete().eq("action", "admin.storage_alert");
    const email = `alerte-${randomUUID()}@example.test`;
    const user = await newUser({ email });
    await admin.from("profiles").update({ role: "admin" }).eq("user_id", user);

    const sent: OutgoingEmail[] = [];
    const mailer: Mailer = {
      name: "console",
      async send(item) {
        sent.push(item);
      },
      async sendMany(items) {
        sent.push(...items);
      },
    };
    const run = () => checkStorageAlert({ admin, mailer, thresholdBytes: 1 });

    expect(await run()).toBe("sent");
    const mine = sent.filter((item) => item.to === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toBe("Le stockage dépasse le seuil");
    const count = sent.length;
    expect(await run()).toBe("skipped");
    expect(sent).toHaveLength(count);
    await admin.from("audit_log").delete().eq("action", "admin.storage_alert");
    await admin.from("profiles").update({ role: "user" }).eq("user_id", user);
  });
});
