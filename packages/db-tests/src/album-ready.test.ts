import { describe, expect, it } from "vitest";
import { withTestDb } from "./harness";

interface Answer {
  ok: boolean;
  ready_at?: string;
  already?: boolean;
}

async function mark(
  db: { query: (text: string, values?: unknown[]) => Promise<{ rows: { answer: Answer }[] }> },
  eventId: string,
  ownerId: string,
): Promise<Answer> {
  const { rows } = await db.query("select public.mark_album_ready($1, $2) as answer", [
    eventId,
    ownerId,
  ]);
  return rows[0]!.answer;
}

describe("F-044: l'organisateur déclare l'album prêt", () => {
  it("F-044: le propriétaire le déclare une fois, au format ISO, sans toucher aux autres réglages", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner, {
        settings: JSON.stringify({ gallery_visible: true, require_approval: false }),
      });

      const first = await mark(db, event, owner);
      expect(first).toMatchObject({ ok: true, already: false });
      expect(first.ready_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Math.abs(Date.parse(first.ready_at!) - Date.now())).toBeLessThan(60_000);

      const { rows } = await db.query("select settings from public.events where id = $1", [event]);
      expect(rows[0]!.settings).toEqual({
        gallery_visible: true,
        require_approval: false,
        album_ready_at: first.ready_at,
      });
    }));

  it("F-044: le déclarer une deuxième fois ne change pas l'instant (les invités ne sont prévenus qu'une fois)", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      const first = await mark(db, event, owner);
      const second = await mark(db, event, owner);
      expect(second).toEqual({ ok: true, ready_at: first.ready_at, already: true });
    }));

  it("F-044, S-001: un autre organisateur, un événement inconnu ou suspendu : refusé", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const stranger = await db.createUser();
      const event = await db.createEvent(owner);
      expect(await mark(db, event, stranger)).toEqual({ ok: false });
      expect(await mark(db, "00000000-0000-4000-8000-000000000000", owner)).toEqual({ ok: false });

      await db.query("update public.events set status = 'suspended' where id = $1", [event]);
      expect(await mark(db, event, owner)).toEqual({ ok: false });
      const { rows } = await db.query("select settings from public.events where id = $1", [event]);
      expect(rows[0]!.settings).not.toHaveProperty("album_ready_at");
    }));

  it("S-001: seul le serveur peut appeler la fonction : ni un organisateur, ni un invité, ni un visiteur", () =>
    withTestDb(async (db) => {
      const owner = await db.createUser();
      const event = await db.createEvent(owner);
      const guestUser = await db.createUser({ anonymous: true });
      const call = (actor: Parameters<typeof db.as>[0]) =>
        db.as(actor, (q) => q.query("select public.mark_album_ready($1, $2)", [event, owner]));

      await expect(call({ kind: "user", id: owner })).rejects.toThrow(/permission denied/);
      await expect(call({ kind: "guest", id: guestUser })).rejects.toThrow(/permission denied/);
      await expect(call({ kind: "visitor" })).rejects.toThrow(/permission denied/);
      await expect(call({ kind: "service" })).resolves.toBeDefined();
    }));
});
