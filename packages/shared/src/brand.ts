/**
 * Single source of truth for the product identity.
 * "Snapalbum" is a working name: change it here (and nowhere else) to rename the product.
 */
export const APP_NAME = "Snapalbum";

export const BRAND_COLORS = {
  /** Deep ink, used for text and strong surfaces. */
  ink: "#14121f",
  /** Main accent. */
  primary: "#6d4aff",
  /** Warm secondary accent used for highlights and success moments. */
  warm: "#ff7a59",
  /** Soft canvas behind the interface. */
  canvas: "#faf9fd",
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;
