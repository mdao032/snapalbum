import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createAnonymousUser,
  createConfirmedUser,
  getRows,
  insertRows,
  patchRows,
  setEventColumns,
  supabaseEndpoint,
} from "./admin";

/**
 * Phase 4 quality gate: no way to go over a quota by calling the API routes directly. Every limit
 * is the server's (`plans.ts` through `reserve_media_slot`); a client that lies, skips its own
 * checks or adds fields of its own gets the same refusals as an honest one. The database layer
 * (organisers cannot write `plan`, counters or expiry; guests cannot call the reservation function
 * nor insert media) has its own tests in `packages/db-tests`; here it is attacked over HTTP too.
 */

const MB = 1024 * 1024;
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function publicCode(): string {
  return Array.from(randomBytes(10), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

const sha = () => randomBytes(32).toString("hex");

const photo = (code: string, change: Record<string, unknown> = {}) => ({
  eventCode: code,
  kind: "photo",
  sha256: sha(),
  mimeType: "image/jpeg",
  extension: "jpg",
  bytes: 3 * MB,
  displayBytes: 4000,
  thumbBytes: 800,
  previewFormat: "webp",
  width: 4000,
  height: 3000,
  ...change,
});

const video = (code: string, change: Record<string, unknown> = {}) => ({
  eventCode: code,
  kind: "video",
  sha256: sha(),
  mimeType: "video/mp4",
  extension: "mp4",
  bytes: 5 * MB,
  thumbBytes: 800,
  previewFormat: "webp",
  durationSeconds: 10,
  ...change,
});

async function newEvent() {
  const owner = await createConfirmedUser(`quota-${Date.now()}-${sha().slice(0, 6)}@example.test`);
  const code = publicCode();
  const [event] = await insertRows("events", [
    {
      owner_id: owner,
      public_code: code,
      title: "Mariage de Léa et Tom",
      event_date: new Date().toISOString().slice(0, 10),
      type: "wedding",
      plan: "free",
      settings: {
        gallery_visible: true,
        require_approval: false,
        upload_opens_at: "2020-01-01T00:00:00.000Z",
        upload_closes_at: "2099-01-01T00:00:00.000Z",
      },
    },
  ]);
  return { id: String(event?.id), code };
}

async function newGuest(eventId: string) {
  const user = await createAnonymousUser();
  await insertRows("guests", [
    { event_id: eventId, auth_user_id: user.id, terms_accepted_at: new Date().toISOString() },
  ]);
  return user;
}

test.describe("Porte de qualité, phase 4 : aucun dépassement de quota par l'API", () => {
  test("R1: album plein, la réservation est refusée quels que soient les champs ajoutés par le client", async ({
    request,
  }) => {
    const { id, code } = await newEvent();
    const guest = await newGuest(id);
    await setEventColumns(id, { media_count: 200 });
    const headers = { Authorization: `Bearer ${guest.token}` };

    const plain = await request.post("/api/uploads/reserve", { headers, data: photo(code) });
    expect(plain.status()).toBe(409);
    expect(await plain.json()).toEqual({ error: { code: "album_full" } });

    // A client that names its own plan or limits changes nothing: the server reads the event.
    const lying = await request.post("/api/uploads/reserve", {
      headers,
      data: { ...photo(code), plan: "pro", maxMedia: 99999, max_media: 99999, p_max_media: 99999 },
    });
    expect([400, 409]).toContain(lying.status());
    if (lying.status() === 409) {
      expect(await lying.json()).toEqual({ error: { code: "album_full" } });
    }
    expect(await getRows("media", `event_id=eq.${id}`)).toEqual([]);
  });

  test("SPEC 8.2: taille et durée sont refusées côté serveur, même si le navigateur ne les a pas vérifiées", async ({
    request,
  }) => {
    const { id, code } = await newEvent();
    const guest = await newGuest(id);
    const headers = { Authorization: `Bearer ${guest.token}` };
    const post = (data: unknown) => request.post("/api/uploads/reserve", { headers, data });

    expect((await post(photo(code, { bytes: 51 * MB }))).status()).toBe(413);
    expect((await post(video(code, { bytes: 101 * MB }))).status()).toBe(413);
    const tooLong = await post(video(code, { durationSeconds: 31 }));
    expect(tooLong.status()).toBe(422);
    expect(await tooLong.json()).toEqual({ error: { code: "video_too_long" } });
    // The versions prepared by the browser have their own ceilings.
    expect((await post(photo(code, { displayBytes: 21 * MB }))).status()).toBe(413);
    expect((await post(photo(code, { thumbBytes: 2 * MB }))).status()).toBe(413);
    // A video without its duration cannot be checked, so it is not accepted.
    expect((await post(video(code, { durationSeconds: undefined }))).status()).toBe(400);
    expect(await getRows("media", `event_id=eq.${id}`)).toEqual([]);
  });

  test("R1: au plus 10 vidéos sur l'offre gratuite, la 11e est refusée", async ({ request }) => {
    const { id, code } = await newEvent();
    const guest = await newGuest(id);
    const headers = { Authorization: `Bearer ${guest.token}` };
    for (let index = 0; index < 10; index += 1) {
      const ok = await request.post("/api/uploads/reserve", { headers, data: video(code) });
      expect(ok.status()).toBe(200);
    }
    const eleventh = await request.post("/api/uploads/reserve", { headers, data: video(code) });
    expect(eleventh.status()).toBe(409);
    expect(await eleventh.json()).toEqual({ error: { code: "video_limit_reached" } });
    // Photos are not affected by the video limit.
    const next = await request.post("/api/uploads/reserve", { headers, data: photo(code) });
    expect(next.status()).toBe(200);
  });

  test("R1: des envois simultanés ne dépassent jamais la place restante", async ({ request }) => {
    const { id, code } = await newEvent();
    await setEventColumns(id, { media_count: 195 });
    const guests = await Promise.all(Array.from({ length: 12 }, () => newGuest(id)));
    const answers = await Promise.all(
      guests.map((guest) =>
        request.post("/api/uploads/reserve", {
          headers: { Authorization: `Bearer ${guest.token}` },
          data: photo(code),
        }),
      ),
    );
    const statuses = answers.map((answer) => answer.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    const [event] = await getRows("events", `id=eq.${id}&select=media_count`);
    expect(event?.media_count).toBe(200);
  });

  test("R2: l'offre gratuite ne reçoit jamais d'original ; après le passage en payant, les nouveaux envois en ont un", async ({
    request,
  }) => {
    const { id, code } = await newEvent();
    const guest = await newGuest(id);
    const headers = { Authorization: `Bearer ${guest.token}` };

    const before = await request.post("/api/uploads/reserve", {
      headers,
      data: photo(code, { bytes: 40 * MB }),
    });
    expect(before.status()).toBe(200);
    expect((await before.json()).original).toBeNull();

    await patchRows("events", `id=eq.${id}`, { plan: "event", media_count: 200 });
    const after = await request.post("/api/uploads/reserve", { headers, data: photo(code) });
    expect(after.status()).toBe(200);
    expect((await after.json()).original).not.toBeNull();

    const rows = await getRows("media", `event_id=eq.${id}&select=key_original`);
    expect(rows.filter((row) => row.key_original === null)).toHaveLength(1);
    expect(rows.filter((row) => row.key_original !== null)).toHaveLength(1);

    // The paid limits apply from now on: 3 minutes are accepted, a few seconds more are not.
    const accepted = await request.post("/api/uploads/reserve", {
      headers,
      data: video(code, { durationSeconds: 170 }),
    });
    expect(accepted.status()).toBe(200);
    const refused = await request.post("/api/uploads/reserve", {
      headers,
      data: video(code, { durationSeconds: 181 }),
    });
    expect(refused.status()).toBe(422);
  });

  test("S-001: la base refuse à un invité d'appeler la réservation, d'écrire dans les tables ou de changer l'offre", async ({
    request,
  }) => {
    const { id } = await newEvent();
    const guest = await newGuest(id);
    const { url, anonKey } = supabaseEndpoint();
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${guest.token}`,
      "Content-Type": "application/json",
    };

    const rpc = await request.post(`${url}/rest/v1/rpc/reserve_media_slot`, {
      headers,
      data: {
        p_event_id: id,
        p_user_id: guest.id,
        p_media_id: randomUUID(),
        p_sha256: sha(),
        p_kind: "photo",
        p_mime_type: "image/jpeg",
        p_bytes_original: null,
        p_bytes_display: 1000,
        p_bytes_thumb: 100,
        p_width: 10,
        p_height: 10,
        p_duration_s: null,
        p_taken_at: null,
        p_key_original: null,
        p_key_display: `events/${id}/display/x.webp`,
        p_key_thumb: `events/${id}/thumb/x.webp`,
        p_max_media: 1_000_000,
        p_max_videos: null,
      },
    });
    expect(rpc.ok()).toBe(false);

    const insert = await request.post(`${url}/rest/v1/media`, {
      headers,
      data: { event_id: id, kind: "photo", sha256: sha(), mime_type: "image/jpeg" },
    });
    expect(insert.ok()).toBe(false);

    const update = await request.patch(`${url}/rest/v1/events?id=eq.${id}`, {
      headers: { ...headers, Prefer: "return=representation" },
      data: { plan: "pro", media_count: 0 },
    });
    // Either refused, or it matches no row the guest may touch.
    if (update.ok()) expect(await update.json()).toEqual([]);

    const [event] = await getRows("events", `id=eq.${id}&select=plan,media_count`);
    expect(event).toEqual({ plan: "free", media_count: 0 });
    expect(await getRows("media", `event_id=eq.${id}`)).toEqual([]);
  });
});
