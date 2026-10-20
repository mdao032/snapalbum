import { describe, expect, it } from "vitest";
import { withTestDb } from "./harness";

describe("S-001: la RLS est activée sur toutes les tables", () => {
  it("aucune table du schéma public n'a la RLS désactivée", () =>
    withTestDb(async (db) => {
      const { rows } = await db.query<{ table_name: string }>(
        `select c.relname as table_name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([]);
    }));

  it("le rôle anon n'a aucun droit sur les tables du schéma public", () =>
    withTestDb(async (db) => {
      const { rows } = await db.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public'`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([]);
    }));
});
