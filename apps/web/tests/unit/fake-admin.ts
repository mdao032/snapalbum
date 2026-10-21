import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

/**
 * A tiny in-memory stand-in for the Supabase client, with the handful of operations the gallery
 * uses (select with filters, order, limit, count; insert; update; rpc). The real database is
 * covered by the integration tests; this keeps the access rules and the paging fast to test.
 */
export function fakeAdmin(
  tables: Record<string, Row[]>,
  rpc: Record<string, (args: Row) => unknown> = {},
) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((row: Row) => boolean)[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let limit = Infinity;
    let head = false;
    let counted = false;
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row | null = null;

    const run = () => {
      let result = rows.filter((row) => filters.every((filter) => filter(row)));
      if (mode === "update") {
        for (const row of result) Object.assign(row, patch);
      }
      const count = result.length;
      for (const { column, ascending } of [...orders].reverse()) {
        result = [...result].sort((a, b) => {
          const left = String(a[column]);
          const right = String(b[column]);
          return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      return {
        data: head ? null : result.slice(0, limit),
        count: counted ? count : null,
        error: null,
      };
    };

    const chain: Record<string, unknown> = {
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        counted = options?.count === "exact";
        head = options?.head === true;
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      // Only `not(column, "is", null)`: the column has a value.
      not(column: string, _operator: string, _value: null) {
        filters.push((row) => (row[column] ?? null) !== null);
        return chain;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      // Only the keyset form the gallery builds: `col.op."V",and(col.eq."V",id.op.ID)`.
      or(expression: string) {
        const match =
          /^(\w+)\.(gt|lt)\."([^"]+)",and\(\w+\.eq\."[^"]+",id\.(?:gt|lt)\.([\w-]+)\)$/.exec(
            expression,
          );
        if (!match) throw new Error(`unexpected filter: ${expression}`);
        const [, column, op, value, cursorId] = match as unknown as [
          string,
          string,
          string,
          string,
          string,
        ];
        filters.push((row) => {
          const here = new Date(String(row[column])).getTime();
          const there = new Date(value).getTime();
          const after = op === "gt" ? here > there : here < there;
          const sameBefore = op === "gt" ? String(row.id) > cursorId : String(row.id) < cursorId;
          return after || (here === there && sameBefore);
        });
        return chain;
      },
      order(column: string, options: { ascending: boolean }) {
        orders.push({ column, ascending: options.ascending });
        return chain;
      },
      limit(value: number) {
        limit = value;
        return chain;
      },
      update(values: Row) {
        mode = "update";
        patch = values;
        return chain;
      },
      insert(values: Row) {
        mode = "insert";
        inserted = {
          id: `link-${rows.length + 1}`,
          created_at: "2026-10-21T10:00:00Z",
          revoked_at: null,
          ...values,
        };
        rows.push(inserted);
        return chain;
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: data?.[0] ?? null, error: null };
      },
      single: async () => ({ data: inserted ?? run().data?.[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve(mode === "insert" ? { data: [inserted], error: null } : run()),
    };
    return chain;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => ({ data: rpc[name]?.(args) ?? [], error: null }),
  };
  return client as unknown as SupabaseClient;
}
