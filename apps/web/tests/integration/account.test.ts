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
  buildAccountExport,
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/server/account";
import type { Mailer, OutgoingEmail } from "@/server/email/mailer";
import { createEvent } from "@/server/events";
import { purgeDueAccounts } from "@/server/lifecycle";
import { notifyAccountDeletionRequested } from "@/server/notifications";
import { createStorage, type Storage } from "@/server/storage";

/**
 * Deleting an organiser's account (F-004, G-004, R5) on the real database and a local S3
 * emulator, with the clock simulated: the request, the 7 days, the cancellation, the purge of
 * events, files and sign-in account, and the copy of the data. Needs `pnpm db:start` and
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
const bucket = `snapalbum-account-${randomUUID().slice(0, 8)}`;
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
    email: `account-${randomUUID()}@example.test`,
    email_confirm: true,
    user_metadata: { locale: "fr" },
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

/**
 * An event of `owner`. Paid by default: the free plan allows one active event per organiser, and
 * several of them are needed here (`paid: false` keeps the free plan).
 */
async function newEventOf(owner: string, title = "Mariage de Léa et Tom", paid = true) {
  const created = await createEvent(admin, owner, {
    title,
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error(`event not created: ${created.reason}`);
  createdEvents.push(created.event.id);
  if (paid) {
    const { error } = await admin
      .from("events")
      .update({ plan: "event" })
      .eq("id", created.event.id);
    if (error) throw error;
  }
  return created.event;
}

async function addGuest(eventId: string, userId?: string, overrides: Record<string, unknown> = {}) {
  const authUser = userId ?? (await newUser({ anonymous: true }));
  const { data, error } = await admin
    .from("guests")
    .insert({
      event_id: eventId,
      auth_user_id: authUser,
      display_name: "Camille",
      terms_accepted_at: new Date().toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { userId: authUser, guestId: data.id };
}

async function putObject(key: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: randomBytes(64) }));
}

/** A ready photo with its three files in the storage. */
async function addPhoto(eventId: string, guestId: string) {
  const id = randomUUID();
  const keys = {
    key_original: `events/${eventId}/original/${id}.jpg`,
    key_display: `events/${eventId}/display/${id}.webp`,
    key_thumb: `events/${eventId}/thumb/${id}.webp`,
  };
  const { error } = await admin.from("media").insert({
    id,
    event_id: eventId,
    guest_id: guestId,
    kind: "photo",
    status: "ready",
    moderation: "approved",
    sha256: randomBytes(32).toString("hex"),
    mime_type: "image/jpeg",
    bytes_original: 64,
    bytes_display: 64,
    bytes_thumb: 64,
    ...keys,
  });
  if (error) throw error;
  for (const key of Object.values(keys)) await putObject(key);
  return { id, keys };
}

async function addPurchase(userId: string, eventId: string) {
  const { data, error } = await admin
    .from("purchases")
    .insert({
      event_id: eventId,
      event_title: "Mariage de Léa et Tom",
      user_id: userId,
      stripe_checkout_session_id: `cs_test_${randomUUID().replaceAll("-", "")}`,
      amount_cents: 4900,
      currency: "eur",
      product: "event",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const authUserExists = async (id: string) =>
  (await admin.auth.admin.getUserById(id)).data.user !== null;

async function eventState(id: string) {
  const { data } = await admin
    .from("events")
    .select("status, deletion_reason, deleted_at")
    .eq("id", id)
    .maybeSingle();
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

describe("F-004: demander, puis changer d'avis", () => {
  it("la demande ferme les événements, une seconde est refusée, l'annulation remet tout", async () => {
    const owner = await newUser();
    const first = await newEventOf(owner);
    const second = await newEventOf(owner, "Anniversaire de Paul");
    const now = new Date();

    const asked = await requestAccountDeletion(admin, owner, now);
    expect(asked.ok).toBe(true);
    if (asked.ok) {
      expect([...asked.eventIds].sort()).toEqual([first.id, second.id].sort());
      expect(asked.purgeAt.getTime() - now.getTime()).toBe(7 * DAY);
    }
    for (const id of [first.id, second.id]) {
      expect(await eventState(id)).toMatchObject({
        status: "pending_deletion",
        deletion_reason: "account",
      });
    }
    expect(await requestAccountDeletion(admin, owner, now)).toEqual({
      ok: false,
      reason: "already_requested",
    });

    // Not while the 7 days are over.
    expect(await cancelAccountDeletion(admin, owner, new Date(now.getTime() + 8 * DAY))).toEqual({
      ok: false,
      reason: "too_late",
    });
    const cancelled = await cancelAccountDeletion(admin, owner, new Date(now.getTime() + 3 * DAY));
    expect(cancelled).toEqual({ ok: true, restored: 2 });
    expect(await eventState(first.id)).toMatchObject({ status: "active", deletion_reason: null });
    const { data: profile } = await admin
      .from("profiles")
      .select("deleted_at")
      .eq("user_id", owner)
      .single();
    expect(profile?.deleted_at).toBeNull();
  });

  it("un compte en cours de suppression ne peut plus créer d'événement ; annulé, il le peut", async () => {
    const owner = await newUser();
    await newEventOf(owner, "Mariage de Léa et Tom", false);
    await requestAccountDeletion(admin, owner);
    const input = {
      title: "Autre fête",
      eventDate: new Date().toISOString().slice(0, 10),
      type: "birthday" as const,
      locale: "fr" as const,
    };
    expect(await createEvent(admin, owner, input)).toEqual({
      ok: false,
      reason: "account_pending_deletion",
    });
    await cancelAccountDeletion(admin, owner);
    // The free plan allows one active event: it is the quota that answers now, not the account.
    const again = await createEvent(admin, owner, input);
    expect(again.ok === false && again.reason).toBe("free_event_limit");
  });

  it("l'e-mail de confirmation donne la date de la suppression et le lien pour annuler", async () => {
    const owner = await newUser();
    await newEventOf(owner);
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
    const asked = await requestAccountDeletion(admin, owner, new Date("2026-10-22T10:00:00Z"));
    if (!asked.ok) throw new Error("not asked");

    expect(await notifyAccountDeletionRequested({ admin, mailer }, owner, asked.deletedAt)).toBe(
      "sent",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Suppression de votre compte programmée");
    expect(sent[0]?.text).toContain("29 octobre 2026");
    expect(sent[0]?.text).toContain("/account");
  });
});

describe("F-004, G-004: la purge du compte", () => {
  it("après 7 jours : événements, fichiers, invités anonymes et compte de connexion disparaissent, les achats restent sans lien", async () => {
    const owner = await newUser();
    const first = await newEventOf(owner);
    const second = await newEventOf(owner, "Anniversaire de Paul");
    const guestOne = await addGuest(first.id);
    const guestTwo = await addGuest(second.id);
    const photoOne = await addPhoto(first.id, guestOne.guestId);
    const photoTwo = await addPhoto(second.id, guestTwo.guestId);
    const purchaseId = await addPurchase(owner, first.id);

    const requestedAt = new Date();
    await requestAccountDeletion(admin, owner, requestedAt);

    // Six days: nothing is touched.
    const early = await purgeDueAccounts({
      admin,
      accountBatch: 1000,
      storage,
      now: () => new Date(requestedAt.getTime() + 6 * DAY),
    });
    expect(early.purged).not.toContain(owner);
    expect(await storage.head(photoOne.keys.key_original)).not.toBeNull();
    expect(await authUserExists(owner)).toBe(true);

    // Eight days: everything goes.
    const report = await purgeDueAccounts({
      admin,
      accountBatch: 1000,
      storage,
      now: () => new Date(requestedAt.getTime() + 8 * DAY),
    });
    expect(report.purged).toContain(owner);
    expect(report.failed).not.toContain(owner);

    for (const id of [first.id, second.id]) expect(await eventState(id)).toBeNull();
    for (const key of [...Object.values(photoOne.keys), ...Object.values(photoTwo.keys)]) {
      expect(await storage.head(key)).toBeNull();
    }
    expect(await authUserExists(owner)).toBe(false);
    expect(await authUserExists(guestOne.userId)).toBe(false);
    expect(await authUserExists(guestTwo.userId)).toBe(false);
    const { data: profile } = await admin.from("profiles").select("id").eq("user_id", owner);
    expect(profile).toEqual([]);

    // The purchase stays, with no one attached to it and no title.
    const { data: purchase } = await admin
      .from("purchases")
      .select("user_id, event_id, event_title, amount_cents")
      .eq("id", purchaseId)
      .single();
    expect(purchase).toEqual({
      user_id: null,
      event_id: null,
      event_title: "",
      amount_cents: 4900,
    });

    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("target_type", "user")
      .eq("target_id", owner);
    expect((audit ?? []).map((line) => line.action).sort()).toEqual([
      "account_deletion_requested",
      "account_purged",
    ]);
  });

  it("les photos qu'un organisateur a envoyées à l'événement d'un autre partent avec son compte, le reste de cet album reste", async () => {
    const leaving = await newUser();
    const other = await newUser();
    const othersEvent = await newEventOf(other, "Fête de quelqu'un d'autre");
    const leavingAsGuest = await addGuest(othersEvent.id, leaving, { display_name: "Léa" });
    const stranger = await addGuest(othersEvent.id);
    const mine = await addPhoto(othersEvent.id, leavingAsGuest.guestId);
    const theirs = await addPhoto(othersEvent.id, stranger.guestId);
    await newEventOf(leaving);

    const requestedAt = new Date();
    await requestAccountDeletion(admin, leaving, requestedAt);
    const report = await purgeDueAccounts({
      admin,
      accountBatch: 1000,
      storage,
      now: () => new Date(requestedAt.getTime() + 8 * DAY),
    });
    expect(report.purged).toContain(leaving);

    expect(await storage.head(mine.keys.key_original)).toBeNull();
    expect(await storage.head(theirs.keys.key_original)).not.toBeNull();
    const { data: remaining } = await admin
      .from("media")
      .select("id")
      .eq("event_id", othersEvent.id);
    expect(remaining).toEqual([{ id: theirs.id }]);
    expect(await eventState(othersEvent.id)).toMatchObject({ status: "active" });
    expect(await authUserExists(leaving)).toBe(false);
  });

  it("un compte qui échoue reste pour la prochaine exécution, les autres passent, rien n'est à moitié supprimé sans issue", async () => {
    const failing = await newUser();
    const fine = await newUser();
    const failingEvent = await newEventOf(failing);
    await newEventOf(fine);
    const guest = await addGuest(failingEvent.id);
    const photo = await addPhoto(failingEvent.id, guest.guestId);

    const requestedAt = new Date();
    await requestAccountDeletion(admin, failing, requestedAt);
    await requestAccountDeletion(admin, fine, requestedAt);
    const later = () => new Date(requestedAt.getTime() + 8 * DAY);

    const broken: Storage = {
      ...storage,
      deleteEventObjects: async (prefix: string) => {
        if (prefix.includes(failingEvent.id)) throw new Error("storage down");
        return storage.deleteEventObjects(prefix);
      },
    };
    const first = await purgeDueAccounts({
      admin,
      accountBatch: 1000,
      storage: broken,
      now: later,
    });
    expect(first.failed).toContain(failing);
    expect(first.purged).toContain(fine);
    expect(await authUserExists(failing)).toBe(true);
    expect(await eventState(failingEvent.id)).not.toBeNull();
    expect(await storage.head(photo.keys.key_original)).not.toBeNull();

    // The next run, with the storage back, finishes the job.
    const second = await purgeDueAccounts({ admin, accountBatch: 1000, storage, now: later });
    expect(second.purged).toContain(failing);
    expect(await authUserExists(failing)).toBe(false);
    expect(await storage.head(photo.keys.key_original)).toBeNull();
  });

  it("un compte dont la suppression n'a pas été demandée n'est jamais purgé, même avec un événement échu", async () => {
    const owner = await newUser();
    const event = await newEventOf(owner);
    const report = await purgeDueAccounts({
      admin,
      accountBatch: 1000,
      storage,
      now: () => new Date(Date.now() + 365 * DAY),
    });
    expect(report.purged).not.toContain(owner);
    expect(await authUserExists(owner)).toBe(true);
    expect(await eventState(event.id)).toMatchObject({ status: "active" });
  });
});

describe("G-004: la copie des données", () => {
  it("contient le profil, les événements, la liste des médias, les invités et les achats, sans secret ni adresse d'invité", async () => {
    const owner = await newUser();
    const event = await newEventOf(owner);
    await admin
      .from("events")
      .update({ settings: { gallery_visible: true, access_code_hash: "scrypt$secret$hash" } })
      .eq("id", event.id);
    const guest = await addGuest(event.id, undefined, {
      notify_email: "invite@example.test",
      notify_consent_at: new Date().toISOString(),
    });
    const photo = await addPhoto(event.id, guest.guestId);
    await addPurchase(owner, event.id);
    const { error: linkError } = await admin.from("share_links").insert({
      event_id: event.id,
      created_by: owner,
      token: "tok_secret_value_with_at_least_32_chars",
    });
    if (linkError) throw linkError;

    const data = await buildAccountExport(admin, { id: owner, email: "orga@example.test" });
    expect(data.format).toBe(1);
    expect(data.account).toMatchObject({ id: owner, email: "orga@example.test", language: "fr" });
    expect(data.events).toHaveLength(1);
    const exported = data.events[0]!;
    expect(exported).toMatchObject({ id: event.id, title: "Mariage de Léa et Tom", plan: "event" });
    expect(exported.settings).toMatchObject({ gallery_visible: true });
    expect(exported.guests).toMatchObject([{ firstName: "Camille", mediaCount: 1 }]);
    expect(exported.media).toHaveLength(1);
    expect(exported.media[0]).toMatchObject({ id: photo.id, kind: "photo", status: "ready" });
    expect(exported.shareLinks).toHaveLength(1);
    expect(data.purchases).toMatchObject([{ product: "event", amountCents: 4900, status: "paid" }]);

    const text = JSON.stringify(data);
    for (const secret of [
      "invite@example.test",
      "scrypt$secret$hash",
      "tok_secret_value_with_at_least_32_chars",
      photo.keys.key_original,
      "access_code_hash",
      "notify_email",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("n'inclut que les données de la personne : jamais celles d'un autre compte", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    await newEventOf(mine, "Le mien");
    await newEventOf(theirs, "Celui des autres");
    await addPurchase(theirs, (await newEventOf(await newUser(), "Un tiers")).id);

    const data = await buildAccountExport(admin, { id: mine, email: null });
    expect(data.events.map((event) => event.title)).toEqual(["Le mien"]);
    expect(data.purchases).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("Celui des autres");
  });

  it("lit plus de 1 000 médias en plusieurs pages, sans en perdre", async () => {
    const owner = await newUser();
    const event = await newEventOf(owner);
    const guest = await addGuest(event.id);
    const rows = Array.from({ length: 1037 }, () => ({
      id: randomUUID(),
      event_id: event.id,
      guest_id: guest.guestId,
      kind: "photo",
      status: "ready",
      moderation: "approved",
      sha256: randomBytes(32).toString("hex"),
      mime_type: "image/jpeg",
    }));
    for (let from = 0; from < rows.length; from += 200) {
      const { error } = await admin.from("media").insert(rows.slice(from, from + 200));
      if (error) throw error;
    }
    const data = await buildAccountExport(admin, { id: owner, email: null });
    const ids = data.events[0]!.media.map((item) => item.id);
    expect(ids).toHaveLength(1037);
    expect(new Set(ids).size).toBe(1037);
  }, 60_000);
});
