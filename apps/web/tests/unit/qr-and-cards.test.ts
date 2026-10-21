// @vitest-environment node
import { contrastRatio } from "@snapalbum/shared";
import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { mm, sanitizeForFont, wrapText } from "@/server/card-layout";
import { buildCardPdf } from "@/server/card-pdf";
import { qrDarkColor, qrMatrix, qrPng, qrSvg } from "@/server/qr";

const LINK = "https://s.example.test/k7m2x9qvbr";

function decode(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

describe("F-013: QR code", () => {
  it("F-013: le PNG fait 1 024 px et se décode en lien court exact", async () => {
    const png = await qrPng(LINK, qrDarkColor("ink", null));
    const image = PNG.sync.read(png);
    expect(image.width).toBe(1024);
    expect(image.height).toBe(1024);
    expect(decode(png)).toBe(LINK);
  });

  it.each(["#6d4aff", "#ffd400", "#ffffff", "#be185d", "#1d4ed8", "#15803d", "#c2410c", "#334155"])(
    "F-013: la couleur d'événement %s donne un QR code lisible et contrasté",
    async (accent) => {
      const dark = qrDarkColor("accent", accent);
      expect(contrastRatio(dark, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(decode(await qrPng(LINK, dark))).toBe(LINK);
    },
  );

  it("F-013: sans couleur d'événement, le mode accent reprend la couleur du produit", () => {
    expect(qrDarkColor("accent", null)).toBe("#6d4aff");
    expect(qrDarkColor("ink", "#be185d")).toBe("#14121f");
  });

  it("F-013: le SVG est vectoriel, dans la couleur demandée", async () => {
    const svg = await qrSvg(LINK, "#be185d");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("#be185d");
    expect(svg).toContain("viewBox");
  });

  it("F-013: le niveau de correction est élevé (H) : un code plus dense que le niveau bas", () => {
    // Version 3 (29 modules) holds this link at level H; level L would fit in version 2 (25).
    expect(qrMatrix(LINK).size).toBeGreaterThanOrEqual(29);
  });

  it("F-013: la matrice répond à isDark pour chaque module", () => {
    const matrix = qrMatrix(LINK);
    // The top-left finder pattern always starts with a dark module.
    expect(matrix.isDark(0, 0)).toBe(true);
    expect(matrix.isDark(matrix.size - 1, 0)).toBe(true);
  });
});

describe("F-014: aides de mise en page des cartes", () => {
  const measure = (value: string) => value.length * 10;

  it("F-014: remplace les caractères que la police ne sait pas dessiner", () => {
    const supported = new Set([..."Fête de Léa"].map((c) => c.codePointAt(0) ?? 0));
    expect(sanitizeForFont("Fête de Léa 🎉", supported)).toBe("Fête de Léa ?");
    expect(sanitizeForFont("  Fête   de\nLéa ", supported)).toBe("Fête de Léa");
  });

  it("F-014: passe à la ligne sans dépasser la largeur", () => {
    expect(wrapText("Mariage de Léa et Tom", 120, 5, measure)).toEqual([
      "Mariage de",
      "Léa et Tom",
    ]);
  });

  it("F-014: coupe un mot plus large qu'une ligne", () => {
    const lines = wrapText("Anticonstitutionnellement", 100, 5, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => measure(line) <= 100)).toBe(true);
    expect(lines.join("")).toBe("Anticonstitutionnellement");
  });

  it("F-014: limite le nombre de lignes avec des points de suspension", () => {
    const lines = wrapText("un deux trois quatre cinq six sept huit", 60, 2, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(lines.every((line) => measure(line) <= 60)).toBe(true);
  });

  it("F-014: convertit les millimètres en points", () => {
    expect(mm(25.4)).toBeCloseTo(72);
  });
});

describe("F-014: cartes PDF", () => {
  const base = {
    title: "Mariage de Léa et Tom",
    locale: "fr" as const,
    link: LINK,
    accentColor: "#be185d",
    qrColor: "#14121f",
  };

  it.each([
    ["a6", 105, 148],
    ["a5", 148, 210],
    ["tent", 210, 297],
  ] as const)("F-014: la carte %s est une page de %i × %i mm", async (format, width, height) => {
    const bytes = await buildCardPdf({ ...base, format });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(mm(width), 1);
    expect(page.getHeight()).toBeCloseTo(mm(height), 1);
  });

  it("F-014: un nom d'événement avec emoji, accents rares ou très long ne fait pas échouer le PDF", async () => {
    const titles = [
      "Soirée 🎉 de Léa ❤️",
      "Żółć — 結婚式",
      "Le très long mariage de Léa-Marie Dupont-Lefèvre et Jean-Baptiste de La Tour d'Auvergne",
    ];
    for (const title of titles) {
      const bytes = await buildCardPdf({ ...base, title, format: "a6" });
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("F-014: la carte en anglais se génère aussi", async () => {
    const bytes = await buildCardPdf({ ...base, locale: "en", format: "tent" });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
