/**
 * The file types an organiser's guests may send (SPEC 8.1) and how to recognise them. Shared by
 * the browser (to refuse early), the server (to refuse for good) and the mobile apps.
 */

export type MediaKindOfFile = "photo" | "video";

interface FormatInfo {
  kind: MediaKindOfFile;
  /** Extensions the original may be stored with (`mediaKey` accepts exactly these). */
  extensions: readonly string[];
}

/** MIME type declared by the device -> what it means. Anything else is `unsupported_format`. */
export const ACCEPTED_MIME_TYPES: Readonly<Record<string, FormatInfo>> = {
  "image/jpeg": { kind: "photo", extensions: ["jpg", "jpeg"] },
  "image/png": { kind: "photo", extensions: ["png"] },
  "image/webp": { kind: "photo", extensions: ["webp"] },
  "image/heic": { kind: "photo", extensions: ["heic"] },
  "image/heif": { kind: "photo", extensions: ["heif", "heic"] },
  "video/mp4": { kind: "video", extensions: ["mp4", "m4v"] },
  "video/quicktime": { kind: "video", extensions: ["mov"] },
  "video/x-m4v": { kind: "video", extensions: ["m4v", "mp4"] },
  "video/webm": { kind: "video", extensions: ["webm"] },
};

export type DetectedFormat = "jpeg" | "png" | "webp" | "heic" | "mp4" | "mov" | "webm";

/** Formats a stored file may really have, by the kind of media it is declared to be. */
const FORMATS_BY_KIND: Record<MediaKindOfFile, readonly DetectedFormat[]> = {
  photo: ["jpeg", "png", "webp", "heic"],
  video: ["mp4", "mov", "webm"],
};

/** `ok` when the declared type and extension are accepted and agree with the declared kind. */
export function checkDeclaredFormat(
  mimeType: string,
  extension: string,
  kind: MediaKindOfFile,
): boolean {
  const info = ACCEPTED_MIME_TYPES[mimeType.toLowerCase()];
  return Boolean(info && info.kind === kind && info.extensions.includes(extension.toLowerCase()));
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Recognises a file from its first bytes (S-002): the declared type is only a claim, the content
 * decides. Returns null for anything that is not one of the accepted formats.
 */
export function detectFileFormat(bytes: Uint8Array): DetectedFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "webp";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "webm";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"].includes(brand))
      return "heic";
    if (brand === "qt  ") return "mov";
    return "mp4";
  }
  return null;
}

/** Whether `bytes` really are a file of the declared kind. */
export function matchesKind(bytes: Uint8Array, kind: MediaKindOfFile): boolean {
  const format = detectFileFormat(bytes);
  return format !== null && FORMATS_BY_KIND[kind].includes(format);
}

/** The prepared versions (display, thumbnail) are always WebP, or JPEG where WebP is missing. */
export function isPreviewImage(bytes: Uint8Array): boolean {
  const format = detectFileFormat(bytes);
  return format === "webp" || format === "jpeg";
}
