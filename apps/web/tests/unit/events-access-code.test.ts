import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { verifyAccessCode } from "@/server/access-code";
import { updateEventSettings } from "@/server/events";

const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";

/** Fake query builder: lookup through `maybeSingle` (twice: read then save), update recorded. */
function fakeClient(settings: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "update", "eq"]) chain[step] = vi.fn(() => chain);
  chain.maybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: EVENT_ID, settings }, error: null })
    .mockResolvedValue({ data: { id: EVENT_ID }, error: null });
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, chain };
}

const base = {
  gallery_visible: true,
  require_approval: false,
  upload_opens_at: "2026-09-05T00:00:00.000Z",
  upload_closes_at: "2026-10-12T00:00:00.000Z",
};

const savedSettings = (chain: Record<string, unknown>) =>
  (
    (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      settings: Record<string, unknown>;
    }
  ).settings;

describe("F-017, S-006: l'organisateur définit le code d'accès", () => {
  it("S-006: enregistre le code haché, jamais en clair, et il est ensuite vérifiable", async () => {
    const { client, chain } = fakeClient({});
    await updateEventSettings(client, EVENT_ID, { ...base, access_code: "4821" });
    const settings = savedSettings(chain);
    expect(JSON.stringify(settings)).not.toContain("4821");
    expect(settings).not.toHaveProperty("access_code");
    expect(await verifyAccessCode("4821", settings.access_code_hash)).toBe(true);
    expect(await verifyAccessCode("4822", settings.access_code_hash)).toBe(false);
  });

  it("F-017: laisser le champ vide ne change pas le code existant", async () => {
    const { client, chain } = fakeClient({ access_code_hash: "scrypt$existing" });
    await updateEventSettings(client, EVENT_ID, base);
    expect(savedSettings(chain).access_code_hash).toBe("scrypt$existing");
  });

  it("F-017: la chaîne vide retire le code", async () => {
    const { client, chain } = fakeClient({ access_code_hash: "scrypt$existing" });
    await updateEventSettings(client, EVENT_ID, { ...base, access_code: "" });
    expect(savedSettings(chain).access_code_hash).toBeNull();
  });

  it("F-017: remplacer le code change le hachage", async () => {
    const { client, chain } = fakeClient({ access_code_hash: "scrypt$old" });
    await updateEventSettings(client, EVENT_ID, { ...base, access_code: "999999" });
    expect(savedSettings(chain).access_code_hash).not.toBe("scrypt$old");
  });

  it("F-017: refuse un code qui n'a pas de 4 à 6 chiffres avant toute requête", async () => {
    const { client } = fakeClient({});
    for (const access_code of ["12", "1234567", "abcd", "12 34"]) {
      await expect(
        updateEventSettings(client, EVENT_ID, { ...base, access_code }),
      ).rejects.toThrow();
    }
    expect((client.from as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
