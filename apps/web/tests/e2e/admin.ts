import fs from "node:fs";
import path from "node:path";

/** Reads `apps/web/.env.local`, the file `next start` uses, so the tests talk to the same Supabase. */
function localEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

/**
 * Changes columns the application never lets organisers write (counters, deletion date) straight
 * in the local test database, to set up situations that need phase 2 or the passing of time.
 * Local development database only: the keys come from the local Supabase.
 */
export async function setEventColumns(
  eventId: string,
  columns: Record<string, unknown>,
): Promise<void> {
  const env = localEnv();
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/events?id=eq.${eventId}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(columns),
  });
  if (!response.ok) throw new Error(`Could not update the event: ${response.status}`);
}

/** Rows of a table read with the service role (local test database only), PostgREST query string. */
export async function getRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const env = localEnv();
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`Could not read ${table}: ${response.status}`);
  return (await response.json()) as Record<string, unknown>[];
}

/** Changes columns of the rows of a table that match a PostgREST query (local test database only). */
export async function patchRows(
  table: string,
  query: string,
  columns: Record<string, unknown>,
): Promise<void> {
  const env = localEnv();
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(columns),
  });
  if (!response.ok) throw new Error(`Could not update ${table}: ${response.status}`);
}

/** A guest-style anonymous account and its access token, as the apps get them (local database only). */
export async function createAnonymousUser(): Promise<{ id: string; token: string }> {
  const env = localEnv();
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Could not sign in anonymously: ${response.status}`);
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  return { id: body.user.id, token: body.access_token };
}

/** An account with a confirmed e-mail address, created by the service role (local database only). */
export async function createConfirmedUser(email: string): Promise<string> {
  const env = localEnv();
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`Could not create the user: ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

/** The address of the local Supabase API and its public key, for tests that attack it directly. */
export function supabaseEndpoint(): { url: string; anonKey: string } {
  const env = localEnv();
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}

/** Inserts rows with the service role, in chunks, and returns them (local test database only). */
export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const env = localEnv();
  const inserted: Record<string, unknown>[] = [];
  for (let start = 0; start < rows.length; start += 500) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rows.slice(start, start + 500)),
    });
    if (!response.ok) {
      throw new Error(
        `Could not insert into ${table}: ${response.status} ${await response.text()}`,
      );
    }
    inserted.push(...((await response.json()) as Record<string, unknown>[]));
  }
  return inserted;
}
