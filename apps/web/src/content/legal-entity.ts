/**
 * Who publishes the service, for the legal pages (step 5.2). **To fill in by the owner**: every
 * `null` is shown on the page as a highlighted "to be completed" mark, so nothing is invented.
 */
export interface LegalEntity {
  company: string | null;
  legalForm: string | null;
  siret: string | null;
  address: string | null;
  director: string | null;
  contact: string | null;
  vatNumber: string | null;
  /** Consumer mediator named in the terms of sale (compulsory when selling to consumers). */
  mediator: string | null;
  /** Court that has jurisdiction, e.g. "le tribunal judiciaire de Paris". */
  court: string | null;
  /** Postal address of the web host (Vercel). */
  hostAddress: string | null;
}

export const LEGAL_ENTITY: LegalEntity = {
  company: null,
  legalForm: null,
  siret: null,
  address: null,
  director: null,
  contact: null,
  vatNumber: null,
  mediator: null,
  court: null,
  hostAddress: null,
};

/**
 * Set `reviewedByLawyer` to true only when a lawyer has validated the texts (G-001): the draft
 * notice disappears, the pages become indexable and enter the sitemap.
 */
export const LEGAL_STATUS = {
  reviewedByLawyer: false,
  /** Day of the last change of the texts (ISO date). */
  lastUpdated: "2026-10-22",
} as const;
