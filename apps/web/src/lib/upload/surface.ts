import type { TransformMatrix } from "@snapalbum/shared/upload";
import { scaledSize } from "./files";

/**
 * A drawing surface that works in the preparation Web Worker (`OffscreenCanvas`) and on the main
 * thread (a canvas element), so the preparation is written once and runs in either place.
 */

export type DrawableSource = CanvasImageSource;

/** No canvas could be created here (a worker without 2D canvas, memory exhausted). */
export class CanvasUnavailableError extends Error {
  constructor() {
    super("No canvas available");
    this.name = "CanvasUnavailableError";
  }
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Surface {
  width: number;
  height: number;
  context: Context2D;
  /** The surface as a file of `type`, or null where the browser cannot encode that type. */
  toBlob(type: string, quality: number): Promise<Blob | null>;
  /** The surface itself, to draw it onto another one. */
  source: DrawableSource;
}

/** Null where no canvas can be had (the caller falls back or refuses the file). */
export function createSurface(width: number, height: number): Surface | null {
  try {
    // A worker has no document: its canvas is an `OffscreenCanvas`. The main thread keeps the
    // element, which every browser that can run the page supports.
    if (typeof document === "undefined") {
      if (typeof OffscreenCanvas === "undefined") return null;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      return {
        width,
        height,
        context,
        source: canvas,
        toBlob: (type, quality) => canvas.convertToBlob({ type, quality }).catch(() => null),
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    return {
      width,
      height,
      context,
      source: canvas,
      toBlob: (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
    };
  } catch {
    // Canvas memory exhausted on a small phone, for instance.
    return null;
  }
}

/**
 * `source` (a picture of `sourceWidth` x `sourceHeight`) drawn upright onto a new surface of at
 * most `maxPx` on the longest side. `matrix` is the orientation transform in the source's own
 * pixels (`orientationTransform`), the identity when the browser already turned the picture.
 */
export function drawScaled(
  source: DrawableSource,
  sourceWidth: number,
  sourceHeight: number,
  uprightWidth: number,
  uprightHeight: number,
  matrix: TransformMatrix,
  maxPx: number,
): Surface | null {
  const size = scaledSize(uprightWidth, uprightHeight, maxPx);
  const surface = createSurface(size.width, size.height);
  if (!surface) return null;
  const scaleX = size.width / uprightWidth;
  const scaleY = size.height / uprightHeight;
  const [a, b, c, d, e, f] = matrix;
  surface.context.imageSmoothingEnabled = true;
  surface.context.imageSmoothingQuality = "high";
  // Orientation first (in source pixels), then the reduction to the target size.
  surface.context.setTransform(
    a * scaleX,
    b * scaleY,
    c * scaleX,
    d * scaleY,
    e * scaleX,
    f * scaleY,
  );
  surface.context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  surface.context.setTransform(1, 0, 0, 1, 0, 0);
  return surface;
}

/** The pixels of a surface (RGBA), for the BlurHash. */
export function readPixels(surface: Surface): ImageData {
  return surface.context.getImageData(0, 0, surface.width, surface.height);
}
