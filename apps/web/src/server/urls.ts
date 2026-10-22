import "server-only";
import { clientEnv } from "@/config/env";
import { routing } from "@/i18n/routing";

/** The origin of the site, without a trailing slash: the base of every address sent by e-mail. */
export function siteOrigin(): string {
  return clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
}

/** `/en` for English, nothing for the default language, like the rest of the site. */
export function localePrefix(locale: string): string {
  return locale === routing.defaultLocale ? "" : `/${locale}`;
}

/** The address of a page of the site in a given language, e.g. `/events/…`. */
export function pageUrl(locale: string, path: string): string {
  return `${siteOrigin()}${localePrefix(locale)}${path}`;
}
