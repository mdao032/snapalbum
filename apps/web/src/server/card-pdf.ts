import "server-only";
import {
  CARD_PAGE_MM,
  messages,
  parseHexColor,
  type CardFormat,
  type Locale,
} from "@snapalbum/shared";
import { APP_NAME, BRAND_COLORS } from "@snapalbum/shared/brand";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { mm, sanitizeForFont, wrapText } from "./card-layout";
import { QUIET_ZONE_MODULES, qrMatrix } from "./qr";

export interface CardInput {
  format: CardFormat;
  /** Event name, drawn as the headline. */
  title: string;
  /** Language of the guests: the card speaks it (the event's language). */
  locale: Locale;
  /** The permanent short link, printed under the code. */
  link: string;
  /** Color of the header band and of the code's modules (already readable on white). */
  accentColor: string;
  /** Dark color of the QR code modules. */
  qrColor: string;
}

const MUTED = "#5f5b73";

function color(hex: string) {
  const [r, g, b] = parseHexColor(hex);
  return rgb(r / 255, g / 255, b / 255);
}

/**
 * One printed face (a whole A6/A5 sheet, or one half of the table tent). It is drawn in its own
 * coordinates (origin bottom-left); when `rotated`, everything is mapped upside down so the upper
 * half of a folded tent reads correctly from the other side.
 */
class Face {
  constructor(
    private readonly page: PDFPage,
    private readonly box: { x: number; y: number; width: number; height: number },
    private readonly rotated: boolean,
  ) {}

  get width() {
    return this.box.width;
  }

  get height() {
    return this.box.height;
  }

  rect(x: number, y: number, width: number, height: number, fill: string) {
    const px = this.rotated ? this.box.x + this.box.width - x - width : this.box.x + x;
    const py = this.rotated ? this.box.y + this.box.height - y - height : this.box.y + y;
    this.page.drawRectangle({ x: px, y: py, width, height, color: color(fill) });
  }

  /** Text centered on the face; `baseline` is the distance from the bottom edge. */
  centeredText(value: string, font: PDFFont, size: number, baseline: number, fill: string) {
    const left = (this.box.width - font.widthOfTextAtSize(value, size)) / 2;
    this.page.drawText(value, {
      x: this.rotated ? this.box.x + this.box.width - left : this.box.x + left,
      y: this.rotated ? this.box.y + this.box.height - baseline : this.box.y + baseline,
      size,
      font,
      color: color(fill),
      rotate: degrees(this.rotated ? 180 : 0),
    });
  }
}

function drawQr(face: Face, text: string, qrColor: string, side: number, top: number) {
  const matrix = qrMatrix(text);
  const modules = matrix.size + QUIET_ZONE_MODULES * 2;
  const unit = side / modules;
  const left = (face.width - side) / 2;
  const bottom = face.height - top - side;
  face.rect(left, bottom, side, side, "#ffffff");

  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0;
    while (column < matrix.size) {
      if (!matrix.isDark(column, row)) {
        column += 1;
        continue;
      }
      // One rectangle per horizontal run of dark modules; a hair of overlap hides seams.
      const start = column;
      while (column < matrix.size && matrix.isDark(column, row)) column += 1;
      face.rect(
        left + (start + QUIET_ZONE_MODULES) * unit,
        bottom + side - (row + 1 + QUIET_ZONE_MODULES) * unit - 0.15,
        (column - start) * unit + 0.1,
        unit + 0.3,
        qrColor,
      );
    }
  }
}

function drawFace(face: Face, input: CardInput, fonts: { regular: PDFFont; bold: PDFFont }) {
  const copy = messages[input.locale].printables;
  const { width, height } = face;
  // Everything is sized for an A6 card and scaled to the face it is drawn on.
  const scale = Math.min(width / mm(105), height / mm(148));
  const contentWidth = width * 0.84;
  const supported = new Set(fonts.bold.getCharacterSet());

  const band = height * 0.12;
  face.rect(0, height - band, width, band, input.accentColor);

  // Headline: as large as fits in three lines.
  const title = sanitizeForFont(input.title, supported);
  let titleSize = 22 * scale;
  const measureTitle = (v: string) => fonts.bold.widthOfTextAtSize(v, titleSize);
  while (wrapText(title, contentWidth, 99, measureTitle).length > 3 && titleSize > 13 * scale) {
    titleSize *= 0.9;
  }
  const lines = wrapText(title, contentWidth, 3, measureTitle);
  const lineHeight = titleSize * 1.18;
  let cursor = height - band - 26 * scale;
  for (const line of lines) {
    cursor -= titleSize;
    face.centeredText(line, fonts.bold, titleSize, cursor, BRAND_COLORS.ink);
    cursor -= lineHeight - titleSize;
  }

  cursor -= 14 * scale;
  const instructionSize = 15 * scale;
  cursor -= instructionSize;
  face.centeredText(
    sanitizeForFont(copy.instruction, supported),
    fonts.bold,
    instructionSize,
    cursor,
    BRAND_COLORS.ink,
  );
  cursor -= 6 * scale;
  const subSize = 11 * scale;
  cursor -= subSize;
  face.centeredText(copy.subInstruction, fonts.regular, subSize, cursor, MUTED);

  // The code takes the room left between the texts above and the link and name below.
  const footer = 22 * scale;
  const linkSize = 10.5 * scale;
  const linkBlock = linkSize + 12 * scale;
  cursor -= 14 * scale;
  const available = cursor - footer - linkBlock;
  const side = Math.max(60, Math.min(width * 0.62, available));
  drawQr(face, input.link, input.qrColor, side, height - cursor);

  const linkText = input.link.replace(/^https?:\/\//, "");
  face.centeredText(
    linkText,
    fonts.regular,
    linkSize,
    cursor - side - 8 * scale - linkSize,
    BRAND_COLORS.ink,
  );
  face.centeredText(APP_NAME, fonts.bold, 9 * scale, 10 * scale, input.accentColor);
}

/** Printable card (F-014): A6, A5, or an A4 sheet folded into a table tent. */
export async function buildCardPdf(input: CardInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  doc.setTitle(
    `${APP_NAME} - ${sanitizeForFont(input.title, new Set(fonts.bold.getCharacterSet()))}`,
  );
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);

  const size = CARD_PAGE_MM[input.format];
  const pageWidth = mm(size.width);
  const pageHeight = mm(size.height);
  const page = doc.addPage([pageWidth, pageHeight]);

  if (input.format !== "tent") {
    drawFace(
      new Face(page, { x: 0, y: 0, width: pageWidth, height: pageHeight }, false),
      input,
      fonts,
    );
  } else {
    const half = pageHeight / 2;
    // Lower half reads normally; upper half is upside down, so both sides read once folded.
    drawFace(new Face(page, { x: 0, y: 0, width: pageWidth, height: half }, false), input, fonts);
    drawFace(new Face(page, { x: 0, y: half, width: pageWidth, height: half }, true), input, fonts);

    page.drawLine({
      start: { x: 0, y: half },
      end: { x: pageWidth, y: half },
      thickness: 0.6,
      color: color("#ffffff"),
      dashArray: [6, 4],
    });
    const fold = messages[input.locale].printables.foldHere;
    page.drawText(fold, {
      x: pageWidth - 16 - fonts.regular.widthOfTextAtSize(fold, 8),
      y: half + 3,
      size: 8,
      font: fonts.regular,
      color: color("#ffffff"),
    });
  }

  return doc.save();
}
