/**
 * Layout of the gallery grid (F-050): rows of photos of equal height that fill the width, like a
 * printed contact sheet. Pure arithmetic, shared by the web and the apps, so the grid can be
 * virtualised by row: the height of every row is known without drawing anything.
 */

/** A photo wider or taller than this ratio is cropped to it, so one panorama cannot ruin a row. */
export const MIN_ASPECT = 0.5;
export const MAX_ASPECT = 2.5;
/** Ratio of a media whose size is not known (a 4:3 photo). */
export const DEFAULT_ASPECT = 4 / 3;

export interface GridOptions {
  /** Width of the grid in pixels. */
  width: number;
  /** Height a row aims for; a full row is scaled to fill the width exactly. */
  targetHeight: number;
  /** Space between two thumbnails, in pixels. */
  gap: number;
}

export interface GridCell {
  /** Position of the media in the list given to `buildRows`. */
  index: number;
  width: number;
}

export interface GridRow {
  cells: GridCell[];
  height: number;
}

/** Width over height of a media, kept within sensible bounds. */
export function aspectOf(width: number | null, height: number | null): number {
  if (!width || !height || width <= 0 || height <= 0) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, width / height));
}

/**
 * Rows for media of the given aspect ratios. A row is closed as soon as its thumbnails, at the
 * target height, fill the width: it is then scaled to fill the width exactly. The last row is kept
 * at the target height (never stretched), since more media may follow.
 */
export function buildRows(aspects: readonly number[], options: GridOptions): GridRow[] {
  const { width, targetHeight, gap } = options;
  if (width <= 0 || targetHeight <= 0) return [];

  const rows: GridRow[] = [];
  let current: GridCell[] = [];
  let ratioSum = 0;

  const close = (stretch: boolean) => {
    if (current.length === 0) return;
    const free = width - gap * (current.length - 1);
    const height = stretch ? free / ratioSum : targetHeight;
    // Widths are whole pixels; the last cell takes the rounding remainder of a stretched row.
    let used = 0;
    const cells = current.map((cell, position) => {
      const isLast = position === current.length - 1;
      const cellWidth =
        stretch && isLast
          ? free - used
          : Math.floor((aspects[cell.index] ?? DEFAULT_ASPECT) * height);
      used += cellWidth;
      return { index: cell.index, width: cellWidth };
    });
    rows.push({ cells, height: Math.floor(height) });
    current = [];
    ratioSum = 0;
  };

  aspects.forEach((aspect, index) => {
    current.push({ index, width: 0 });
    ratioSum += aspect;
    const filled = ratioSum * targetHeight + gap * (current.length - 1);
    if (filled >= width) close(true);
  });
  close(false);
  return rows;
}

/** Height of the whole grid, gaps between rows included. */
export function totalHeight(rows: readonly GridRow[], gap: number): number {
  return rows.reduce((sum, row, position) => sum + row.height + (position > 0 ? gap : 0), 0);
}

/** Thumbnail height that suits a screen: bigger on a wide grid, so a row never holds too many. */
export function targetHeightFor(width: number): number {
  if (width < 480) return 120;
  if (width < 900) return 160;
  return 200;
}
