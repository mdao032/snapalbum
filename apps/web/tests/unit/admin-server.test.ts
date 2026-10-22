// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mailer, OutgoingEmail } from "@/server/email/mailer";
import {
  adminOverview,
  checkStorageAlert,
  extendEvent,
  getAdminEvent,
  listAdminEvents,
  listAdminOrganisers,
  listAdminPurchases,
  listOpenReports,
  pageOffset,
  setEventSuspended,
} from "@/server/admin";
import { moderateMedia, dismissReports } from "@/server/moderation";
import type { Storage } from "@/server/storage";
import { fakeAdmin, type Row } from "./fake-admin";

const ADMIN = "0aaaaaaa-1111-4111-8111-111111111111";
const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const GB = 1024 ** 3;
const NOW = new Date("2026-10-22T10:00:00Z");

describe("F-090: pages des listes", () => {
  it("la page 1 commence à 0, les autres par pas de 25, tout le reste est la page 1", () => {
    expect(pageOffset(1)).toBe(0);
    expect(pageOffset(3)).toBe(50);
    for (const odd of [0, -4, 1.5, Number.NaN, 1_000_000]) expect(pageOffset(odd)).toBe(0);
  });

  it("les listes envoient la recherche (tronquée), la taille et le décalage de page", async () => {
    const calls: Record<string, Row> = {};
    const record = (name: string) => (args: Row) => {
      calls[name] = args;
      return { total: 0, rows: [] };
    };
    const admin = fakeAdmin(
      {},
      {
        admin_list_events: record("events"),
        admin_list_organisers: record("organisers"),
        admin_list_purchases: record("purchases"),
        admin_overview: (args) => {
          calls.overview = args;
          return { events_total: 4 };
        },
      },
    );
    await listAdminEvents(admin, "x".repeat(300), 2);
    await listAdminOrganisers(admin, "", 1);
    await listAdminPurchases(admin, 3);
    expect(calls.events).toEqual({ p_query: "x".repeat(100), p_limit: 25, p_offset: 25 });
    expect(calls.organisers).toEqual({ p_query: null, p_limit: 25, p_offset: 0 });
    expect(calls.purchases).toEqual({ p_limit: 25, p_offset: 50 });
    expect((await adminOverview(admin, NOW)).events_total).toBe(4);
    expect(calls.overview).toEqual({ p_now: "2026-10-22T10:00:00.000Z" });
  });
});

describe("F-091: suspendre et prolonger", () => {
  it("rendent ok ou « pas possible » selon la réponse de la base, avec l'administrateur et les mois", async () => {
    const seen: Row[] = [];
    const admin = fakeAdmin(
      {},
      {
        admin_set_event_suspended: (args) => {
          seen.push(args);
          return { ok: args.p_suspended === true };
        },
        admin_extend_event: (args) => {
          seen.push(args);
          return { ok: args.p_months === 3 };
        },
      },
    );
    expect(await setEventSuspended(admin, ADMIN, EVENT, true)).toEqual({ ok: true });
    expect(await setEventSuspended(admin, ADMIN, EVENT, false)).toEqual({
      ok: false,
      reason: "not_possible",
    });
    expect(await extendEvent(admin, ADMIN, EVENT, 3, NOW)).toEqual({ ok: true });
    expect(await extendEvent(admin, ADMIN, EVENT, 6, NOW)).toEqual({
      ok: false,
      reason: "not_possible",
    });
    expect(seen[0]).toEqual({ p_event_id: EVENT, p_suspended: true, p_actor: ADMIN });
    expect(seen[2]).toEqual({
      p_event_id: EVENT,
      p_months: 3,
      p_actor: ADMIN,
      p_now: "2026-10-22T10:00:00.000Z",
    });
  });
});

/** A client whose `reports` query returns scripted rows, like the join the real one makes. */
function reportsClient(rows: Row[], extra: Record<string, unknown> = {}) {
  const query = {
    select: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return { from: () => query, ...extra } as unknown as SupabaseClient;
}

const storage = {
  presignRead: vi.fn(async (key: string) => `https://signed.test/${key}`),
  deleteObject: vi.fn(async () => undefined),
} as unknown as Storage;

const report = (mediaId: string, reason: string, at: string, status = "ready"): Row => ({
  media_id: mediaId,
  reason,
  created_at: at,
  media: {
    event_id: EVENT,
    kind: "photo",
    status,
    key_thumb: `events/${EVENT}/thumb/${mediaId}.webp`,
    key_display: null,
    events: { title: "Mariage" },
  },
});

describe("F-090: signalements ouverts", () => {
  it("regroupe par média : nombre, motifs sans doublon, premier signalement, aperçu signé", async () => {
    const client = reportsClient([
      report("m1", "other", "2026-10-20T10:00:00Z"),
      report("m2", "private", "2026-10-21T10:00:00Z"),
      report("m1", "inappropriate", "2026-10-21T11:00:00Z"),
      report("m1", "other", "2026-10-21T12:00:00Z"),
    ]);
    const result = await listOpenReports(client, storage);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      mediaId: "m1",
      eventTitle: "Mariage",
      count: 3,
      reasons: ["other", "inappropriate"],
      firstReportedAt: "2026-10-20T10:00:00Z",
      thumbUrl: `https://signed.test/events/${EVENT}/thumb/m1.webp`,
    });
    expect(result[1]).toMatchObject({ mediaId: "m2", count: 1 });
  });

  it("un média supprimé n'a plus d'aperçu, une adresse qui échoue non plus", async () => {
    const failing = {
      presignRead: vi.fn(async () => {
        throw new Error("storage down");
      }),
    } as unknown as Storage;
    const gone = await listOpenReports(
      reportsClient([report("m1", "other", "2026-10-20T10:00:00Z", "deleted")]),
      storage,
    );
    expect(gone[0]?.thumbUrl).toBeNull();
    const down = await listOpenReports(
      reportsClient([report("m1", "other", "2026-10-20T10:00:00Z")]),
      failing,
    );
    expect(down[0]?.thumbUrl).toBeNull();
  });

  it("filtre sur un événement quand on le demande", async () => {
    const client = reportsClient([]);
    expect(await listOpenReports(client, storage, EVENT)).toEqual([]);
  });

  it("l'événement détaillé rassemble l'organisateur, les achats et les signalements, ou rien s'il n'existe pas", async () => {
    const eventRow = { id: EVENT, owner_id: "owner-1", title: "Mariage", status: "active" };
    const query = (data: unknown) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data, error: null }),
      };
      return chain;
    };
    const client = (event: unknown) =>
      ({
        from: (table: string) =>
          table === "events"
            ? query(event)
            : table === "purchases"
              ? query([{ id: "p1" }])
              : query([]),
        auth: {
          admin: { getUserById: async () => ({ data: { user: { email: "o@example.test" } } }) },
        },
      }) as unknown as SupabaseClient;

    const found = await getAdminEvent(client(eventRow), storage, EVENT);
    expect(found).toMatchObject({
      event: { id: EVENT },
      ownerEmail: "o@example.test",
      purchases: [{ id: "p1" }],
      reports: [],
    });
    expect(await getAdminEvent(client(null), storage, EVENT)).toBeNull();
  });
});

describe("SPEC 9.3: alerte de stockage", () => {
  function setup(options: {
    totalBytes: number;
    thresholdBytes: number | null;
    lastAlertAt?: string;
    contacts?: { email: string; locale: string }[];
  }) {
    const audit: Row[] = options.lastAlertAt
      ? [{ action: "admin.storage_alert", created_at: options.lastAlertAt }]
      : [];
    const admin = fakeAdmin(
      { audit_log: audit },
      {
        admin_overview: () => ({ bytes_total: options.totalBytes }),
        admin_contacts: () =>
          options.contacts ?? [
            { email: "dao@example.test", locale: "fr" },
            { email: "ops@example.test", locale: "en" },
          ],
      },
    );
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
    return {
      audit,
      sent,
      run: () =>
        checkStorageAlert({
          admin,
          mailer,
          thresholdBytes: options.thresholdBytes,
          now: () => NOW,
        }),
    };
  }

  it("sans seuil configuré, rien n'est lu ni envoyé", async () => {
    const { run, sent, audit } = setup({ totalBytes: 900 * GB, thresholdBytes: null });
    expect(await run()).toBe("no_threshold");
    expect(sent).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("au-dessus du seuil : une trace, puis un e-mail à chaque administrateur dans sa langue", async () => {
    const { run, sent, audit } = setup({ totalBytes: 600 * GB, thresholdBytes: 500 * GB });
    expect(await run()).toBe("sent");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "admin.storage_alert",
      target_type: "platform",
      metadata: { bytes: 600 * GB, threshold: 500 * GB },
    });
    expect(sent.map((email) => email.to)).toEqual(["dao@example.test", "ops@example.test"]);
    expect(sent[0]?.subject).toBe("Le stockage dépasse le seuil");
    expect(sent[1]?.subject).toBe("Storage is over the threshold");
    expect(sent[0]?.text).toContain("/admin");
  });

  it("sous le seuil, ou si une alerte est partie il y a moins de 7 jours : rien", async () => {
    expect(await setup({ totalBytes: 100 * GB, thresholdBytes: 500 * GB }).run()).toBe("skipped");
    const recent = setup({
      totalBytes: 600 * GB,
      thresholdBytes: 500 * GB,
      lastAlertAt: "2026-10-20T10:00:00Z",
    });
    expect(await recent.run()).toBe("skipped");
    expect(recent.sent).toEqual([]);
  });

  it("sans administrateur à joindre, rien n'est écrit ni envoyé", async () => {
    const { run, sent, audit } = setup({
      totalBytes: 600 * GB,
      thresholdBytes: 500 * GB,
      contacts: [],
    });
    expect(await run()).toBe("skipped");
    expect(sent).toEqual([]);
    expect(audit).toEqual([]);
  });
});

describe("F-091: la modération par l'administrateur", () => {
  const OWNER = "0bbbbbbb-2222-4222-8222-222222222222";
  const MEDIA = "00000000-0000-4000-8000-000000000001";

  function world(status: string) {
    const tables: Record<string, Row[]> = {
      events: [{ id: EVENT, owner_id: OWNER, status }],
      media: [
        {
          id: MEDIA,
          event_id: EVENT,
          status: "ready",
          key_original: "o.jpg",
          key_display: "d.webp",
          key_thumb: "t.webp",
        },
      ],
      reports: [{ id: "r1", media_id: MEDIA, resolved_at: null }],
      audit_log: [],
    };
    const deps = { admin: fakeAdmin(tables), storage, now: () => NOW };
    return { tables, deps };
  }

  it("agit sur un événement suspendu qui n'est pas le sien, et la trace le dit", async () => {
    const { tables, deps } = world("suspended");
    const result = await moderateMedia({ ...deps, asAdmin: true }, ADMIN, EVENT, "delete", [MEDIA]);
    expect(result).toEqual({ ok: true, body: { changed: 1 } });
    expect(tables.media![0]!.status).toBe("deleted");
    expect(tables.reports![0]!.resolved_at).toBe("2026-10-22T10:00:00.000Z");
    expect(tables.audit_log![0]).toMatchObject({ actor_id: ADMIN, action: "admin.media.delete" });
  });

  it("sans le droit d'administrateur, le même geste est refusé : ni propriétaire, ni événement actif", async () => {
    const { tables, deps } = world("suspended");
    const refused = await moderateMedia(deps, ADMIN, EVENT, "delete", [MEDIA]);
    expect(refused).toMatchObject({ ok: false, status: 404 });
    expect(tables.media![0]!.status).toBe("ready");
  });

  it("ignorer les signalements passe aussi par l'administrateur", async () => {
    const { tables, deps } = world("active");
    const result = await dismissReports({ ...deps, asAdmin: true }, ADMIN, EVENT, [MEDIA]);
    expect(result).toEqual({ ok: true, body: { changed: 1 } });
    expect(tables.reports![0]!.resolved_at).not.toBeNull();
  });

  it("un événement qui n'existe pas reste introuvable, même pour l'administrateur", async () => {
    const { deps } = world("active");
    const missing = "3f2b8c1e-5d4a-4b7e-9c1d-000000000000";
    expect(
      await moderateMedia({ ...deps, asAdmin: true }, ADMIN, missing, "hide", [MEDIA]),
    ).toMatchObject({ ok: false, status: 404 });
  });
});
