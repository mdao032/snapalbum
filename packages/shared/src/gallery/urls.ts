/**
 * Signed read addresses last one hour (SPEC 9.1). The gallery asks for fresh ones shortly before
 * they expire, so a guest who leaves the album open for an evening never meets a broken picture.
 */

/** Renew this long before the end, so an address never expires under a request in flight. */
export const URL_REFRESH_MARGIN_SECONDS = 300;

/** True when addresses obtained at `issuedAtMs` for `validSeconds` should be replaced now. */
export function urlsAreStale(
  issuedAtMs: number,
  validSeconds: number,
  nowMs: number,
  marginSeconds: number = URL_REFRESH_MARGIN_SECONDS,
): boolean {
  return nowMs >= issuedAtMs + (validSeconds - marginSeconds) * 1000;
}

/** Indexes around `index` (itself first, then outwards), clipped to a list of `count` items. */
export function neighbourhood(index: number, count: number, radius: number): number[] {
  if (count <= 0 || index < 0 || index >= count) return [];
  const result = [index];
  for (let step = 1; step <= radius; step += 1) {
    if (index + step < count) result.push(index + step);
    if (index - step >= 0) result.push(index - step);
  }
  return result;
}
