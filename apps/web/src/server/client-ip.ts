import "server-only";

/**
 * The visitor's address, for rate limits (S-003) and the robot check (S-012). On Vercel,
 * `x-vercel-forwarded-for` is set by the platform and cannot be forged by the visitor, so it comes
 * first; `x-forwarded-for` (first address) and `x-real-ip` serve local development and other hosts.
 * Behind a proxy that lets clients add their own `x-forwarded-for`, an attacker could pick their
 * address: check this if the hosting ever changes.
 */
export function clientIpFrom(headers: Pick<Headers, "get">): string | undefined {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
  ];
  for (const value of candidates) {
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return undefined;
}
