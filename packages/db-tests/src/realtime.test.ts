import { describe, expect, it } from "vitest";
import { withTestDb } from "./harness";

describe("F-061: le diaporama suit les médias en temps réel", () => {
  it("F-061: la table media est dans la publication Realtime, avec les colonnes qui servent au filtre", () =>
    withTestDb(async (db) => {
      const { rows } = await db.query<{ attnames: string[] }>(
        `select attnames::text[] as attnames from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attnames).toEqual(
        expect.arrayContaining(["id", "event_id", "kind", "status", "moderation"]),
      );
    }));

  it("S-001: seules les tables prévues sont publiées (pas de fuite par Realtime)", () =>
    withTestDb(async (db) => {
      const { rows } = await db.query<{ tablename: string }>(
        `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`,
      );
      expect(rows.map((row) => row.tablename)).toEqual(["media"]);
    }));
});
