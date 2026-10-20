import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "@/lib/sentry-options";

// Server-side Sentry (Node.js and edge runtimes). Disabled unless NEXT_PUBLIC_SENTRY_DSN is set.
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init(buildSentryOptions(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT));
}

export const onRequestError = Sentry.captureRequestError;
