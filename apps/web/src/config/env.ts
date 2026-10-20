import { z } from "zod";

/**
 * Public environment variables (safe to expose to the browser).
 * Server-only variables live in `env.server.ts`, which cannot be imported by client code.
 *
 * Next.js only inlines `NEXT_PUBLIC_*` variables when they are read statically,
 * hence the explicit object below instead of `process.env`.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  /** Base of the permanent QR code link: QR codes encode this value + the event code (SPEC 6.2 bis). */
  NEXT_PUBLIC_SHORT_LINK_BASE: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

/** Treats empty strings (common in `.env` files) as unset. */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

export function parseClientEnv(source: Record<keyof ClientEnv, string | undefined>): ClientEnv {
  const result = clientSchema.safeParse(
    Object.fromEntries(Object.entries(source).map(([k, v]) => [k, emptyToUndefined(v)])),
  );
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid public environment variables:\n${problems.join("\n")}`);
  }
  return result.data;
}

export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SHORT_LINK_BASE: process.env.NEXT_PUBLIC_SHORT_LINK_BASE,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
});
