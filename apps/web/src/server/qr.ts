import "server-only";
import { BRAND_COLORS } from "@snapalbum/shared/brand";
import { makeAccentReadable, QR_PNG_SIZE_PX, type QrQuery } from "@snapalbum/shared";
import QRCode from "qrcode";

/** Quiet zone around the code, in modules (the QR standard asks for 4). */
const QUIET_ZONE_MODULES = 4;
const LIGHT = "#ffffff";

/**
 * The dark color of the code (F-013). The accent is first made readable against white (WCAG AA,
 * 4.5:1), which also keeps it well above what phone cameras need to scan.
 */
export function qrDarkColor(mode: QrQuery["color"], accentColor: string | null): string {
  if (mode === "accent") return makeAccentReadable(accentColor ?? BRAND_COLORS.primary);
  return BRAND_COLORS.ink;
}

/** Highest error correction (level H): the code survives print defects and a logo-sized hole. */
function options(dark: string) {
  return {
    errorCorrectionLevel: "H" as const,
    margin: QUIET_ZONE_MODULES,
    color: { dark, light: LIGHT },
  };
}

export function qrSvg(text: string, dark: string): Promise<string> {
  return QRCode.toString(text, { ...options(dark), type: "svg" });
}

export function qrPng(text: string, dark: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...options(dark), type: "png", width: QR_PNG_SIZE_PX });
}

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  isDark: (column: number, row: number) => boolean;
}

/** The module grid, to draw the code as vector squares in a PDF (crisp at any print size). */
export function qrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "H" });
  return {
    size: modules.size,
    isDark: (column, row) => modules.get(row, column) === 1,
  };
}

export { QUIET_ZONE_MODULES };
