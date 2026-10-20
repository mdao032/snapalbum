/**
 * Options shared by every Sentry runtime (browser, Node.js, edge).
 * Technical identifiers only, never personal data (SPEC 15, G-002): no user info, cookies,
 * headers, request bodies or query strings are collected.
 */
export function buildSentryOptions(dsn: string, environment: string | undefined) {
  return {
    dsn,
    environment: environment || "production",
    tracesSampleRate: 0.1,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  };
}
