import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  cancelEventDeletion,
  getEventStats,
  requestEventDeletion,
  updateEventSettings,
} from "@/server/events";

const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const OWNER = "owner-1";
const NOW = new Date("2026-10-21T10:00:00Z");

/**
 * Fake query builder. Every step returns the chain; `maybeSingle` resolves the lookup, and
 * awaiting the chain itself resolves the update, which is how the code under test reads.
 */
function fakeClient(options: {
  lookup: { data: unknown; error?: unknown };
  update?: { data: unknown; error?: unknown };
}) {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "update", "eq"]) chain[step] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...options.lookup });
  chain.then = (resolve: (value: unknown) => void) =>
    resolve({ error: null, ...(options.update ?? { data: [{ id: EVENT_ID }] }) });
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, chain };
}

describe("F-015, F-016: réglages de l'album", () => {
  const input = {
    gallery_visible: false,
    require_approval: true,
    upload_opens_at: "2026-09-05T00:00:00.000Z",
    upload_closes_at: "2026-10-12T00:00:00.000Z",
  };

  it("F-015: enregistre les réglages sans perdre le hachage du code d'accès", async () => {
    const { client, chain } = fakeClient({
      lookup: {
        data: { id: EVENT_ID, settings: { access_code_hash: "hash", gallery_visible: true } },
      },
      update: { data: { id: EVENT_ID } },
    });
    // The update is awaited through `maybeSingle` too: give it the saved row.
    (chain.maybeSingle as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: { id: EVENT_ID, settings: { access_code_hash: "hash", gallery_visible: true } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: EVENT_ID }, error: null });

    expect((await updateEventSettings(client, EVENT_ID, input)).ok).toBe(true);
    const saved = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      settings: Record<string, unknown>;
    };
    expect(saved.settings).toEqual({ ...input, access_code_hash: "hash" });
  });

  it("F-016: refuse une fenêtre d'envoi incohérente avant toute requête", async () => {
    const { client } = fakeClient({ lookup: { data: null } });
    await expect(
      updateEventSettings(client, EVENT_ID, {
        ...input,
        upload_closes_at: "2026-09-01T00:00:00.000Z",
      }),
    ).rejects.toThrow();
    expect((client.from as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("S-001: un événement qui n'est pas à l'organisateur n'est pas modifié", async () => {
    const { client } = fakeClient({ lookup: { data: null } });
    expect(await updateEventSettings(client, EVENT_ID, input)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("R5: suppression d'un événement", () => {
  it("R5: marque l'événement en suppression en datant la demande, pour son propriétaire seulement", async () => {
    const { client, chain } = fakeClient({
      lookup: { data: { id: EVENT_ID, status: "active", deleted_at: null } },
    });
    expect(await requestEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({ ok: true });
    expect(chain.update).toHaveBeenCalledWith({
      status: "pending_deletion",
      deleted_at: NOW.toISOString(),
      deletion_reason: "user",
    });
    expect(chain.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(chain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("R5: un événement inconnu ou à un autre est introuvable", async () => {
    const { client, chain } = fakeClient({ lookup: { data: null } });
    expect(await requestEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("R5: une suppression déjà demandée ou un événement suspendu ne se redemande pas", async () => {
    for (const status of ["pending_deletion", "suspended"]) {
      const { client, chain } = fakeClient({
        lookup: { data: { id: EVENT_ID, status, deleted_at: null } },
      });
      expect(await requestEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
        ok: false,
        reason: "not_allowed",
      });
      expect(chain.update).not.toHaveBeenCalled();
    }
  });

  it("R5: deux demandes simultanées : la seconde ne change rien", async () => {
    const { client } = fakeClient({
      lookup: { data: { id: EVENT_ID, status: "active", deleted_at: null } },
      update: { data: [] },
    });
    expect(await requestEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });

  it("SPEC 9.2: un album expiré ne s'annule pas, il se récupère en payant", async () => {
    const { client, chain } = fakeClient({
      lookup: {
        data: {
          id: EVENT_ID,
          status: "pending_deletion",
          deleted_at: "2026-10-20T10:00:00Z",
          deletion_reason: "expired",
        },
      },
    });
    expect(await cancelEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("R5: annule la suppression dans le délai de 7 jours", async () => {
    const { client, chain } = fakeClient({
      lookup: {
        data: { id: EVENT_ID, status: "pending_deletion", deleted_at: "2026-10-20T10:00:00Z" },
      },
    });
    expect(await cancelEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({ ok: true });
    expect(chain.update).toHaveBeenCalledWith({
      status: "active",
      deleted_at: null,
      deletion_reason: null,
    });
    expect(chain.eq).toHaveBeenCalledWith("status", "pending_deletion");
  });

  it("R5: ne peut plus annuler une fois le délai écoulé", async () => {
    const { client, chain } = fakeClient({
      lookup: {
        data: { id: EVENT_ID, status: "pending_deletion", deleted_at: "2026-10-10T10:00:00Z" },
      },
    });
    expect(await cancelEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("R5: annuler un événement qui n'est pas à soi est impossible", async () => {
    const { client } = fakeClient({ lookup: { data: null } });
    expect(await cancelEventDeletion(client, OWNER, EVENT_ID, NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("R5: remonte une erreur de la base", async () => {
    const { client } = fakeClient({ lookup: { data: null, error: new Error("db down") } });
    await expect(requestEventDeletion(client, OWNER, EVENT_ID, NOW)).rejects.toThrow("db down");
  });
});

describe("F-018: compteurs", () => {
  it("F-018: reprend le nombre de médias et l'espace utilisé de l'événement", () => {
    expect(getEventStats({ media_count: 12, bytes_used: 3_000_000 })).toEqual({
      photos: 12,
      videos: 0,
      guests: 0,
      bytesUsed: 3_000_000,
    });
  });
});
