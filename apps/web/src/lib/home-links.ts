import type { Locale } from "@snapalbum/shared/messages";
import { getPathname } from "@/i18n/navigation";

/** Id of the "how it works" band of the home page. */
export const HOW_IT_WORKS_ID = "comment-ca-marche";

/**
 * Address of that band in a language. Used with a plain `<a>`: a client-side navigation from
 * another page lands on the right page but does not scroll to the band, a normal one does.
 */
export function howItWorksHref(locale: Locale): string {
  return `${getPathname({ href: "/", locale })}#${HOW_IT_WORKS_ID}`;
}
