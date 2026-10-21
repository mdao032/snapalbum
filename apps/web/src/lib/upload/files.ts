import { PrepareError } from "@snapalbum/shared/upload";
import { ORIGINAL_EXTENSIONS } from "@snapalbum/shared/storage";

/** Pure helpers of the file preparation: names, types, fingerprint and sizes (unit tested). */

/** Files above this size are fingerprinted from samples instead of read whole into memory. */
const FULL_HASH_LIMIT_BYTES = 64 * 1024 * 1024;
const SAMPLE_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

/** The type a phone declares is sometimes empty or odd (`image/jpg`): settle it from both clues. */
export function resolveMimeType(file: { name: string; type: string }): string {
  const declared = file.type.toLowerCase().replace("image/jpg", "image/jpeg");
  if (declared && declared !== "application/octet-stream") return declared;
  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? declared;
}

/** The extension to store the original under, from the name or else from the type. */
export function resolveExtension(file: { name: string; type: string }): string {
  const fromName = extensionOf(file.name);
  if ((ORIGINAL_EXTENSIONS as readonly string[]).includes(fromName)) return fromName;
  const mime = resolveMimeType(file);
  const found = Object.entries(MIME_BY_EXTENSION).find(([, type]) => type === mime)?.[0];
  if (!found) throw new PrepareError("unsupported_format");
  return found;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 identifying the file (NF-012). Whole file up to 64 MB; for bigger videos the size and
 * three 4 MB samples (start, middle, end), which keeps memory low on phones while still telling
 * two different videos apart in practice.
 */
export async function fingerprint(file: Blob): Promise<string> {
  if (file.size <= FULL_HASH_LIMIT_BYTES) {
    return hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  }
  const middle = Math.floor(file.size / 2) - SAMPLE_BYTES / 2;
  const parts = [
    new TextEncoder().encode(`size:${file.size};`),
    new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer()),
    new Uint8Array(await file.slice(middle, middle + SAMPLE_BYTES).arrayBuffer()),
    new Uint8Array(await file.slice(file.size - SAMPLE_BYTES).arrayBuffer()),
  ];
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return hex(await crypto.subtle.digest("SHA-256", joined));
}

export function scaledSize(width: number, height: number, maxPx: number) {
  const scale = Math.min(1, maxPx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
