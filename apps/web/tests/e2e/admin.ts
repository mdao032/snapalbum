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
  columns: Record<string, string | number | null>,
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
