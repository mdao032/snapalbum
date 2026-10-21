import { PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH } from "../schemas/common";

/** A request path that is exactly one public event code: `/k7m2x9qvbr` (SPEC 6.2 bis). */
const SHORT_LINK_PATH = new RegExp(`^/([${PUBLIC_CODE_ALPHABET}]{${PUBLIC_CODE_LENGTH},})$`);

/** The event code when `pathname` is a short link, otherwise null. */
export function shortLinkCodeOf(pathname: string): string | null {
  return SHORT_LINK_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * The permanent link printed in QR codes: the short link base plus the code, never a hard-coded
 * address (SPEC 6.2 bis). A trailing slash on the base is tolerated.
 */
export function buildShortLink(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/${code}`;
}
