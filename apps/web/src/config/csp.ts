/**
 * Content-Security-Policy (S-004), built for each request by the proxy so that the sources that
 * depend on the deployment (storage, Supabase, Sentry, PostHog) are read at run time.
 *
 * Scripts keep `'unsafe-inline'`: the pages of the public site are built once and served from the
 * cache, and Next.js writes its own start-up scripts inline in them. A per-request nonce would make
 * every one of those pages dynamic again (step 5.4 of decisions.md). Everything else is closed:
 * no other script host than Turnstile, no plug-in, no framing, no `<base>`, forms and connections
 * only to the services the site really uses.
 */
export interface CspEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  POSTHOG_HOST?: string;
  /** A local S3 emulator (development and tests); real R2 addresses are matched by the wildcard. */
  R2_ENDPOINT?: string;
}

const TURNSTILE = "https://challenges.cloudflare.com";
/** Photos and videos are sent to and read from signed R2 addresses (`{account}.eu.r2.cloudflarestorage.com`). */
const R2 = "https://*.r2.cloudflarestorage.com";
const POSTHOG_DEFAULT = "https://eu.i.posthog.com";
/** Stripe Checkout, where a form or a redirect may send the organiser to pay. */
const STRIPE_CHECKOUT = "https://checkout.stripe.com";

/** The origin of a URL, or nothing when it is missing or malformed (a bad setting never breaks a page). */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function buildContentSecurityPolicy(env: CspEnv): string {
  const development = env.NODE_ENV === "development";
  const storage = unique([R2, originOf(env.R2_ENDPOINT)]);
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const connect = unique([
    "'self'",
    ...storage,
    supabase,
    // Realtime (the live slideshow) is a WebSocket on the same host.
    supabase?.replace(/^http/, "ws") ?? null,
    originOf(env.NEXT_PUBLIC_SENTRY_DSN),
    originOf(env.POSTHOG_HOST) ?? POSTHOG_DEFAULT,
    // Next.js hot reload.
    development ? "ws:" : null,
  ]);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": unique([
      "'self'",
      "'unsafe-inline'",
      // The HEIC decoder (libheif) is WebAssembly; this keyword allows nothing else than that.
      "'wasm-unsafe-eval'",
      development ? "'unsafe-eval'" : null,
      TURNSTILE,
    ]),
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": unique(["'self'", "data:", "blob:", ...storage]),
    "media-src": unique(["'self'", "blob:", ...storage]),
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-src": [TURNSTILE],
    // The image-preparation worker is a bundled module; blob: covers the ones the libraries start.
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", STRIPE_CHECKOUT],
    "frame-ancestors": ["'none'"],
  };

  // No `upgrade-insecure-requests`: Strict-Transport-Security already keeps browsers on HTTPS.
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}
