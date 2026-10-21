import {
  BLURHASH_COMPONENTS,
  BLURHASH_SAMPLE_PX,
  detectFileFormat,
  encodeBlurhash,
  orientationTransform,
  PrepareError,
  readJpegMetadata,
  type DetectedFormat,
  type ExifOrientation,
  type TransformMatrix,
} from "@snapalbum/shared/upload";
import { deviceOffsetAt, fingerprint, resolveTakenAt } from "./files";
import { orientationBehaviour } from "./orientation-probe";
import {
  CanvasUnavailableError,
  drawScaled,
  readPixels,
  type DrawableSource,
  type Surface,
} from "./surface";

/** Longest side of the display version and of the thumbnail (SPEC 8.1). */
export const DISPLAY_MAX_PX = 2048;
export const THUMB_MAX_PX = 400;
const DISPLAY_QUALITY = 0.82;
const THUMB_QUALITY = 0.7;
/** The EXIF block of a JPEG sits before the image data, in the first tens of kilobytes. */
const HEAD_BYTES = 256 * 1024;
const PHOTO_FORMATS: readonly DetectedFormat[] = ["jpeg", "png", "webp", "heic"];
const IDENTITY: TransformMatrix = [1, 0, 0, 1, 0, 0];

/**
 * What the preparation of one photo yields (SPEC 8.1, step 2). It runs unchanged in the Web Worker
 * and, where a worker or `OffscreenCanvas` is missing, on the main thread.
 */
export interface PreparedImage {
  /** Size of the photo once upright. */
  width: number;
  height: number;
  display: Blob;
  thumb: Blob;
  previewFormat: "webp" | "jpeg";
  blurhash: string;
  takenAt?: string;
  sha256: string;
}

interface Decoded {
  source: DrawableSource;
  /** Size of `source` as stored. */
  width: number;
  height: number;
  /** Orientation still to apply: 1 when the browser or libheif has already turned the picture. */
  orientation: ExifOrientation;
  release(): void;
}

/** A browser reads the file itself; where it cannot (HEIC), libheif takes over. */
async function decode(
  file: Blob,
  format: DetectedFormat,
  exifOrientation: ExifOrientation | undefined,
): Promise<Decoded> {
  try {
    const behaviour = await orientationBehaviour();
    const bitmap = await createImageBitmap(file, behaviour.options);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      orientation: format === "jpeg" && !behaviour.applied ? (exifOrientation ?? 1) : 1,
      release: () => bitmap.close(),
    };
  } catch {
    // Anything but a HEIC the browser cannot read is simply a damaged file.
    if (format !== "heic") throw new PrepareError("corrupted");
  }

  // Loaded only now, only for the guests whose browser cannot read HEIC (decisions.md).
  const { decodeHeic, HeicDecodeError } = await import("./heic");
  try {
    const image = await decodeHeic(file);
    const bitmap = await createImageBitmap(new ImageData(image.data, image.width, image.height));
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      orientation: 1,
      release: () => bitmap.close(),
    };
  } catch (error) {
    // A decoder that did not load is a connection problem and is tried again; a file it cannot
    // read is for this guest to replace by a more common format.
    if (error instanceof HeicDecodeError) throw new PrepareError("unsupported_format");
    throw error;
  }
}

/** Encodes as WebP, or as JPEG where the browser cannot (Safari encodes neither without help). */
async function encode(
  surface: Surface,
  format: "webp" | "jpeg",
  quality: number,
): Promise<{ blob: Blob; format: "webp" | "jpeg" }> {
  if (format === "webp") {
    const webp = await surface.toBlob("image/webp", quality);
    if (webp && webp.type === "image/webp") return { blob: webp, format };
  }
  const jpeg = await surface.toBlob("image/jpeg", Math.min(0.9, quality + 0.05));
  if (!jpeg) throw new PrepareError("corrupted");
  return { blob: jpeg, format: "jpeg" };
}

/** BlurHash of a surface (its pixels reduced to `BLURHASH_SAMPLE_PX`). */
export function blurhashOf(surface: Surface): string {
  const sample = drawScaled(
    surface.source,
    surface.width,
    surface.height,
    surface.width,
    surface.height,
    IDENTITY,
    BLURHASH_SAMPLE_PX,
  );
  if (!sample) throw new CanvasUnavailableError();
  const pixels = readPixels(sample);
  return encodeBlurhash(
    pixels.data,
    pixels.width,
    pixels.height,
    BLURHASH_COMPONENTS.x,
    BLURHASH_COMPONENTS.y,
  );
}

/**
 * The thumbnail of any picture, as a surface of at most `THUMB_MAX_PX`. Its re-encoding drops
 * every metadata block, GPS included (S-008).
 */
export function thumbnailOf(
  source: DrawableSource,
  width: number,
  height: number,
  matrix: TransformMatrix = IDENTITY,
  uprightWidth: number = width,
  uprightHeight: number = height,
): Surface {
  const surface = drawScaled(
    source,
    width,
    height,
    uprightWidth,
    uprightHeight,
    matrix,
    THUMB_MAX_PX,
  );
  if (!surface) throw new CanvasUnavailableError();
  return surface;
}

export async function encodeThumbnail(surface: Surface) {
  return encode(surface, "webp", THUMB_QUALITY);
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const format = detectFileFormat(head);
  // The declared type is only a claim: what the bytes are decides (a web page renamed .jpg, S-002).
  if (format === null || !PHOTO_FORMATS.includes(format)) throw new PrepareError("corrupted");

  const metadata = format === "jpeg" ? readJpegMetadata(head) : null;
  // Hashed while the picture is decoded: both read the whole file.
  const hashing = fingerprint(file);
  hashing.catch(() => undefined);

  const decoded = await decode(file, format, metadata?.orientation);
  try {
    const upright = orientationTransform(decoded.orientation, decoded.width, decoded.height);
    const displaySurface = drawScaled(
      decoded.source,
      decoded.width,
      decoded.height,
      upright.width,
      upright.height,
      upright.matrix,
      DISPLAY_MAX_PX,
    );
    if (!displaySurface) throw new CanvasUnavailableError();

    const display = await encode(displaySurface, "webp", DISPLAY_QUALITY);
    // The thumbnail is made from the display version (already upright, already smaller): faster
    // and smoother than reducing the full-size picture twice.
    const thumbSurface = thumbnailOf(
      displaySurface.source,
      displaySurface.width,
      displaySurface.height,
    );
    const thumb = await encode(thumbSurface, display.format, THUMB_QUALITY);

    return {
      width: upright.width,
      height: upright.height,
      display: display.blob,
      thumb: thumb.blob,
      previewFormat: display.format === "jpeg" || thumb.format === "jpeg" ? "jpeg" : "webp",
      blurhash: blurhashOf(thumbSurface),
      takenAt: resolveTakenAt(file, metadata, deviceOffsetAt),
      sha256: await hashing,
    };
  } finally {
    decoded.release();
  }
}
