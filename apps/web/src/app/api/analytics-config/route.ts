import { getAnalyticsConfig } from "@/server/analytics-config";

// A route handler with no request in it is built once and frozen: this one must read the
// environment each time it is asked (the key can be set without a new build).
export const dynamic = "force-dynamic";

/**
 * Tells the cookie banner whether audience measurement is set up (G-003). Read when asked, so the
 * pages themselves do not depend on it and can be built once and cached. The key of a PostHog
 * project is public by design. 204 when there is no tracker: no banner, nothing to manage.
 */
export function GET() {
  const config = getAnalyticsConfig();
  if (!config) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return Response.json(config, { headers: { "Cache-Control": "public, max-age=300" } });
}
