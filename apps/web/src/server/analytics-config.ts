// Nothing secret here (the key of a PostHog project is public by design), so no `server-only`:
// the page frame that reads it is also reached from error pages.

/** The EU ingestion address of PostHog (G-002). */
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

export interface AnalyticsConfig {
  key: string;
  host: string;
}

/**
 * The audience measurement, or null when it is not set up. The variable has no `NEXT_PUBLIC_`
 * prefix on purpose: it is read when a page is served and passed to the banner, never frozen into
 * the build, so it can be set or changed without a new build (and the tests start the same build with
 * a test key). With no key there is no tracker, so no banner either.
 */
export function getAnalyticsConfig(): AnalyticsConfig | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  return { key, host: process.env.POSTHOG_HOST || POSTHOG_EU_HOST };
}
