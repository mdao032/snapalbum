// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildAccountExport,
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/server/account";
import { fakeAdmin, type Row } from "./fake-admin";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-22T10:00:00Z");

describe("F-004: demander et annuler la suppression du compte", () => {
  it("la demande passe par la fonction de la base avec la date, et rend la date limite à 7 jours", async () => {
    const calls: Row[] = [];
    const admin = fakeAdmin(
      {},
      {
        request_account_deletion: (args) => {
          calls.push(args);
          return { ok: true, event_ids: ["e1", "e2"] };
        },
      },
    );
    const result = await requestAccountDeletion(admin, USER, NOW);
    expect(calls).toEqual([{ p_user_id: USER, p_now: "2026-10-22T10:00:00.000Z" }]);
    expect(result).toEqual({
      ok: true,
      deletedAt: NOW,
      purgeAt: new Date("2026-10-29T10:00:00Z"),
      eventIds: ["e1", "e2"],
    });
  });

  it("une demande refusée par la base est rendue telle quelle", async () => {
    const admin = fakeAdmin(
      {},
      { request_account_deletion: () => ({ ok: false, reason: "already_requested" }) },
    );
    expect(await requestAccountDeletion(admin, USER, NOW)).toEqual({
      ok: false,
      reason: "already_requested",
    });
  });

  it("l'annulation envoie le délai de plans.ts et rend le nombre d'événements remis", async () => {
    const calls: Row[] = [];
    const admin = fakeAdmin(
      {},
      {
        cancel_account_deletion: (args) => {
          calls.push(args);
          return { ok: true, restored: 3 };
        },
      },
    );
    expect(await cancelAccountDeletion(admin, USER, NOW)).toEqual({ ok: true, restored: 3 });
    expect(calls[0]).toMatchObject({ p_user_id: USER, p_grace_days: 7 });
  });

  it("annulation trop tardive ou sans demande : la raison est rendue", async () => {
    const late = fakeAdmin(
      {},
      { cancel_account_deletion: () => ({ ok: false, reason: "too_late" }) },
    );
    expect(await cancelAccountDeletion(late, USER, NOW)).toEqual({ ok: false, reason: "too_late" });
    const none = fakeAdmin({}, { cancel_account_deletion: () => ({ ok: false }) });
    expect(await cancelAccountDeletion(none, USER, NOW)).toEqual({
      ok: false,
      reason: "not_requested",
    });
  });
});

describe("G-004: la copie des données du compte", () => {
  const media = (count: number, eventId: string): Row[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `m${String(index).padStart(5, "0")}`,
      event_id: eventId,
      guest_id: index % 2 === 0 ? "g1" : "g2",
      kind: "photo",
      mime_type: "image/jpeg",
      status: "ready",
      moderation: "approved",
      taken_at: null,
      captured_at: "2026-10-20T20:00:00Z",
      created_at: `2026-10-20T20:${String(index % 60).padStart(2, "0")}:00Z`,
      width: 4000,
      height: 3000,
      duration_s: null,
      bytes_original: 5_000_000,
      bytes_display: 400_000,
      is_favorite: false,
      key_original: `events/${eventId}/original/secret-${index}.jpg`,
    }));

  const tables = (): Record<string, Row[]> => ({
    profiles: [
      {
        user_id: USER,
        display_name: "Léa",
        locale: "fr",
        created_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      },
    ],
    events: [
      {
        id: "e1",
        owner_id: USER,
        title: "Mariage",
        type: "wedding",
        event_date: "2026-10-20",
        locale: "fr",
        plan: "event",
        status: "active",
        deletion_reason: null,
        created_at: "2026-09-01T00:00:00Z",
        expires_at: null,
        welcome_message: "Bienvenue",
        public_code: "k7m2x9qvbr",
        settings: { gallery_visible: true, access_code_hash: "scrypt$secret" },
        media_count: 1037,
        bytes_used: 1,
      },
      {
        id: "other",
        owner_id: "someone-else",
        title: "Pas à moi",
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
    media: [...media(1037, "e1"), ...media(5, "other")],
    guests: [
      {
        id: "g1",
        event_id: "e1",
        display_name: "Camille",
        created_at: "2026-10-20T19:00:00Z",
        terms_accepted_at: "2026-10-20T19:00:01Z",
        blocked_at: null,
        notify_email: "camille@example.test",
      },
      {
        id: "g2",
        event_id: "e1",
        display_name: null,
        created_at: "2026-10-20T19:05:00Z",
        terms_accepted_at: null,
        blocked_at: null,
      },
    ],
    share_links: [
      { event_id: "e1", created_at: "2026-10-21T00:00:00Z", revoked_at: null, token: "tok_secret" },
    ],
    purchases: [
      {
        id: "p1",
        user_id: USER,
        product: "event",
        event_title: "Mariage",
        amount_cents: 4900,
        currency: "eur",
        status: "paid",
        created_at: "2026-09-05T00:00:00Z",
        refunded_at: null,
      },
      {
        id: "p2",
        user_id: "someone-else",
        product: "event",
        event_title: "Pas à moi",
        amount_cents: 1,
        currency: "eur",
        status: "paid",
        created_at: "2026-09-06T00:00:00Z",
        refunded_at: null,
      },
    ],
  });

  it("rassemble le profil, les événements, les médias en plusieurs pages, les invités et les achats", async () => {
    const data = await buildAccountExport(
      fakeAdmin(tables()),
      { id: USER, email: "lea@example.test" },
      NOW,
    );
    expect(data).toMatchObject({
      format: 1,
      exportedAt: "2026-10-22T10:00:00.000Z",
      account: { id: USER, email: "lea@example.test", displayName: "Léa", language: "fr" },
    });
    expect(data.events).toHaveLength(1);
    const event = data.events[0]!;
    expect(event).toMatchObject({ id: "e1", title: "Mariage", date: "2026-10-20", plan: "event" });
    // 1 037 rows are read in three pages of at most 500, none lost, none twice.
    expect(event.media).toHaveLength(1037);
    expect(new Set(event.media.map((item) => item.id)).size).toBe(1037);
    expect(event.media[0]).toMatchObject({
      kind: "photo",
      bytesOriginal: 5_000_000,
      takenAt: "2026-10-20T20:00:00Z",
    });
    expect(event.guests).toEqual([
      expect.objectContaining({ id: "g1", firstName: "Camille", mediaCount: 519 }),
      expect.objectContaining({ id: "g2", firstName: null, mediaCount: 518 }),
    ]);
    expect(event.shareLinks).toEqual([{ createdAt: "2026-10-21T00:00:00Z", revokedAt: null }]);
    expect(data.purchases).toEqual([expect.objectContaining({ id: "p1", amountCents: 4900 })]);
  });

  it("S-001: jamais de secret, d'adresse ou de fichier d'un autre", async () => {
    const data = await buildAccountExport(fakeAdmin(tables()), { id: USER, email: null }, NOW);
    const text = JSON.stringify(data);
    for (const secret of [
      "scrypt$secret",
      "access_code_hash",
      "camille@example.test",
      "notify_email",
      "tok_secret",
      "secret-0.jpg",
      "Pas à moi",
      "someone-else",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(data.events[0]?.settings).toEqual({ gallery_visible: true });
    expect(data.account.email).toBeNull();
  });

  it("un compte sans événement ni achat donne une copie vide mais valide", async () => {
    const data = await buildAccountExport(
      fakeAdmin({ profiles: [], events: [], purchases: [] }),
      { id: USER },
      NOW,
    );
    expect(data.events).toEqual([]);
    expect(data.purchases).toEqual([]);
    expect(data.account).toMatchObject({
      id: USER,
      email: null,
      displayName: null,
      language: "fr",
    });
  });
});
