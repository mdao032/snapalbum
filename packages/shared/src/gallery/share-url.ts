import { DEFAULT_LOCALE, type Locale } from "../constants";

/**
 * Address of a read-only album (F-054): `/g/{token}`, under the language prefix of the event for
 * every language but the default one (the same rule as the site's own pages).
 */
export function buildShareUrl(siteUrl: string, token: string, locale: Locale): string {
  const base = siteUrl.replace(/\/+$/, "");
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${base}${prefix}/g/${token}`;
}
