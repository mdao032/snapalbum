import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createEvent } from "@/server/events";

const OWNER = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const input = {
  title: "Mariage de Léa et Tom",
  eventDate: "2026-09-12",
  type: "wedding" as const,
  locale: "fr" as const,
};

/** Fake admin client whose successive counts are scripted, to replay two simultaneous creations. */
function fakeAdmin(counts: number[]) {
  const remaining = [...counts];
  const countQuery = {
    eq: vi.fn(() => countQuery),
    or: vi.fn(() => Promise.resolve({ count: remaining.shift() ?? 0, error: null })),
  };
  const deleted: string[] = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => countQuery),
    insert: vi.fn((row: Record<string, unknown>) => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "new-event", ...row }, error: null }),
      }),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn((_column: string, id: string) => {
        deleted.push(id);
        return Promise.resolve({ error: null });
      }),
    })),
  }));
  return { client: { from } as unknown as SupabaseClient, deleted };
}

describe("F-012: un seul événement gratuit actif, même en cas de demandes simultanées", () => {
  it("F-012: garde l'événement quand le quota n'est pas dépassé après l'écriture", async () => {
    const { client, deleted } = fakeAdmin([0, 1]);
    const result = await createEvent(client, OWNER, input);
    expect(result.ok).toBe(true);
    expect(deleted).toEqual([]);
  });

  it("F-012: reprend son événement quand une autre demande a écrit entre-temps", async () => {
    // Before writing: 0 active. After writing: 2 (this one and the concurrent one).
    const { client, deleted } = fakeAdmin([0, 2]);
    const result = await createEvent(client, OWNER, input);
    expect(result).toEqual({ ok: false, reason: "free_event_limit" });
    expect(deleted).toEqual(["new-event"]);
  });
});
