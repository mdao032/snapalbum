import { z } from "zod";

/** Printed card formats (F-014). `tent` is a folded table tent made from one A4 sheet. */
export const CARD_FORMATS = ["a6", "a5", "tent"] as const;
export const cardFormatSchema = z.enum(CARD_FORMATS);
export type CardFormat = z.infer<typeof cardFormatSchema>;

/** Page size of each format in millimetres (portrait). */
export const CARD_PAGE_MM: Record<CardFormat, { width: number; height: number }> = {
  a6: { width: 105, height: 148 },
  a5: { width: 148, height: 210 },
  tent: { width: 210, height: 297 },
};

export const QR_FORMATS = ["svg", "png"] as const;
/** `ink` is dark on white; `accent` uses the event's color (made readable, so scannable). */
export const QR_COLOR_MODES = ["ink", "accent"] as const;

/** Query of the QR code route (F-013). Invalid values fall back to the defaults. */
export const qrQuerySchema = z.object({
  format: z.enum(QR_FORMATS).catch("svg"),
  color: z.enum(QR_COLOR_MODES).catch("ink"),
  download: z
    .enum(["1", "0"])
    .catch("0")
    .transform((value) => value === "1"),
});
export type QrQuery = z.infer<typeof qrQuerySchema>;

/** Query of the printable card route (F-014). */
export const cardQuerySchema = z.object({
  format: cardFormatSchema,
  color: z.enum(QR_COLOR_MODES).catch("ink"),
});
export type CardQuery = z.infer<typeof cardQuerySchema>;

/** Output size of the PNG QR code (F-013). */
export const QR_PNG_SIZE_PX = 1024;
