import { notifyRequestSchema } from "@snapalbum/shared";
import { describe, expect, it } from "vitest";
import { countNotifyGuests, getPublicEvent, markAlbumReady } from "@/server/events";
import { getGuestOfEvent, setNotifyEmail } from "@/server/guests";
import { fakeAdmin, type Row } from "./fake-admin";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const GUEST_USER = "0bbbbbbb-2222-4222-8222-222222222222";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const CODE = "k7m2x9qvbr";
const NOW = new Date("2026-10-21T10:00:00Z");

const eventRow = (overrides: Row = {}): Row => ({
  id: EVENT,
  public_code: CODE,
  title: "Mariage de Léa et Tom",
  welcome_message: null,
  accent_color: null,
  locale: "fr",
  status: "active",
  expires_at: null,
  plan: "free",
  event_date: "2026-09-12",
  settings: {
    gallery_visible: true,
    require_approval: false,
    upload_opens_at: "2026-09-05T00:00:00.000Z",
    upload_closes_at: "2026-10-12T00:00:00.000Z",
  },
  ...overrides,
});

const guestRow = (overrides: Row = {}): Row => ({
  id: "guest-1",
  event_id: EVENT,
  auth_user_id: GUEST_USER,
  blocked_at: null,
  display_name: "Anna",
  notify_email: null,
  notify_consent_at: null,
  ...overrides,
});

const set = (email: string) =>
  notifyRequestSchema.parse({ action: "set", eventCode: CODE, email, consent: true });
const clear = notifyRequestSchema.parse({ action: "clear", eventCode: CODE });

describe("F-044: l'e-mail laissé pour recevoir le lien de l'album", () => {
  it("F-044: enregistre l'adresse avec la date du consentement, pour l'invité seulement", async () => {
    const tables = {
      events: [eventRow()],
      guests: [guestRow(), guestRow({ id: "guest-2", auth_user_id: STRANGER })],
    };
    const result = await setNotifyEmail(
      fakeAdmin(tables),
      { id: GUEST_USER },
      set(" Anna@Example.com "),
      NOW,
    );

    expect(result).toEqual({ ok: true, body: { action: "set", email: "anna@example.com" } });
    expect(tables.guests[0]).toMatchObject({
      notify_email: "anna@example.com",
      notify_consent_at: "2026-10-21T10:00:00.000Z",
    });
    // Another guest of the same event is untouched.
    expect(tables.guests[1]).toMatchObject({ notify_email: null, notify_consent_at: null });
  });

  it("F-044: retirer l'adresse efface l'adresse et le consentement", async () => {
    const tables = {
      events: [eventRow()],
      guests: [
        guestRow({ notify_email: "anna@example.com", notify_consent_at: "2026-10-20T10:00:00Z" }),
      ],
    };
    const result = await setNotifyEmail(fakeAdmin(tables), { id: GUEST_USER }, clear, NOW);
    expect(result).toEqual({ ok: true, body: { action: "clear" } });
    expect(tables.guests[0]).toMatchObject({ notify_email: null, notify_consent_at: null });
  });

  it.each([
    ["quelqu'un qui n'a pas participé", { id: STRANGER }, {}, 403, "forbidden"],
    [
      "un invité bloqué",
      { id: GUEST_USER },
      { guests: [guestRow({ blocked_at: "2026-10-01T00:00:00Z" })] },
      403,
      "forbidden",
    ],
    [
      "un événement suspendu",
      { id: GUEST_USER },
      { events: [eventRow({ status: "suspended" })] },
      404,
      "not_found",
    ],
  ] as const)("F-044, S-001: refuse %s", async (_name, user, extra, status, code) => {
    const tables = { events: [eventRow()], guests: [guestRow()], ...extra } as Record<
      string,
      Row[]
    >;
    const result = await setNotifyEmail(fakeAdmin(tables), user, set("anna@example.com"), NOW);
    expect(result).toEqual({ ok: false, status, code });
    expect(tables.guests![0]).toMatchObject({ notify_email: null });
  });

  it("F-044: un code d'événement inconnu est introuvable", async () => {
    const result = await setNotifyEmail(
      fakeAdmin({ events: [eventRow()], guests: [guestRow()] }),
      { id: GUEST_USER },
      notifyRequestSchema.parse({ action: "clear", eventCode: "2222222222" }),
      NOW,
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("F-044: l'invité retrouve son adresse, mais seulement si le consentement est enregistré", async () => {
    const withConsent = fakeAdmin({
      events: [],
      guests: [
        guestRow({ notify_email: "anna@example.com", notify_consent_at: "2026-10-20T10:00:00Z" }),
      ],
    });
    expect(await getGuestOfEvent(withConsent, EVENT, GUEST_USER)).toEqual({
      id: "guest-1",
      displayName: "Anna",
      notifyEmail: "anna@example.com",
    });
    const withoutConsent = fakeAdmin({
      events: [],
      guests: [guestRow({ notify_email: "anna@example.com", notify_consent_at: null })],
    });
    expect((await getGuestOfEvent(withoutConsent, EVENT, GUEST_USER))?.notifyEmail).toBeNull();
    expect(await getGuestOfEvent(withConsent, EVENT, STRANGER)).toBeNull();
  });

  it("F-044: l'organisateur ne voit que le nombre d'invités qui attendent le lien, avec consentement", async () => {
    const admin = fakeAdmin({
      events: [],
      guests: [
        guestRow({
          id: "g1",
          notify_email: "a@example.com",
          notify_consent_at: "2026-10-20T10:00:00Z",
        }),
        guestRow({
          id: "g2",
          notify_email: "b@example.com",
          notify_consent_at: "2026-10-20T10:00:00Z",
        }),
        guestRow({ id: "g3", notify_email: "c@example.com", notify_consent_at: null }),
        guestRow({ id: "g4" }),
        guestRow({
          id: "g5",
          event_id: "autre",
          notify_email: "d@example.com",
          notify_consent_at: "2026-10-20T10:00:00Z",
        }),
      ],
    });
    expect(await countNotifyGuests(admin, EVENT)).toBe(2);
  });

  it("F-044: déclarer l'album prêt donne l'instant renvoyé par la base, et dit s'il l'était déjà", async () => {
    const calls: unknown[] = [];
    const admin = fakeAdmin(
      {},
      {
        mark_album_ready: (args) => {
          calls.push(args);
          return args.p_owner_id === OWNER
            ? { ok: true, ready_at: "2026-10-21T10:00:00.000Z", already: false }
            : { ok: false };
        },
      },
    );
    expect(await markAlbumReady(admin, OWNER, EVENT)).toEqual({
      ok: true,
      readyAt: "2026-10-21T10:00:00.000Z",
      alreadyReady: false,
    });
    expect(calls).toEqual([{ p_event_id: EVENT, p_owner_id: OWNER }]);
    expect(await markAlbumReady(admin, STRANGER, EVENT)).toEqual({
      ok: false,
      reason: "not_found",
    });

    const already = fakeAdmin(
      {},
      {
        mark_album_ready: () => ({ ok: true, ready_at: "2026-10-20T10:00:00.000Z", already: true }),
      },
    );
    expect(await markAlbumReady(already, OWNER, EVENT)).toMatchObject({ alreadyReady: true });
  });
});

describe("F-043: la page de l'événement selon le moment", () => {
  const phaseAt = async (iso: string, settings?: Row) => {
    const admin = fakeAdmin({ events: [eventRow(settings ? { settings } : {})] });
    return (await getPublicEvent(admin, CODE, new Date(iso)))?.phase;
  };

  it("F-043: bientôt, pendant la fête, après la fête, envois terminés", async () => {
    expect(await phaseAt("2026-09-01T10:00:00Z")).toBe("soon");
    expect(await phaseAt("2026-09-12T20:00:00Z")).toBe("live");
    expect(await phaseAt("2026-09-20T10:00:00Z")).toBe("after");
    expect(await phaseAt("2026-10-20T10:00:00Z")).toBe("closed");
  });

  it("F-043, F-044: l'album déclaré prêt fait passer la page à « après » avant la fin de la fête", async () => {
    const settings = {
      gallery_visible: true,
      require_approval: false,
      upload_opens_at: "2026-09-05T00:00:00.000Z",
      upload_closes_at: "2026-10-12T00:00:00.000Z",
      album_ready_at: "2026-09-12T22:00:00.000Z",
    };
    expect(await phaseAt("2026-09-12T21:00:00Z", settings)).toBe("live");
    expect(await phaseAt("2026-09-12T23:00:00Z", settings)).toBe("after");
  });

  it("F-043: des réglages illisibles ferment les envois, comme le fait la base", async () => {
    expect(await phaseAt("2026-09-12T20:00:00Z", { gallery_visible: true })).toBe("closed");
    expect(
      await phaseAt("2026-09-12T20:00:00Z", {
        gallery_visible: true,
        require_approval: false,
        upload_opens_at: "2026-10-12T00:00:00.000Z",
        upload_closes_at: "2026-09-05T00:00:00.000Z",
      }),
    ).toBe("closed");
  });

  it("F-043: la date de l'événement ne sort jamais vers le navigateur", async () => {
    const admin = fakeAdmin({ events: [eventRow()] });
    const event = await getPublicEvent(admin, CODE, NOW);
    expect(event).not.toHaveProperty("event_date");
    expect(event).not.toHaveProperty("settings");
  });
});
