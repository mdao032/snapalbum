/**
 * EXIF orientation (1 to 8): how a photo is stored compared with how it must be shown. The
 * browser applies it when it decodes; where it does not, the preparation applies it itself with
 * this transform, so display versions and thumbnails are always upright.
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** `setTransform(a, b, c, d, e, f)` arguments of a canvas 2D context. */
export type TransformMatrix = readonly [number, number, number, number, number, number];

export interface OrientationTransform {
  /** Size of the upright picture. */
  width: number;
  height: number;
  /** Draws the stored picture (`width` x `height` as stored) upright at the origin. */
  matrix: TransformMatrix;
}

export function isExifOrientation(value: unknown): value is ExifOrientation {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8;
}

/** True when the stored width and height are swapped on display (orientations 5 to 8). */
export function swapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

/** The canvas transform that draws a stored picture of `width` x `height` upright. */
export function orientationTransform(
  orientation: ExifOrientation,
  width: number,
  height: number,
): OrientationTransform {
  switch (orientation) {
    case 2:
      return { width, height, matrix: [-1, 0, 0, 1, width, 0] };
    case 3:
      return { width, height, matrix: [-1, 0, 0, -1, width, height] };
    case 4:
      return { width, height, matrix: [1, 0, 0, -1, 0, height] };
    case 5:
      return { width: height, height: width, matrix: [0, 1, 1, 0, 0, 0] };
    case 6:
      return { width: height, height: width, matrix: [0, 1, -1, 0, height, 0] };
    case 7:
      return { width: height, height: width, matrix: [0, -1, -1, 0, height, width] };
    case 8:
      return { width: height, height: width, matrix: [0, -1, 1, 0, 0, width] };
    default:
      return { width, height, matrix: [1, 0, 0, 1, 0, 0] };
  }
}
