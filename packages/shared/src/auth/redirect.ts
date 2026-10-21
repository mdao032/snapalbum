import { DEFAULT_LOCALE, LOCALES, type Locale } from "../schemas/common";

/** Where an organiser lands after signing in when no page was requested. */
export const DEFAULT_AFTER_LOGIN_PATH = "/account";

/** The default landing page in the visitor's language (`/account` in French, `/en/account` in English). */
export function defaultAfterLoginPath(locale: Locale): string {
  return locale === DEFAULT_LOCALE
    ? DEFAULT_AFTER_LOGIN_PATH
    : `/${locale}${DEFAULT_AFTER_LOGIN_PATH}`;
}

const LOGIN_PATH = "/login";
const AUTH_PREFIX = "/auth";

/**
 * Makes a `next` redirect target safe: only a same-site path survives (no open redirect), and
 * the login pages are refused so that signing in can never loop. Anything else becomes `fallback`.
 */
export function sanitizeRedirectPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN_PATH,
): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  // A single leading slash; `//host` and `/\host` are read as another site by browsers.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  // Control characters (line breaks, tabs) can be used to smuggle a different target.
  if ([...raw].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(raw, "http://placeholder.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://placeholder.invalid") return fallback;

  const path = stripLocalePrefix(url.pathname);
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`) || path.startsWith(AUTH_PREFIX)) {
    return fallback;
  }
  return `${url.pathname}${url.search}`;
}

/** Removes a leading `/fr` or `/en` so the same rules apply to every language. */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}
