import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from client code fails the build (S-007).
 * Variables for services that are not wired yet stay optional; each phase makes the ones
 * it needs required (see `.env.example`).
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16).optional(),
  // Cloudflare R2 (phase 2)
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  // Upstash Redis (phase 1)
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Cloudflare Turnstile (phase 1)
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  // Resend (phase 1)
  RESEND_API_KEY: z.string().min(1).optional(),
  // Stripe, test mode only (phase 4)
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", "Only Stripe test keys are allowed")
    .optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Parsed lazily so that `next build` does not need every secret. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const cleaned = Object.fromEntries(
    Object.keys(serverSchema.shape).map((key) => [
      key,
      process.env[key] === "" ? undefined : process.env[key],
    ]),
  );
  const result = serverSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server environment variables:\n${problems.join("\n")}`);
  }
  cached = result.data;
  return cached;
}
