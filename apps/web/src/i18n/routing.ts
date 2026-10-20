import { DEFAULT_LOCALE, LOCALES } from "@snapalbum/shared/messages";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  // French (default) keeps clean URLs, English lives under /en.
  localePrefix: "as-needed",
});
