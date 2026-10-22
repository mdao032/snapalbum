/**
 * Testimonials shown on the home page. **Real ones only** (step 5.1): each entry must come from a
 * person who agreed to be quoted. The list stays empty until there are some, and the section does
 * not appear while it is empty.
 */
export interface Testimonial {
  /** What the person said, in their own words, per language. */
  quote: { fr: string; en: string };
  /** First name and, if they agreed, their role or occasion ("Marie, mariage de juin"). */
  author: string;
}

export const TESTIMONIALS: readonly Testimonial[] = [];
