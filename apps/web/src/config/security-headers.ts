/**
 * Baseline security headers (S-004). The Content-Security-Policy comes with the security review
 * of step 5.4: it must allow Cloudflare Turnstile on the sign-in page and is easier to get right
 * once every page exists. Until then these headers are safe on every page.
 */
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** Guest pages (`/e/{code}` and `/en/e/{code}`) are the only ones that may use the camera. */
const GUEST_PATH = "(?:en/)?e/";

const COMMON = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nobody should embed this site in a frame (clickjacking); the CSP `frame-ancestors` will replace it.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

export const securityHeaders: HeaderRule[] = [
  {
    source: `/:path((?!${GUEST_PATH}).*)`,
    headers: [
      ...COMMON,
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  },
  {
    source: `/:path(${GUEST_PATH}.*)`,
    headers: [
      ...COMMON,
      { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
    ],
  },
];
