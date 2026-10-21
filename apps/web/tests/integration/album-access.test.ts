import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { notifyRequestSchema } from "@snapalbum/shared";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { countNotifyGuests, createEvent, getPublicEvent, markAlbumReady } from "@/server/events";
import { getGuestOfEvent, setNotifyEmail } from "@/server/guests";

/**
 * Album access after the event against the real local database: which phase the page offers
 * (F-043), the e-mail a guest leaves (F-044) and the organiser declaring the album ready (F-044).
 * Needs `pnpm db:start`.
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
const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
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
    email: `album-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return data.user.id;
}

async function newEvent(eventDate = new Date().toISOString().slice(0, 10)) {
  const owner = await newUser();
  const created = await createEvent(admin, owner, {
    title: "Mariage de Léa et Tom",
    eventDate,
    type: "wedding",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return { event: created.event, owner };
}

async function newGuest(eventId: string) {
  const userId = await newUser({ anonymous: true });
  const { error } = await admin.from("guests").insert({
    event_id: eventId,
    auth_user_id: userId,
    terms_accepted_at: new Date().toISOString(),
  });
  if (error) throw error;
  return userId;
}

afterAll(async () => {
  for (const id of createdEvents) await admin.from("events").delete().eq("id", id);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
}, 60_000);

describe("F-043: la phase de la page de l'événement, avec la vraie base", () => {
  it("F-043: un événement d'aujourd'hui est en cours, un événement d'il y a une semaine est « après », un ancien est terminé", async () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = (await newEvent(day(0))).event;
    const lastWeek = (await newEvent(day(-7))).event;
    const longAgo = (await newEvent(day(-60))).event;
    const nextMonth = (await newEvent(day(30))).event;

    const phase = async (code: string) => (await getPublicEvent(admin, code))?.phase;
    expect(await phase(today.public_code)).toBe("live");
    expect(await phase(lastWeek.public_code)).toBe("after");
    expect(await phase(longAgo.public_code)).toBe("closed");
    expect(await phase(nextMonth.public_code)).toBe("soon");
  });
});

describe("F-044: l'e-mail laissé par un invité", () => {
  const set = (code: string, email: string) =>
    notifyRequestSchema.parse({ action: "set", eventCode: code, email, consent: true });

  it("F-044: l'adresse et la date du consentement sont enregistrées, puis effacées ensemble", async () => {
    const { event } = await newEvent();
    const user = await newGuest(event.id);

    const saved = await setNotifyEmail(
      admin,
      { id: user },
      set(event.public_code, "Anna@Example.com"),
    );
    expect(saved).toEqual({ ok: true, body: { action: "set", email: "anna@example.com" } });
    const { data } = await admin
      .from("guests")
      .select("notify_email, notify_consent_at")
      .eq("auth_user_id", user)
      .single();
    expect(data?.notify_email).toBe("anna@example.com");
    expect(Math.abs(Date.parse(data!.notify_consent_at!) - Date.now())).toBeLessThan(60_000);
    expect((await getGuestOfEvent(admin, event.id, user))?.notifyEmail).toBe("anna@example.com");
    expect(await countNotifyGuests(admin, event.id)).toBe(1);

    const cleared = await setNotifyEmail(
      admin,
      { id: user },
      notifyRequestSchema.parse({ action: "clear", eventCode: event.public_code }),
    );
    expect(cleared).toEqual({ ok: true, body: { action: "clear" } });
    const { data: after } = await admin
      .from("guests")
      .select("notify_email, notify_consent_at")
      .eq("auth_user_id", user)
      .single();
    expect(after).toEqual({ notify_email: null, notify_consent_at: null });
    expect(await countNotifyGuests(admin, event.id)).toBe(0);
  });

  it("F-044, S-001: quelqu'un qui n'a pas participé ne peut pas enregistrer d'adresse", async () => {
    const { event } = await newEvent();
    const stranger = await newUser({ anonymous: true });
    expect(
      await setNotifyEmail(admin, { id: stranger }, set(event.public_code, "a@example.com")),
    ).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
    });
  });

  it("F-044: deux invités laissent chacun leur adresse, le compte les distingue des invités sans adresse", async () => {
    const { event } = await newEvent();
    const first = await newGuest(event.id);
    const second = await newGuest(event.id);
    await newGuest(event.id);
    await setNotifyEmail(admin, { id: first }, set(event.public_code, "a@example.com"));
    await setNotifyEmail(admin, { id: second }, set(event.public_code, "b@example.com"));
    expect(await countNotifyGuests(admin, event.id)).toBe(2);
  });
});

describe("F-044: l'organisateur déclare l'album prêt, une seule fois", () => {
  it("F-044: l'instant est conservé dans les réglages, sans toucher aux autres", async () => {
    const { event, owner } = await newEvent();
    const first = await markAlbumReady(admin, owner, event.id);
    if (!first.ok) throw new Error("refused");
    expect(first.alreadyReady).toBe(false);

    const { data } = await admin.from("events").select("settings").eq("id", event.id).single();
    expect(data?.settings).toMatchObject({
      gallery_visible: true,
      album_ready_at: first.readyAt,
    });
    expect(await markAlbumReady(admin, owner, event.id)).toEqual({
      ok: true,
      readyAt: first.readyAt,
      alreadyReady: true,
    });
  });

  it("F-044: deux déclarations simultanées s'accordent sur un seul instant", async () => {
    const { event, owner } = await newEvent();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => markAlbumReady(admin, owner, event.id)),
    );
    const moments = new Set(results.map((result) => (result.ok ? result.readyAt : "refused")));
    expect(moments.size).toBe(1);
    expect(results.filter((result) => result.ok && !result.alreadyReady)).toHaveLength(1);
  });

  it("F-044, S-001: un autre organisateur ne peut pas déclarer l'album prêt", async () => {
    const { event } = await newEvent();
    const stranger = await newUser();
    expect(await markAlbumReady(admin, stranger, event.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    const { data } = await admin.from("events").select("settings").eq("id", event.id).single();
    expect(data?.settings).not.toHaveProperty("album_ready_at");
  });
});
