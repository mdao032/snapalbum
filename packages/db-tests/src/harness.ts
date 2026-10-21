import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";

/**
 * RLS test harness. Each test runs inside one transaction that is always rolled back, so tests
 * never leave data behind and can run against the same local database.
 *
 * An "actor" reproduces how Supabase evaluates a request: the Postgres role (`anon`,
 * `authenticated` or `service_role`) plus the JWT claims that `auth.uid()` reads.
 */

export const DATABASE_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type Actor =
  /** A visitor with no session: only the public anon key. */
  | { kind: "visitor" }
  /** A signed-in organiser (or admin). */
  | { kind: "user"; id: string }
  /** An anonymous guest session (F-035): role `authenticated` with `is_anonymous` set. */
  | { kind: "guest"; id: string }
  /** The server with the service role key: bypasses RLS. */
  | { kind: "service" };

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

export interface TestDb extends Queryable {
  /** Inserts a user in `auth.users` (fires the signup triggers) and returns its id. */
  createUser(options?: {
    email?: string;
    anonymous?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<string>;
  /** Inserts an event as the database owner (like the server does) and returns its id. */
  createEvent(ownerId: string, overrides?: Record<string, unknown>): Promise<string>;
  /** Makes `userId` an administrator (done as the database owner, like the server would). */
  makeAdmin(userId: string): Promise<void>;
  /** Runs `fn` with the permissions of `actor`. A failed statement does not abort the test. */
  as<T>(actor: Actor, fn: (db: Queryable) => Promise<T>): Promise<T>;
}

function claimsFor(actor: Actor): { role: string; claims: Record<string, unknown> } {
  switch (actor.kind) {
    case "visitor":
      return { role: "anon", claims: { role: "anon" } };
    case "service":
      return { role: "service_role", claims: { role: "service_role" } };
    case "user":
      return {
        role: "authenticated",
        claims: { sub: actor.id, role: "authenticated", is_anonymous: false },
      };
    case "guest":
      return {
        role: "authenticated",
        claims: { sub: actor.id, role: "authenticated", is_anonymous: true },
      };
  }
}

export async function withTestDb(fn: (db: TestDb) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");

    const db: TestDb = {
      query: (text, values) => client.query(text, values),

      async createUser(options = {}) {
        const id = randomUUID();
        await client.query(
          `insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data)
           values ($1, 'authenticated', 'authenticated', $2, $3, $4)`,
          [
            id,
            options.anonymous ? null : (options.email ?? `${id}@example.test`),
            options.anonymous ?? false,
            JSON.stringify(options.metadata ?? {}),
          ],
        );
        return id;
      },

      async createEvent(ownerId, overrides = {}) {
        const values = {
          owner_id: ownerId,
          public_code: Array.from(
            { length: 10 },
            () => "23456789abcdefghjkmnpqrstuvwxyz"[randomInt(31)],
          ).join(""),
          title: "Mariage de Léa et Tom",
          event_date: "2026-09-12",
          type: "wedding",
          expires_at: "2026-10-13T00:00:00Z",
          ...overrides,
        };
        const columns = Object.keys(values);
        const { rows } = await client.query<{ id: string }>(
          `insert into public.events (${columns.join(", ")})
           values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
          Object.values(values),
        );
        return rows[0]!.id;
      },

      async makeAdmin(userId) {
        await client.query("update public.profiles set role = 'admin' where user_id = $1", [
          userId,
        ]);
      },

      async as(actor, callback) {
        const { role, claims } = claimsFor(actor);
        await client.query("savepoint actor");
        try {
          await client.query(`set local role ${role}`);
          await client.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify(claims),
          ]);
          return await callback({ query: (text, values) => client.query(text, values) });
        } catch (error) {
          await client.query("rollback to savepoint actor");
          throw error;
        } finally {
          await client.query("reset role");
        }
      },
    };

    await fn(db);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}
