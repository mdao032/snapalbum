// @vitest-environment node
import { EXTENSION, PLANS, REFUND } from "@snapalbum/shared/plans";
import { describe, expect, it } from "vitest";
import { marketingFacts } from "@/lib/marketing-facts";
import {
  absoluteUrl,
  disallowedPaths,
  faqJsonLd,
  jsonLdScript,
  offersJsonLd,
  pageAlternates,
  pagePath,
  pageUrl,
  PUBLIC_PAGES,
  robotsConfig,
  sitemapEntries,
} from "@/lib/seo";
import { USAGES, usageFromSlug, usageParams, usageSlug } from "@/lib/usages";

const SITE = "https://exemple.test/";

describe("étape 5.1: adresses des pages publiques", () => {
  it("le français garde des adresses propres, l'anglais vit sous /en", () => {
    expect(absoluteUrl(SITE, "fr", "/")).toBe("https://exemple.test/");
    expect(absoluteUrl(SITE, "en", "/")).toBe("https://exemple.test/en");
    expect(absoluteUrl(SITE, "fr", "/pricing")).toBe("https://exemple.test/pricing");
    expect(absoluteUrl(SITE, "en", "/pricing")).toBe("https://exemple.test/en/pricing");
  });

  it("chaque occasion a une adresse par langue", () => {
    expect(pagePath({ kind: "usage", usage: "wedding" }, "fr")).toBe("/usages/mariage");
    expect(pagePath({ kind: "usage", usage: "wedding" }, "en")).toBe("/usages/wedding");
    expect(pageUrl(SITE, "en", { kind: "usage", usage: "corporate" })).toBe(
      "https://exemple.test/en/usages/company",
    );
    expect(pagePath({ kind: "demo" }, "fr")).toBe("/demo");
  });

  it("une page annonce son adresse canonique, chaque langue et la langue par défaut", () => {
    const alternates = pageAlternates(SITE, "en", { kind: "usage", usage: "birthday" });
    expect(alternates.canonical).toBe("https://exemple.test/en/usages/birthday");
    expect(alternates.languages).toEqual({
      fr: "https://exemple.test/usages/anniversaire",
      en: "https://exemple.test/en/usages/birthday",
      "x-default": "https://exemple.test/usages/anniversaire",
    });
  });
});

describe("étape 5.1: occasions", () => {
  it("retrouve l'occasion d'un slug de n'importe quelle langue, sinon rien", () => {
    expect(usageFromSlug("mariage")).toBe("wedding");
    expect(usageFromSlug("wedding")).toBe("wedding");
    expect(usageFromSlug("company")).toBe("corporate");
    expect(usageFromSlug("entreprise")).toBe("corporate");
    expect(usageFromSlug("inconnu")).toBeNull();
    expect(usageFromSlug("")).toBeNull();
  });

  it("génère chaque adresse : les deux langues, avec le slug de chaque langue", () => {
    const params = usageParams();
    expect(params).toHaveLength(2 * 2 * USAGES.length);
    expect(params).toContainEqual({ locale: "en", usage: "mariage" });
    expect(params).toContainEqual({ locale: "fr", usage: "anniversaire" });
    expect(params).toContainEqual({ locale: "en", usage: "birthday" });
    expect(usageSlug("fr", "corporate")).toBe("entreprise");
  });
});

describe("étape 5.1: sitemap et robots.txt", () => {
  it("le plan du site liste toutes les pages publiques dans toutes les langues, avec leurs variantes", () => {
    const entries = sitemapEntries(SITE);
    expect(entries).toHaveLength(PUBLIC_PAGES.length * 2);
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("https://exemple.test/");
    expect(urls).toContain("https://exemple.test/en/demo");
    const wedding = entries.find((entry) => entry.url.endsWith("/usages/mariage"));
    expect(wedding?.alternates.languages.en).toBe("https://exemple.test/en/usages/wedding");
  });

  it("aucune page privée n'est dans le plan du site", () => {
    const urls = sitemapEntries(SITE).map((entry) => entry.url);
    for (const path of ["/events", "/account", "/login", "/e/", "/g/", "/api"]) {
      expect(urls.some((url) => url.includes(path))).toBe(false);
    }
  });

  it("robots.txt ferme les espaces privés dans les deux langues et annonce le plan du site", () => {
    const config = robotsConfig(SITE);
    expect(config.sitemap).toBe("https://exemple.test/sitemap.xml");
    const [rule] = config.rules;
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(
      expect.arrayContaining([
        "/api/",
        "/events",
        "/en/events",
        "/account",
        "/en/login",
        "/e/",
        "/en/g/",
      ]),
    );
    expect(disallowedPaths()).not.toContain("/en/api/");
  });
});

describe("étape 5.1: données structurées", () => {
  it("un texte ne peut pas fermer la balise du script", () => {
    expect(jsonLdScript({ text: "</script><b>" })).not.toContain("<");
    expect(JSON.parse(jsonLdScript({ text: "a < b" })).text).toBe("a < b");
  });

  it("la FAQ reprend chaque question et sa réponse", () => {
    const data = faqJsonLd([{ question: "Q ?", answer: "R." }]);
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toEqual([
      { "@type": "Question", name: "Q ?", acceptedAnswer: { "@type": "Answer", text: "R." } },
    ]);
  });

  it("les offres viennent des prix donnés, sans note ni avis inventés", () => {
    const data = offersJsonLd({
      name: "Service",
      description: "d",
      url: "https://exemple.test/",
      offers: [
        { name: "Gratuit", priceCents: 0, currency: "EUR" },
        { name: "Événement", priceCents: 4900, currency: "EUR" },
      ],
    });
    expect(data.offers.map((offer) => offer.price)).toEqual(["0.00", "49.00"]);
    const text = JSON.stringify(data);
    expect(text).not.toContain("aggregateRating");
    expect(text).not.toContain("review");
  });
});

describe("étape 5.1: les chiffres des textes publics viennent de plans.ts", () => {
  it("français : limites, durées, prix et remboursement", () => {
    const facts = marketingFacts("fr");
    expect(facts.freeVideos).toBe(PLANS.free.maxVideos);
    expect(facts.freeDays).toBe(30);
    expect(facts.eventMonths).toBe(12);
    expect(facts.days).toBe(REFUND.windowDays);
    expect(facts.max).toBe(REFUND.maxMediaForRefund);
    expect(facts.extensionMonths).toBe(EXTENSION.months);
    expect(facts.eventPrice.replace(/\s/g, " ")).toBe("49 €");
    expect(facts.freeVideoDuration).toContain("30");
    expect(facts.eventVideoDuration).toContain("3");
  });

  it("anglais : mêmes valeurs, formats de la langue", () => {
    const facts = marketingFacts("en");
    expect(facts.eventPrice).toBe("€49");
    expect(facts.eventMedia).toBe("10,000");
    expect(facts.freeMedia).toBe("200");
  });
});
