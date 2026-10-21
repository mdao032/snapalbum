import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createEvent, listOwnEvents } from "@/server/events";

const OWNER = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const input = {
  title: "Mariage de Léa et Tom",
  eventDate: "2026-09-12",
  type: "wedding" as const,
  locale: "fr" as const,
};
const NOW = new Date("2026-08-01T10:00:00Z");

type InsertResult = { data: unknown; error: { code: string; message: string } | null };

/** Minimal fake of the Supabase query builder: enough to drive `createEvent`. */
function fakeAdmin(options: { activeFreeEvents: number; inserts?: InsertResult[] }) {
  const inserted: Record<string, unknown>[] = [];
  const countQuery = {
    eq: vi.fn(() => countQuery),
    or: vi.fn(() => Promise.resolve({ count: options.activeFreeEvents, error: null })),
  };
  const results = [...(options.inserts ?? [])];
  const from = vi.fn(() => ({
    select: vi.fn(() => countQuery),
    insert: vi.fn((row: Record<string, unknown>) => {
      inserted.push(row);
      return {
        select: () => ({
          single: () =>
            Promise.resolve(results.shift() ?? { data: { id: "event-id", ...row }, error: null }),
        }),
      };
    }),
  }));
  return { client: { from } as unknown as SupabaseClient, inserted, countQuery, from };
}

describe("F-010: création d'événement côté serveur", () => {
  it("F-010: crée un événement gratuit avec réglages par défaut et expiration (section 3)", async () => {
    const { client, inserted } = fakeAdmin({ activeFreeEvents: 0 });
    const result = await createEvent(client, OWNER, input, NOW);

    expect(result.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      owner_id: OWNER,
      title: "Mariage de Léa et Tom",
      plan: "free",
      expires_at: "2026-10-13T00:00:00.000Z",
      settings: { gallery_visible: true, require_approval: false },
      welcome_message: null,
      accent_color: null,
    });
  });

  it("F-012: génère un code public valide", async () => {
    const { client, inserted } = fakeAdmin({ activeFreeEvents: 0 });
    await createEvent(client, OWNER, input, NOW);
    expect(inserted[0]?.public_code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
  });

  it("plans.ts: refuse un second événement gratuit actif", async () => {
    const { client, inserted } = fakeAdmin({ activeFreeEvents: 1 });
    const result = await createEvent(client, OWNER, input, NOW);
    expect(result).toEqual({ ok: false, reason: "free_event_limit" });
    expect(inserted).toHaveLength(0);
  });

  it("ne compte que les événements gratuits, actifs et non expirés du même organisateur", async () => {
    const { client, countQuery } = fakeAdmin({ activeFreeEvents: 0 });
    await createEvent(client, OWNER, input, NOW);
    expect(countQuery.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(countQuery.eq).toHaveBeenCalledWith("plan", "free");
    expect(countQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(countQuery.or).toHaveBeenCalledWith(
      `expires_at.is.null,expires_at.gt.${NOW.toISOString()}`,
    );
  });

  it("F-011: assombrit une couleur d'accent illisible avant de l'enregistrer", async () => {
    const { client, inserted } = fakeAdmin({ activeFreeEvents: 0 });
    await createEvent(client, OWNER, { ...input, accentColor: "#ffeb3b" }, NOW);
    expect(inserted[0]?.accent_color).not.toBe("#ffeb3b");
    expect(inserted[0]?.accent_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("F-011: conserve le message d'accueil saisi", async () => {
    const { client, inserted } = fakeAdmin({ activeFreeEvents: 0 });
    await createEvent(client, OWNER, { ...input, welcomeMessage: "Bienvenue !" }, NOW);
    expect(inserted[0]?.welcome_message).toBe("Bienvenue !");
  });

  it("NF-043: refuse des données invalides", async () => {
    const { client } = fakeAdmin({ activeFreeEvents: 0 });
    await expect(createEvent(client, OWNER, { ...input, title: "  " }, NOW)).rejects.toThrow();
  });

  it("F-012: retente avec un autre code en cas de collision", async () => {
    const collision: InsertResult = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates "events_public_code_key" public_code',
      },
    };
    const { client, inserted } = fakeAdmin({
      activeFreeEvents: 0,
      inserts: [collision, collision],
    });
    const result = await createEvent(client, OWNER, input, NOW);
    expect(result.ok).toBe(true);
    expect(inserted).toHaveLength(3);
    expect(new Set(inserted.map((row) => row.public_code)).size).toBe(3);
  });

  it("F-012: abandonne après plusieurs collisions successives", async () => {
    const collision: InsertResult = {
      data: null,
      error: { code: "23505", message: "duplicate key public_code" },
    };
    const { client } = fakeAdmin({ activeFreeEvents: 0, inserts: Array(5).fill(collision) });
    await expect(createEvent(client, OWNER, input, NOW)).rejects.toThrow(/unique public code/);
  });

  it("remonte telle quelle une erreur qui n'est pas une collision de code", async () => {
    const failure: InsertResult = {
      data: null,
      error: { code: "42501", message: "permission denied" },
    };
    const { client } = fakeAdmin({ activeFreeEvents: 0, inserts: [failure] });
    await expect(createEvent(client, OWNER, input, NOW)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("liste des événements", () => {
  it("renvoie les événements du client (la RLS limite déjà les lignes)", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const client = {
      from: () => ({
        select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    } as unknown as SupabaseClient;
    await expect(listOwnEvents(client)).resolves.toEqual(rows);
  });

  it("remonte une erreur de lecture", async () => {
    const client = {
      from: () => ({
        select: () => ({ order: () => Promise.resolve({ data: null, error: new Error("boom") }) }),
      }),
    } as unknown as SupabaseClient;
    await expect(listOwnEvents(client)).rejects.toThrow("boom");
  });
});
