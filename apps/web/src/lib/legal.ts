import { marketingFacts } from "./marketing-facts";
import type { LegalEntity } from "@/content/legal-entity";

/** The legal pages, in the order of the footer. The slug is the same in every language. */
export const LEGAL_PAGES = ["notice", "terms", "sales", "privacy", "cookies"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

export function isLegalPage(slug: string): slug is LegalPage {
  return (LEGAL_PAGES as readonly string[]).includes(slug);
}

/** A section as written in the messages. */
export interface LegalSection {
  title: string;
  paragraphs: string[];
  items?: string[];
}

/** The entity fields a legal text may mention (`{company}`, `{siret}`…). */
export const ENTITY_FIELDS = [
  "company",
  "legalForm",
  "siret",
  "address",
  "director",
  "contact",
  "vatNumber",
  "mediator",
  "court",
  "hostAddress",
] as const satisfies readonly (keyof LegalEntity)[];
export type EntityField = (typeof ENTITY_FIELDS)[number];

/** The plan figures a legal text may quote: read from `plans.ts`, never typed in a text. */
export function legalFacts(locale: string): Record<string, string | number> {
  const facts = marketingFacts(locale);
  return {
    appName: facts.appName,
    freeDays: facts.freeDays,
    eventMonths: facts.eventMonths,
    eventPrice: facts.eventPrice,
    eventMedia: facts.eventMedia,
    extensionPrice: facts.extensionPrice,
    extensionMonths: facts.extensionMonths,
    refundDays: facts.days,
    refundMax: facts.max,
  };
}

export type TextPart =
  | { kind: "text"; text: string }
  /** A fact of the entity that is not filled in yet. */
  | { kind: "missing"; field: EntityField };

/**
 * Cuts a text into plain parts and missing entity fields, filling in everything it can. An
 * unknown `{name}` is kept as written so that a typo shows (and the tests catch it).
 */
export function fillLegalText(
  text: string,
  entity: LegalEntity,
  facts: Record<string, string | number>,
): TextPart[] {
  const parts: TextPart[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    buffer += text.slice(last, match.index);
    last = match.index + match[0].length;
    const name = match[1] ?? "";
    if ((ENTITY_FIELDS as readonly string[]).includes(name)) {
      const value = entity[name as EntityField];
      if (value) buffer += value;
      else {
        flush();
        parts.push({ kind: "missing", field: name as EntityField });
      }
    } else if (name in facts) {
      buffer += String(facts[name]);
    } else {
      buffer += match[0];
    }
  }
  buffer += text.slice(last);
  flush();
  return parts;
}

/** A paragraph written in brackets is a note for the lawyer, shown apart. */
export function isLawyerNote(text: string): boolean {
  return text.startsWith("[") && text.endsWith("]");
}

/** Every `{name}` used in a text. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}
