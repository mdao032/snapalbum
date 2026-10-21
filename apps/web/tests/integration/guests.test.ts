import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { createEvent, updateEventSettings } from "@/server/events";
import { joinEvent, type JoinDeps } from "@/server/guests";
import { createStorage } from "@/server/storage";
import { reserveUpload } from "@/server/uploads";

/**
 * Joining an event for real: the anonymous sign-in of Supabase, the guest row, the access code
 * stored hashed, and the first reservation made with that very session.
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
const bucket = `snapalbum-guests-${randomUUID().slice(0, 8)}`;

const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });
const createdUsers: string[] = [];
const createdEvents: string[] = [];

/** The real anonymous sign-in, as the join route does it. */
async function realSignIn(): ReturnType<JoinDeps["signInAnonymously"]> {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInAnonymously();
  if (error || !data.user || !data.session) return null;
  createdUsers.push(data.user.id);
  return {
    userId: data.user.id,
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    },
  };
}

const deps = (overrides: Partial<JoinDeps> = {}): JoinDeps => ({
  admin,
  signInAnonymously: realSignIn,
  verifyHuman: async () => true,
  allowCodeAttempt: async () => true,
  ...overrides,
});

async function newEvent() {
  const organiser = await admin.auth.admin.createUser({
    email: `org-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (!organiser.data.user) throw organiser.error;
  createdUsers.push(organiser.data.user.id);
  const created = await createEvent(admin, organiser.data.user.id, {
    title: "Mariage de Léa et Tom",
    eventDate: new Date().toISOString().slice(0, 10),
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return created.event;
}

beforeAll(async () => {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
});

afterAll(async () => {
  for (const id of createdEvents) await admin.from("events").delete().eq("id", id);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
}, 60_000);

describe("F-035: adhésion d'un invité, avec la vraie base", () => {
  it("ouvre une vraie session anonyme, crée l'invité, puis cet invité peut réserver une place", async () => {
    const event = await newEvent();
    const result = await joinEvent(
      deps(),
      { userId: null, ip: "198.51.100.1" },
      { eventCode: event.public_code, displayName: "Élodie" },
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.body.session?.accessToken).toBeTruthy();
    expect(result.body.displayName).toBe("Élodie");

    const { data: guest } = await admin
      .from("guests")
      .select("auth_user_id, terms_accepted_at, terms_version, blocked_at")
      .eq("id", result.body.guestId)
      .single();
    expect(guest).toMatchObject({ terms_version: "2026-10", blocked_at: null });
    expect(guest?.terms_accepted_at).toBeTruthy();

    // The same person comes back with their session: no second guest.
    const again = await joinEvent(
      deps({
        signInAnonymously: async () => {
          throw new Error("must not sign in again");
        },
      }),
      { userId: guest!.auth_user_id, ip: "198.51.100.1" },
      { eventCode: event.public_code },
    );
    expect(again).toMatchObject({
      ok: true,
      body: { guestId: result.body.guestId, session: null },
    });

    // And the guest created by joining is exactly what the reservation function expects.
    const reservation = await reserveUpload(
      {
        admin,
        storage: createStorage({
          endpoint,
          bucket,
          region: "us-east-1",
          forcePathStyle: true,
          ...credentials,
        }),
      },
      { id: guest!.auth_user_id },
      {
        eventCode: event.public_code,
        kind: "photo",
        sha256: randomBytes(32).toString("hex"),
        mimeType: "image/jpeg",
        extension: "jpg",
        bytes: 3_000_000,
        displayBytes: 4000,
        thumbBytes: 800,
        previewFormat: "webp",
      },
    );
    expect(reservation).toMatchObject({ ok: true, body: { status: "reserved" } });
    const { data: counters } = await admin
      .from("events")
      .select("media_count")
      .eq("id", event.id)
      .single();
    expect(counters?.media_count).toBe(1);
  }, 60_000);

  it("deux invités différents sont deux lignes séparées de l'événement", async () => {
    const event = await newEvent();
    const first = await joinEvent(
      deps(),
      { userId: null, ip: "x" },
      { eventCode: event.public_code },
    );
    const second = await joinEvent(
      deps(),
      { userId: null, ip: "x" },
      { eventCode: event.public_code },
    );
    if (!first.ok || !second.ok) throw new Error("join failed");
    expect(first.body.guestId).not.toBe(second.body.guestId);
    const { data } = await admin.from("guests").select("id").eq("event_id", event.id);
    expect(data).toHaveLength(2);
  }, 60_000);
});

describe("F-017, S-006: code d'accès, avec la vraie base", () => {
  it("le code enregistré par l'organisateur (haché) est exigé, vérifié, puis admet l'invité", async () => {
    const event = await newEvent();
    // The organiser saves the code through the same function the dashboard uses; the user client
    // is replaced by the admin one here (the RLS of events is tested elsewhere).
    const saved = await updateEventSettings(admin, event.id, {
      gallery_visible: true,
      require_approval: false,
      upload_opens_at: new Date(Date.now() - 86_400_000).toISOString(),
      upload_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
      access_code: "4821",
    });
    expect(saved.ok).toBe(true);
    const { data: row } = await admin.from("events").select("settings").eq("id", event.id).single();
    expect(JSON.stringify(row)).not.toContain("4821");

    const base = { userId: null, ip: "198.51.100.2" };
    expect(await joinEvent(deps(), base, { eventCode: event.public_code })).toMatchObject({
      ok: false,
      code: "access_code_required",
    });
    expect(
      await joinEvent(deps(), base, { eventCode: event.public_code, accessCode: "0000" }),
    ).toMatchObject({
      ok: false,
      code: "access_code_invalid",
    });
    const { data: none } = await admin.from("guests").select("id").eq("event_id", event.id);
    expect(none).toEqual([]);

    expect(
      await joinEvent(deps(), base, { eventCode: event.public_code, accessCode: "4821" }),
    ).toMatchObject({
      ok: true,
    });
  }, 60_000);

  it("un événement fermé (suppression demandée) n'admet plus personne", async () => {
    const event = await newEvent();
    await admin
      .from("events")
      .update({ status: "pending_deletion", deleted_at: new Date().toISOString() })
      .eq("id", event.id);
    expect(
      await joinEvent(deps(), { userId: null, ip: "x" }, { eventCode: event.public_code }),
    ).toMatchObject({
      ok: false,
      code: "event_suspended",
    });
  });
});
