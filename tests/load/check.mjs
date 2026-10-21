// After the load test: the album must hold exactly what was confirmed, within its quota, with no
// duplicate and no counter drift (R1, NF-012). Local database only.
//
//   node tests/load/check.mjs
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(here, "state.json"), "utf8"));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "../../apps/web/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const MAX_MEDIA = { free: 200, event: 10_000, pro: 10_000 }[state.plan];

/** All rows of a query, page after page (the API answers at most 1 000 rows at a time). */
async function rows(table, query) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Range-Unit": "items",
        Range: `${from}-${from + 999}`,
      },
    });
    if (!response.ok) throw new Error(`${table}: ${response.status}`);
    const page = await response.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

const [event] = await rows("events", `id=eq.${state.eventId}&select=media_count,bytes_used`);
const media = await rows("media", `event_id=eq.${state.eventId}&select=status,sha256&order=id`);
const counted = media.filter((m) => !["deleted", "rejected"].includes(m.status));
const ready = media.filter((m) => m.status === "ready");
const unique = new Set(counted.map((m) => m.sha256)).size;

const problems = [];
if (counted.length > MAX_MEDIA) problems.push(`quota exceeded: ${counted.length} > ${MAX_MEDIA}`);
if (event.media_count !== counted.length)
  problems.push(`counter drift: media_count ${event.media_count} vs ${counted.length} rows`);
if (unique !== counted.length) problems.push(`duplicates: ${counted.length - unique}`);
console.log(
  `plan ${state.plan}: ${ready.length} ready, ${counted.length} counted, counter ${event.media_count}, quota ${MAX_MEDIA}`,
);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("OK: quota respected, counters exact, no duplicate");
