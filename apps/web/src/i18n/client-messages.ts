import { pickMessages, type Locale, type Messages } from "@snapalbum/shared/messages";

/**
 * The translations sent to the browser, by area. Server components read every message on the
 * server for free; only what client components use travels, so each page stays light (NF-002).
 * A nested provider replaces the one above it, so each area lists the base groups again.
 */
const BASE = ["language", "layout", "error", "notFound", "common", "states"] as const;

type Namespace = keyof Messages;

export function clientMessagesFor(
  locale: Locale,
  extra: readonly Namespace[] = [],
  /** Base groups this area never reads in the browser (a page with no site header or footer). */
  omit: readonly Namespace[] = [],
) {
  return pickMessages(
    locale,
    [...BASE, ...extra].filter((namespace) => !omit.includes(namespace)),
  );
}
