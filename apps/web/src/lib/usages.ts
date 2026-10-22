import type { Locale } from "@snapalbum/shared/messages";

/** The occasions that have their own public page (step 5.1): written for search engines and for people. */
export const USAGES = ["wedding", "birthday", "corporate"] as const;
export type Usage = (typeof USAGES)[number];

/** The last part of `/usages/{slug}`, in each language: French pages have French addresses. */
const SLUGS: Record<Locale, Record<Usage, string>> = {
  fr: { wedding: "mariage", birthday: "anniversaire", corporate: "entreprise" },
  en: { wedding: "wedding", birthday: "birthday", corporate: "company" },
};

export function usageSlug(locale: Locale, usage: Usage): string {
  return SLUGS[locale][usage];
}

/** The occasion behind a slug of any language (the language switcher keeps the slug it was on). */
export function usageFromSlug(slug: string): Usage | null {
  for (const usage of USAGES) {
    if (Object.values(SLUGS).some((slugs) => slugs[usage] === slug)) return usage;
  }
  return null;
}

/**
 * Every address that exists: each language with the slug of each language. The slug of the other
 * language redirects (the language switcher keeps the slug it was on); anything else is a 404.
 */
export function usageParams(): { locale: Locale; usage: string }[] {
  const locales = Object.keys(SLUGS) as Locale[];
  return locales.flatMap((locale) =>
    locales.flatMap((slugLocale) =>
      USAGES.map((usage) => ({ locale, usage: usageSlug(slugLocale, usage) })),
    ),
  );
}
