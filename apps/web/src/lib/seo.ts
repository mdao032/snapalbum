import { LOCALES, DEFAULT_LOCALE, type Locale } from "@snapalbum/shared/messages";
import { LEGAL_STATUS } from "@/content/legal-entity";
import { LEGAL_PAGES, type LegalPage } from "./legal";
import { USAGES, usageSlug } from "./usages";

/**
 * Public pages and their addresses (step 5.1): one list feeds the sitemap, the language links and
 * the canonical address of every page, so they cannot drift apart.
 */
export type PublicPage =
  | { kind: "home" }
  | { kind: "pricing" }
  | { kind: "demo" }
  | { kind: "usage"; usage: (typeof USAGES)[number] }
  | { kind: "legal"; page: LegalPage };

export const PUBLIC_PAGES: readonly PublicPage[] = [
  { kind: "home" },
  { kind: "pricing" },
  { kind: "demo" },
  ...USAGES.map((usage) => ({ kind: "usage", usage }) as const),
  // Draft legal pages are not offered to search engines until a lawyer has validated them.
  ...(LEGAL_STATUS.reviewedByLawyer
    ? LEGAL_PAGES.map((page) => ({ kind: "legal", page }) as const)
    : []),
];

/** The path of a page in a language, without the language prefix (`/usages/mariage`). */
export function pagePath(page: PublicPage, locale: Locale): string {
  switch (page.kind) {
    case "home":
      return "/";
    case "pricing":
      return "/pricing";
    case "demo":
      return "/demo";
    case "usage":
      return `/usages/${usageSlug(locale, page.usage)}`;
    case "legal":
      return `/legal/${page.page}`;
  }
}

/** The full address of a page: French keeps clean URLs, other languages live under `/{locale}`. */
export function absoluteUrl(siteUrl: string, locale: Locale, path: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  const rest = path === "/" ? (prefix ? "" : "/") : path;
  return `${base}${prefix}${rest}`;
}

export function pageUrl(siteUrl: string, locale: Locale, page: PublicPage): string {
  return absoluteUrl(siteUrl, locale, pagePath(page, locale));
}

/** `alternates` of the Next.js metadata: own canonical address and every language of the page. */
export function pageAlternates(siteUrl: string, locale: Locale, page: PublicPage) {
  const languages: Record<string, string> = Object.fromEntries(
    LOCALES.map((other) => [other, pageUrl(siteUrl, other, page)]),
  );
  languages["x-default"] = pageUrl(siteUrl, DEFAULT_LOCALE, page);
  return { canonical: pageUrl(siteUrl, locale, page), languages };
}

/** Paths without a language prefix that must never be crawled: APIs, sign-in return, short links. */
const PRIVATE_UNPREFIXED = ["/api/", "/auth/", "/s/"] as const;

/** Private pages that exist in every language: sign-in, organiser area, albums. */
const PRIVATE_LOCALIZED = ["/login", "/events", "/account", "/admin", "/e/", "/g/"] as const;

/** Paths that must never be crawled or shown in search results: accounts, albums, APIs. */
export function disallowedPaths(): string[] {
  return [
    ...PRIVATE_UNPREFIXED,
    ...LOCALES.flatMap((locale) =>
      PRIVATE_LOCALIZED.map((prefix) => absoluteUrl("", locale, prefix)),
    ),
  ];
}

/** The sitemap: every public page in every language, each with its language alternates. */
export function sitemapEntries(siteUrl: string) {
  return PUBLIC_PAGES.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: pageUrl(siteUrl, locale, page),
      alternates: { languages: pageAlternates(siteUrl, locale, page).languages },
    })),
  );
}

/** `robots.txt`: public pages are open, private areas are closed, the sitemap is announced. */
export function robotsConfig(siteUrl: string) {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: disallowedPaths() }],
    sitemap: `${siteUrl.replace(/\/$/, "")}/sitemap.xml`,
  };
}

/** JSON for a `<script type="application/ld+json">` or `application/json`: `<` is escaped so text can never close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

export function organizationJsonLd(input: { name: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: input.url,
  };
}

export function websiteJsonLd(input: { name: string; url: string; inLanguage: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    inLanguage: input.inLanguage,
  };
}

export function faqJsonLd(entries: readonly { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/**
 * The paid and free offers as schema.org offers. Prices come from `plans.ts` through the caller;
 * there is no rating, no review: none exists, and inventing one would be false (step 5.1).
 */
export function offersJsonLd(input: {
  name: string;
  description: string;
  url: string;
  offers: readonly { name: string; priceCents: number; currency: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    url: input.url,
    offers: input.offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: (offer.priceCents / 100).toFixed(2),
      priceCurrency: offer.currency,
      availability: "https://schema.org/InStock",
    })),
  };
}
