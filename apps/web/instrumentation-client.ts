import { buildSentryOptions } from "@/lib/sentry-options";

// Browser-side Sentry, loaded lazily so the SDK never counts in the guest page's initial
// JavaScript budget (NF-002). Disabled unless NEXT_PUBLIC_SENTRY_DSN is set (never locally).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const start = () => {
    void import("@sentry/nextjs").then((Sentry) => {
      Sentry.init(buildSentryOptions(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT));
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 4000 });
  } else {
    setTimeout(start, 2000);
  }
}
