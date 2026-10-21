// Prepares the load test (ROADMAP, tests de la phase 2): one organiser, one event, N guests with
// their access tokens, all written to the LOCAL Supabase database. Never run it against a real
// project: it uses the service key found in apps/web/.env.local.
//
//   node tests/load/prepare.mjs [--guests 300] [--plan event|free]
//
// Writes tests/load/state.json (event, tokens), read by guests.k6.js and check.mjs.
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const GUESTS = Number(option("guests", "300"));
const PLAN = option("plan", "event");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "../../apps/web/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url ?? "")) {
  throw new Error(`Refusing to run: ${url} is not the local Supabase`);
}

async function call(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const createUser = (email, password) =>
  call("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

const organiser = await createUser(`load-org-${randomUUID()}@example.test`, randomUUID());
const code = Array.from(randomBytes(10), (b) => "23456789abcdefghjkmnpqrstuvwxyz"[b % 31]).join("");
const [event] = await call("/rest/v1/events", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    owner_id: organiser.id,
    public_code: code,
    title: "Test de charge",
    event_date: new Date().toISOString().slice(0, 10),
    type: "other",
    plan: PLAN,
    // Uploads are only accepted inside a valid period (read defensively by the database).
    settings: {
      upload_opens_at: new Date(Date.now() - 3600_000).toISOString(),
      upload_closes_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    },
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  }),
});

const guests = [];
for (let start = 0; start < GUESTS; start += 20) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(20, GUESTS - start) }, async (_, offset) => {
      const email = `load-${start + offset}-${randomUUID()}@example.test`;
      const password = randomUUID();
      const user = await createUser(email, password);
      await call("/rest/v1/guests", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          event_id: event.id,
          auth_user_id: user.id,
          terms_accepted_at: new Date().toISOString(),
        }),
      });
      // Each guest signs in "from" its own address: the auth server limits sign-ins per address.
      const ip = `10.${(start + offset) % 250}.${Math.floor((start + offset) / 250)}.7`;
      const session = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anon, "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ email, password }),
      });
      if (!session.ok) throw new Error(`sign-in ${session.status}: ${await session.text()}`);
      const { access_token: token } = await session.json();
      return { userId: user.id, token };
    }),
  );
  guests.push(...batch);
}

fs.writeFileSync(
  path.join(here, "state.json"),
  JSON.stringify({
    eventId: event.id,
    eventCode: code,
    plan: PLAN,
    tokens: guests.map((g) => g.token),
    userIds: guests.map((g) => g.userId),
    organiserId: organiser.id,
  }),
);
console.log(`Event ${code} (${PLAN}), ${guests.length} guests ready: tests/load/state.json`);
