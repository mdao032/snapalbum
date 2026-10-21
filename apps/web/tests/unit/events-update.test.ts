import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getOwnEvent, getPublicEvent, updateEventPresentation } from "@/server/events";

const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";

/** Fake query builder: every step returns the chain, `maybeSingle` resolves the result. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "update", "eq"]) chain[step] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, chain, from };
}

const input = {
  title: " Mariage de Léa et Tom ",
  type: "wedding",
  locale: "fr",
  welcomeMessage: "  ",
  accentColor: "#ffd400",
};

describe("F-011: lecture et mise à jour d'un événement", () => {
  it("F-011: lit un événement de l'organisateur par son identifiant", async () => {
    const { client, chain } = fakeClient({ data: { id: EVENT_ID }, error: null });
    expect(await getOwnEvent(client, EVENT_ID)).toEqual({ id: EVENT_ID });
    expect(chain.eq).toHaveBeenCalledWith("id", EVENT_ID);
  });

  it("S-001: un événement invisible (autre organisateur) vaut null", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await getOwnEvent(client, EVENT_ID)).toBeNull();
  });

  it("F-011: nettoie les champs et assombrit une couleur trop claire avant d'enregistrer", async () => {
    const { client, chain } = fakeClient({ data: { id: EVENT_ID }, error: null });
    const result = await updateEventPresentation(client, EVENT_ID, input);

    expect(result).toEqual({ ok: true, event: { id: EVENT_ID } });
    const saved = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(saved.title).toBe("Mariage de Léa et Tom");
    expect(saved.welcome_message).toBeNull();
    expect(saved.accent_color).not.toBe("#ffd400");
    expect(saved).not.toHaveProperty("event_date");
    expect(saved).not.toHaveProperty("plan");
  });

  it("F-011: sans couleur choisie, l'accent redevient celui du produit (null)", async () => {
    const { client, chain } = fakeClient({ data: { id: EVENT_ID }, error: null });
    await updateEventPresentation(client, EVENT_ID, { ...input, accentColor: "" });
    const saved = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(saved.accent_color).toBeNull();
  });

  it("S-001: aucune ligne modifiée (pas à l'organisateur, ou événement non actif) : introuvable", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await updateEventPresentation(client, EVENT_ID, input)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("F-011: refuse des données invalides avant toute requête", async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    await expect(
      updateEventPresentation(client, EVENT_ID, { ...input, type: "concert" }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it("F-011: remonte une erreur de la base", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(updateEventPresentation(client, EVENT_ID, input)).rejects.toThrow("db down");
    await expect(getOwnEvent(client, EVENT_ID)).rejects.toThrow("db down");
  });
});

describe("F-012: événement vu par un invité", () => {
  it("F-012: un code mal formé est refusé sans requête", async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    expect(await getPublicEvent(client, "abc")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("F-012: ne demande que les champs de présentation et l'offre (pour ses limites), jamais le propriétaire ni les compteurs", async () => {
    const { client, chain } = fakeClient({
      data: {
        title: "Fête",
        settings: { access_code_hash: "scrypt$x", upload_opens_at: "2026-01-01" },
      },
      error: null,
    });
    // The hash and the other settings never leave: only "a code is required".
    expect(await getPublicEvent(client, "k7m2x9qvbr")).toEqual({
      title: "Fête",
      requiresAccessCode: true,
    });
    const columns = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(columns).not.toMatch(/owner_id|bytes_used|media_count/);
    // The plan is selected only so the page can apply its limits (video duration, file size).
    expect(columns).toContain("plan");
    expect(chain.eq).toHaveBeenCalledWith("public_code", "k7m2x9qvbr");
  });

  it("F-012: remonte une erreur de la base", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(getPublicEvent(client, "k7m2x9qvbr")).rejects.toThrow("db down");
  });
});
