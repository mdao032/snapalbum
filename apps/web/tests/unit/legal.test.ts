// @vitest-environment node
import { messages } from "@snapalbum/shared/messages";
import { describe, expect, it } from "vitest";
import { LEGAL_ENTITY, LEGAL_STATUS, type LegalEntity } from "@/content/legal-entity";
import {
  ENTITY_FIELDS,
  fillLegalText,
  isLawyerNote,
  LEGAL_PAGES,
  legalFacts,
  placeholdersOf,
  type LegalSection,
} from "@/lib/legal";
import { PUBLIC_PAGES, pagePath, sitemapEntries } from "@/lib/seo";

const FILLED: LegalEntity = {
  company: "Exemple SAS",
  legalForm: "société par actions simplifiée",
  siret: "123 456 789 00012",
  address: "1 rue de l’Exemple, 75000 Paris",
  director: "Dao",
  contact: "contact@exemple.test",
  vatNumber: "FR00123456789",
  mediator: "Médiateur Exemple",
  court: "le tribunal de Paris",
  hostAddress: "Adresse de l’hébergeur",
};

function everyText(locale: "fr" | "en"): string[] {
  const texts: string[] = [];
  for (const page of LEGAL_PAGES) {
    const sections = messages[locale].legal.pages[page].sections as Record<string, LegalSection>;
    for (const section of Object.values(sections)) {
      texts.push(section.title, ...section.paragraphs, ...(section.items ?? []));
    }
  }
  return texts;
}

describe("G-001: pages légales", () => {
  it("les cinq pages existent dans les deux langues, avec des sections", () => {
    for (const locale of ["fr", "en"] as const) {
      for (const page of LEGAL_PAGES) {
        const entry = messages[locale].legal.pages[page];
        expect(entry.title.length).toBeGreaterThan(0);
        expect(Object.keys(entry.sections).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("chaque marque {nom} d'un texte légal est une donnée de l'éditeur ou un chiffre de plans.ts", () => {
    const known = new Set<string>([...ENTITY_FIELDS, ...Object.keys(legalFacts("fr"))]);
    for (const locale of ["fr", "en"] as const) {
      for (const text of everyText(locale)) {
        for (const name of placeholdersOf(text))
          expect(known, `{${name}} dans « ${text} »`).toContain(name);
      }
    }
  });

  it("les mêmes marques sont utilisées en français et en anglais", () => {
    const used = (locale: "fr" | "en") =>
      [...new Set(everyText(locale).flatMap(placeholdersOf))].sort();
    expect(used("en")).toEqual(used("fr"));
  });

  it("un fait de l'éditeur non renseigné est signalé, jamais inventé", () => {
    const parts = fillLegalText("Édité par {company}, SIRET {siret}.", LEGAL_ENTITY, {});
    expect(parts).toEqual([
      { kind: "text", text: "Édité par " },
      { kind: "missing", field: "company" },
      { kind: "text", text: ", SIRET " },
      { kind: "missing", field: "siret" },
      { kind: "text", text: "." },
    ]);
  });

  it("un fait renseigné est écrit dans le texte", () => {
    expect(fillLegalText("Édité par {company}.", FILLED, {})).toEqual([
      { kind: "text", text: "Édité par Exemple SAS." },
    ]);
  });

  it("les chiffres viennent de plans.ts et une marque inconnue reste visible", () => {
    const facts = legalFacts("fr");
    expect(facts.refundDays).toBe(14);
    expect(facts.refundMax).toBe(20);
    expect(fillLegalText("{refundDays} jours, {inconnue}", FILLED, facts)).toEqual([
      { kind: "text", text: "14 jours, {inconnue}" },
    ]);
  });

  it("une phrase entre crochets est une note pour le juriste", () => {
    expect(isLawyerNote("[À faire valider par un juriste : …]")).toBe(true);
    expect(isLawyerNote("Un texte normal.")).toBe(false);
  });

  it("brouillon : les pages légales ne sont pas dans le plan du site tant qu'un juriste ne les a pas validées", () => {
    expect(LEGAL_STATUS.reviewedByLawyer).toBe(false);
    expect(PUBLIC_PAGES.some((page) => page.kind === "legal")).toBe(false);
    const urls = sitemapEntries("https://exemple.test").map((entry) => entry.url);
    expect(urls.some((url) => url.includes("/legal/"))).toBe(false);
    expect(pagePath({ kind: "legal", page: "privacy" }, "en")).toBe("/legal/privacy");
  });

  it("les textes ne promettent pas ce que le produit ne fait pas : aucune conformité ni hébergement garanti", () => {
    for (const locale of ["fr", "en"] as const) {
      const all = everyText(locale).join("\n").toLowerCase();
      expect(all).not.toMatch(
        /conforme au rgpd|gdpr[- ]compliant|100 ?%|garantissons|we guarantee/,
      );
    }
  });
});
