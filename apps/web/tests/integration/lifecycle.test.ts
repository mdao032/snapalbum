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
import type Stripe from "stripe";
import type { Database } from "@snapalbum/shared/db-types";
import type { Mailer, OutgoingEmail } from "@/server/email/mailer";
import { createEvent } from "@/server/events";
import { cleanupUploads, expireEvents, purgeDueEvents } from "@/server/lifecycle";
import {
  notifyDeletionRequested,
  notifyPaymentConfirmed,
  notifyQuotaReached,
  notifyWelcome,
  runDailyRecap,
  sendAlbumReady,
  sendExpiryReminders,
} from "@/server/notifications";
import { handleStripeEvent } from "@/server/payments";
import { createStorage, type Storage } from "@/server/storage";

/**
 * Life of an event and its e-mails (SPEC 9.2, 14) on the real database and a local S3 emulator,
 * with the clock simulated: expiry, purge, clean-up, reminders, recap, album link, and the
 * guarantee that every e-mail goes out once. Needs `pnpm db:start` and `pnpm storage:start`.
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
const bucket = `snapalbum-life-${randomUUID().slice(0, 8)}`;
const DAY = 24 * 60 * 60 * 1000;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });
let storage: Storage;

const createdUsers: string[] = [];
const createdEvents: string[] = [];

/** A mailer that keeps what it was asked to send. */
function capture() {
  const sent: OutgoingEmail[] = [];
  const mailer: Mailer = {
    name: "console",
    async send(email) {
      sent.push(email);
    },
    async sendMany(emails) {
      sent.push(...emails);
    },
  };
  return { mailer, sent };
}

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
    email: options.email ?? `life-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

/** An event of a fresh organiser, with columns the application never lets anyone write set directly. */
async function newEvent(
  columns: Database["public"]["Tables"]["events"]["Update"] = {},
  eventDate?: string,
) {
  const owner = await newUser();
  const created = await createEvent(admin, owner, {
    title: "Mariage de Léa et Tom",
    eventDate: eventDate ?? new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  if (Object.keys(columns).length > 0) {
    const { error } = await admin.from("events").update(columns).eq("id", created.event.id);
    if (error) throw error;
  }
  return { owner, id: created.event.id, code: created.event.public_code };
}

async function addGuest(eventId: string, overrides: Record<string, unknown> = {}) {
  const userId = await newUser({ anonymous: true });
  const { data, error } = await admin
    .from("guests")
    .insert({
      event_id: eventId,
      auth_user_id: userId,
      terms_accepted_at: new Date().toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { userId, guestId: data.id };
}

async function eventRow(id: string) {
  const { data, error } = await admin
    .from("events")
    .select("status, plan, deleted_at, deletion_reason, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function putObject(key: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: randomBytes(64) }));
}

async function logged(eventId: string, kind: string) {
  const { data, error } = await admin
    .from("email_log")
    .select("recipient_key, status")
    .eq("event_id", eventId)
    .eq("kind", kind);
  if (error) throw error;
  return data;
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

describe("SPEC 9.2: expiration", () => {
  it("un album dont la conservation est finie est fermé, ses adresses d'invités effacées, une trace écrite", async () => {
    const past = new Date(Date.now() - DAY).toISOString();
    const { id } = await newEvent({ expires_at: past });
    const withEmail = await addGuest(id, {
      notify_email: "invite@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    const now = new Date();

    const first = await expireEvents({ admin, storage, now: () => now });
    expect(first.expired).toContain(id);
    expect(await eventRow(id)).toMatchObject({
      status: "pending_deletion",
      deletion_reason: "expired",
    });
    const { data: guest } = await admin
      .from("guests")
      .select("notify_email, notify_consent_at")
      .eq("id", withEmail.guestId)
      .single();
    expect(guest).toEqual({ notify_email: null, notify_consent_at: null });
    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("target_id", id)
      .eq("action", "event_expired");
    expect(audit).toHaveLength(1);

    // A second run changes nothing and writes nothing more.
    const second = await expireEvents({ admin, storage, now: () => now });
    expect(second.expired).not.toContain(id);
  });

  it("un événement encore dans sa conservation, ou sur l'offre Pro, n'est pas touché", async () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    const running = await newEvent({ expires_at: future });
    const pro = await newEvent({ plan: "pro", expires_at: null });
    const result = await expireEvents({ admin, storage });
    expect(result.expired).not.toContain(running.id);
    expect(result.expired).not.toContain(pro.id);
    expect((await eventRow(running.id))?.status).toBe("active");
    expect((await eventRow(pro.id))?.status).toBe("active");
  });

  it("R2: payer pendant les 7 jours ramène un album expiré ; un album supprimé par l'organisateur ne revient pas", async () => {
    const past = new Date(Date.now() - DAY).toISOString();
    const expired = await newEvent({ expires_at: past });
    await expireEvents({ admin, storage });
    expect((await eventRow(expired.id))?.status).toBe("pending_deletion");

    const payment = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${randomUUID().replaceAll("-", "")}`,
          payment_status: "paid",
          amount_total: 4900,
          currency: "eur",
          payment_intent: `pi_${randomUUID()}`,
          metadata: { event_id: expired.id, user_id: expired.owner, product: "event" },
        },
      },
    } as unknown as Stripe.Event;
    await handleStripeEvent(admin, payment);
    const back = await eventRow(expired.id);
    expect(back).toMatchObject({
      status: "active",
      plan: "event",
      deleted_at: null,
      deletion_reason: null,
    });
    expect(Date.parse(back!.expires_at!)).toBeGreaterThan(Date.now() + 300 * DAY);
  });
});

describe("R5, SPEC 9.2: purge complète, base et stockage, avec journal d'audit", () => {
  it("après 7 jours, fichiers, lignes et comptes d'invités disparaissent ; l'achat reste ; la trace aussi", async () => {
    const { id, owner } = await newEvent({
      status: "pending_deletion",
      deleted_at: new Date(Date.now() - 8 * DAY).toISOString(),
      deletion_reason: "expired",
    });
    const guest = await addGuest(id);
    const mediaId = randomUUID();
    const { error } = await admin.from("media").insert({
      id: mediaId,
      event_id: id,
      guest_id: guest.guestId,
      kind: "photo",
      status: "ready",
      sha256: randomBytes(32).toString("hex"),
      mime_type: "image/jpeg",
      bytes_display: 64,
      bytes_thumb: 64,
      key_display: `events/${id}/display/${mediaId}.webp`,
      key_thumb: `events/${id}/thumb/${mediaId}.webp`,
    });
    if (error) throw error;
    await putObject(`events/${id}/display/${mediaId}.webp`);
    await putObject(`events/${id}/thumb/${mediaId}.webp`);
    await admin.from("purchases").insert({
      event_id: id,
      event_title: "Mariage de Léa et Tom",
      user_id: owner,
      amount_cents: 4900,
      currency: "eur",
      product: "event",
    });

    const report = await purgeDueEvents({ admin, storage, purgeBatch: 1000 });
    expect(report.purged).toContain(id);

    expect(await storage.head(`events/${id}/display/${mediaId}.webp`)).toBeNull();
    expect(await storage.head(`events/${id}/thumb/${mediaId}.webp`)).toBeNull();
    expect(await eventRow(id)).toBeNull();
    const { data: media } = await admin.from("media").select("id").eq("event_id", id);
    expect(media).toEqual([]);
    const { data: purchase } = await admin
      .from("purchases")
      .select("event_id, event_title")
      .eq("user_id", owner);
    expect(purchase).toEqual([{ event_id: null, event_title: "Mariage de Léa et Tom" }]);
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("target_id", id)
      .eq("action", "event_purged");
    expect(audit).toHaveLength(1);
    expect(audit?.[0]?.metadata).toMatchObject({ media_count: 1, reason: "expired" });
    // The anonymous account of a guest who belonged to no other event is gone too.
    const { data: lookup } = await admin.auth.admin.getUserById(guest.userId);
    expect(lookup.user).toBeNull();
  });

  it("une suppression qui date de moins de 7 jours, ou un événement actif, n'est jamais purgé", async () => {
    const recent = await newEvent({
      status: "pending_deletion",
      deleted_at: new Date(Date.now() - 3 * DAY).toISOString(),
      deletion_reason: "user",
    });
    const active = await newEvent();
    const key = `events/${recent.id}/thumb/keep.webp`;
    await putObject(key);

    const report = await purgeDueEvents({ admin, storage, purgeBatch: 1000 });
    expect(report.purged).not.toContain(recent.id);
    expect(report.purged).not.toContain(active.id);
    expect(await eventRow(recent.id)).not.toBeNull();
    expect(await eventRow(active.id)).not.toBeNull();
    expect(await storage.head(key)).not.toBeNull();
  });
});

describe("SPEC 9.2: nettoyage des envois abandonnés", () => {
  it("une réservation jamais confirmée depuis plus de 24 h est supprimée avec ses fichiers et sa place", async () => {
    const { id } = await newEvent();
    const guest = await addGuest(id);
    const old = randomUUID();
    const recent = randomUUID();
    for (const [mediaId, age] of [
      [old, 25 * 60 * 60 * 1000],
      [recent, 60 * 60 * 1000],
    ] as const) {
      const { error } = await admin.from("media").insert({
        id: mediaId,
        event_id: id,
        guest_id: guest.guestId,
        kind: "photo",
        status: "pending",
        sha256: randomBytes(32).toString("hex"),
        mime_type: "image/jpeg",
        bytes_display: 64,
        bytes_thumb: 64,
        key_display: `events/${id}/display/${mediaId}.webp`,
        key_thumb: `events/${id}/thumb/${mediaId}.webp`,
        created_at: new Date(Date.now() - age).toISOString(),
      });
      if (error) throw error;
      await putObject(`events/${id}/display/${mediaId}.webp`);
    }

    const report = await cleanupUploads({ admin, storage });
    expect(report.mediaRemoved).toBeGreaterThanOrEqual(1);
    const { data } = await admin.from("media").select("id").eq("event_id", id);
    expect(data).toEqual([{ id: recent }]);
    expect(await storage.head(`events/${id}/display/${old}.webp`)).toBeNull();
    expect(await storage.head(`events/${id}/display/${recent}.webp`)).not.toBeNull();
    const { data: counters } = await admin
      .from("events")
      .select("media_count, uploads_abandoned")
      .eq("id", id)
      .single();
    expect(counters?.media_count).toBe(1);
    // Step 6.3: the dropped reservation is counted, for the beta's send success rate.
    expect(counters?.uploads_abandoned).toBe(1);
  });

  it("un envoi en plusieurs parties dont l'expiration est passée est abandonné côté stockage et en base", async () => {
    const { id } = await newEvent();
    const guest = await addGuest(id);
    const mediaId = randomUUID();
    const key = `events/${id}/original/${mediaId}.mp4`;
    const { error } = await admin.from("media").insert({
      id: mediaId,
      event_id: id,
      guest_id: guest.guestId,
      kind: "video",
      status: "pending",
      sha256: randomBytes(32).toString("hex"),
      mime_type: "video/mp4",
      bytes_original: 60_000_000,
      bytes_thumb: 64,
      key_original: key,
      key_thumb: `events/${id}/thumb/${mediaId}.webp`,
    });
    if (error) throw error;
    const uploadId = await storage.createMultipart(key, "video/mp4");
    await admin.from("uploads").insert({
      media_id: mediaId,
      multipart_upload_id: uploadId,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const report = await cleanupUploads({ admin, storage });
    expect(report.multipartAborted).toBeGreaterThanOrEqual(1);
    const { data } = await admin.from("uploads").select("id").eq("media_id", mediaId);
    expect(data).toEqual([]);
    await expect(storage.listParts(key, uploadId)).rejects.toThrow();
  });
});

describe("R3: rappels d'expiration, avec des dates simulées", () => {
  it("J-7 puis J-1 : chacun une seule fois, jamais deux fois le même, jamais après la fermeture", async () => {
    const expires = new Date(Date.UTC(2031, 5, 20, 0, 0, 0));
    const { id } = await newEvent({ expires_at: expires.toISOString() });
    const { mailer, sent } = capture();
    const at = (iso: string) => ({ admin, mailer, now: () => new Date(iso) });
    const mine = () => sent.filter((email) => email.subject.includes("Mariage de Léa et Tom"));

    await sendExpiryReminders(at("2031-06-12T08:00:00Z"));
    expect(mine()).toHaveLength(0);

    await sendExpiryReminders(at("2031-06-13T08:00:00Z"));
    expect(mine()).toHaveLength(1);
    expect(mine()[0]?.subject).toContain("ferme le 20 juin 2031");
    expect(mine()[0]?.html).toContain("/events/" + id);
    expect(mine()[0]?.html).toMatch(/19\s€/);

    // The task runs again the same day, and the day after: still the one message.
    await sendExpiryReminders(at("2031-06-13T20:00:00Z"));
    await sendExpiryReminders(at("2031-06-14T08:00:00Z"));
    expect(mine()).toHaveLength(1);

    await sendExpiryReminders(at("2031-06-19T08:00:00Z"));
    expect(mine()).toHaveLength(2);
    await sendExpiryReminders(at("2031-06-19T09:00:00Z"));
    expect(mine()).toHaveLength(2);

    await sendExpiryReminders(at("2031-06-20T08:00:00Z"));
    expect(mine()).toHaveLength(2);
    expect((await logged(id, "expiry_reminder_7")).length).toBe(1);
    expect((await logged(id, "expiry_reminder_1")).length).toBe(1);
  });

  it("un envoi qui échoue rend sa place : la prochaine exécution réessaie", async () => {
    const expires = new Date(Date.UTC(2032, 5, 20, 0, 0, 0));
    const { id } = await newEvent({ expires_at: expires.toISOString() });
    const now = () => new Date("2032-06-14T08:00:00Z");
    const broken: Mailer = {
      name: "console",
      async send() {
        throw new Error("Resend is down");
      },
      async sendMany() {
        throw new Error("Resend is down");
      },
    };
    const failed = await sendExpiryReminders({ admin, mailer: broken, now });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect(await logged(id, "expiry_reminder_7")).toEqual([]);

    const { mailer, sent } = capture();
    await sendExpiryReminders({ admin, mailer, now });
    expect(sent.some((email) => email.subject.includes("Mariage de Léa et Tom"))).toBe(true);
    expect(await logged(id, "expiry_reminder_7")).toHaveLength(1);
  });
});

describe("SPEC 14, F-044: lendemain de l'événement", () => {
  it("le récapitulatif de l'organisateur part une fois, à J+1 et pas avant", async () => {
    const { id } = await newEvent({ media_count: 3 }, "2031-03-10");
    const { mailer, sent } = capture();
    const run = (iso: string) => runDailyRecap({ admin, mailer, now: () => new Date(iso) });
    const mine = () => sent.filter((email) => email.subject.includes("Mariage de Léa et Tom"));

    await run("2031-03-11T08:00:00Z");
    expect(mine()).toHaveLength(0);
    await run("2031-03-11T12:00:00Z");
    expect(mine()).toHaveLength(1);
    expect(mine()[0]?.subject).toContain("3 photos et vidéos envoyées");
    await run("2031-03-12T09:00:00Z");
    expect(mine()).toHaveLength(1);
    expect(await logged(id, "recap_next_day")).toHaveLength(1);
  });

  it("l'album est envoyé aux invités qui l'ont demandé, avec consentement, une seule fois", async () => {
    const { id, code } = await newEvent({}, "2031-04-10");
    await addGuest(id, {
      notify_email: "demande@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    await addGuest(id, { notify_email: "sans-consentement@example.test" });
    await addGuest(id, {
      notify_email: "bloque@example.test",
      notify_consent_at: new Date().toISOString(),
      blocked_at: new Date().toISOString(),
    });
    await addGuest(id);
    const { mailer, sent } = capture();
    const run = (iso: string) => runDailyRecap({ admin, mailer, now: () => new Date(iso) });
    const guestMails = () =>
      sent.filter((email) => email.to.endsWith("@example.test") && email.to.includes("demande"));

    await run("2031-04-10T20:00:00Z");
    expect(guestMails()).toHaveLength(0);
    await run("2031-04-11T13:00:00Z");
    expect(guestMails()).toHaveLength(1);
    expect(guestMails()[0]?.html).toContain(`/e/${code}`);
    expect(sent.some((email) => email.to.includes("sans-consentement"))).toBe(false);
    expect(sent.some((email) => email.to.includes("bloque"))).toBe(false);

    await run("2031-04-12T13:00:00Z");
    expect(guestMails()).toHaveLength(1);
    expect(await logged(id, "album_ready")).toHaveLength(1);
  });

  it("dès que l'organisateur déclare l'album prêt, les invités le reçoivent sans attendre le lendemain", async () => {
    const { id } = await newEvent({}, "2031-05-10");
    await addGuest(id, {
      notify_email: "tot@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    const { mailer, sent } = capture();
    expect(await sendAlbumReady({ admin, mailer }, id)).toBe(1);
    expect(sent.map((email) => email.to)).toEqual(["tot@example.test"]);
    // The daily task finding the same guest later sends nothing more.
    expect(await sendAlbumReady({ admin, mailer }, id)).toBe(0);
    await runDailyRecap({ admin, mailer, now: () => new Date("2031-05-11T13:00:00Z") });
    expect(sent.filter((email) => email.to === "tot@example.test")).toHaveLength(1);
  });

  it("si l'organisateur n'a pas ouvert la galerie aux invités, aucun lien d'album n'est envoyé", async () => {
    const { id } = await newEvent({}, "2031-05-20");
    const { data: row } = await admin.from("events").select("settings").eq("id", id).single();
    await admin
      .from("events")
      .update({ settings: { ...(row!.settings as object), gallery_visible: false } })
      .eq("id", id);
    await addGuest(id, {
      notify_email: "ferme@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    const { mailer, sent } = capture();
    expect(await sendAlbumReady({ admin, mailer }, id)).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("SPEC 14: e-mails transactionnels, une fois chacun", () => {
  it("bienvenue avec le QR code en image intégrée, une seule fois", async () => {
    const { id, code } = await newEvent();
    const { mailer, sent } = capture();
    expect(await notifyWelcome({ admin, mailer }, id)).toBe("sent");
    expect(await notifyWelcome({ admin, mailer }, id)).toBe("skipped");
    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.subject).toContain("Bienvenue");
    expect(email.html).toContain("cid:event-qr");
    expect(email.html).toContain(`http://localhost:3000/${code}`);
    expect(email.inlineImages?.[0]).toMatchObject({
      contentId: "event-qr",
      contentType: "image/png",
    });
    expect(email.inlineImages?.[0]?.content.subarray(1, 4).toString()).toBe("PNG");
    expect(email.text).toContain("Mariage de Léa et Tom");
  });

  it("R1: album plein, l'organisateur est prévenu une fois, avec l'offre sur le plan gratuit", async () => {
    const { id } = await newEvent();
    const { mailer, sent } = capture();
    expect(await notifyQuotaReached({ admin, mailer }, id)).toBe("sent");
    expect(await notifyQuotaReached({ admin, mailer }, id)).toBe("skipped");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("est plein");
    expect(sent[0]?.html).toMatch(/49\s€/);
    expect(sent[0]?.html).toMatch(/10\s000/);
  });

  it("paiement confirmé : un seul e-mail même si le webhook et la page de retour arrivent ensemble", async () => {
    const { id, owner } = await newEvent();
    const { data: purchase, error } = await admin
      .from("purchases")
      .insert({
        event_id: id,
        event_title: "Mariage de Léa et Tom",
        user_id: owner,
        amount_cents: 4900,
        currency: "eur",
        product: "event",
      })
      .select("id")
      .single();
    if (error) throw error;
    const { mailer, sent } = capture();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => notifyPaymentConfirmed({ admin, mailer }, purchase.id)),
    );
    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("Offre Événement");
    expect(sent[0]?.html).toMatch(/49\s€/);
  });

  it("confirmation de suppression : date de la purge et lien pour annuler ; une nouvelle suppression en renvoie une", async () => {
    const first = new Date().toISOString();
    const { id } = await newEvent({
      status: "pending_deletion",
      deleted_at: first,
      deletion_reason: "user",
    });
    const { mailer, sent } = capture();
    expect(await notifyDeletionRequested({ admin, mailer }, id)).toBe("sent");
    expect(await notifyDeletionRequested({ admin, mailer }, id)).toBe("skipped");
    expect(sent[0]?.html).toContain(`/events/${id}`);

    await admin
      .from("events")
      .update({ deleted_at: new Date(Date.now() + 1000).toISOString() })
      .eq("id", id);
    expect(await notifyDeletionRequested({ admin, mailer }, id)).toBe("sent");
  });

  it("une réservation d'envoi laissée en suspens est respectée un moment, puis reprise (tâche morte en route)", async () => {
    const { id, owner } = await newEvent();
    const claim = async (staleMinutes: number) => {
      const { data, error } = await admin.rpc("claim_email", {
        p_kind: "welcome",
        p_event_id: id,
        p_recipient: owner,
        p_stale_minutes: staleMinutes,
      });
      if (error) throw error;
      return data;
    };
    expect(await claim(15)).toBe(true);
    // Another run, right away: the first one is probably still sending.
    expect(await claim(15)).toBe(false);
    // Much later (here: a zero-minute patience), the first run is taken for dead.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await claim(0)).toBe(true);
    // Once sent, never again, whatever the patience.
    await admin.rpc("finish_email", {
      p_kind: "welcome",
      p_event_id: id,
      p_recipient: owner,
      p_provider: "console",
    });
    expect(await claim(0)).toBe(false);
  });
});
