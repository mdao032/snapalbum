/**
 * Where each file lives in the private R2 bucket (SPEC 9.1), and how long the signed addresses
 * that give access to it last. No dependency: the web, the mobile apps and the server share it.
 */

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const READ_URL_TTL_SECONDS = 60 * 60;

const MB = 1024 * 1024;
/** Videos above this size are sent in parts (NF-013), each part this big except the last. */
export const MULTIPART_THRESHOLD_BYTES = 50 * MB;
export const MULTIPART_PART_SIZE_BYTES = 10 * MB;
/** S3 accepts at most 10 000 parts: with 10 MB parts, far above any allowed video size. */
export const MULTIPART_MAX_PARTS = 10_000;

/** What can be stored for an event. `original` keeps the file as received (paid plans only, R2). */
export const MEDIA_VARIANTS = ["original", "display", "thumb"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Extensions an original may have: what phones produce and the formats accepted by the pipeline. */
export const ORIGINAL_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "webp",
  "mp4",
  "mov",
  "m4v",
  "webm",
] as const;

function assertUuid(name: string, value: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${name}: ${value}`);
}

/** Normalised extension without the dot, or an error: never a path fragment from user input. */
function cleanExtension(extension: string): string {
  const value = extension.replace(/^\./, "").toLowerCase();
  if (!(ORIGINAL_EXTENSIONS as readonly string[]).includes(value)) {
    throw new Error(`Unsupported file extension: ${extension}`);
  }
  return value;
}

/** `events/{event}/original/{media}.{ext}`, `.../display/{media}.webp`, `.../thumb/{media}.webp`. */
export function mediaKey(
  eventId: string,
  mediaId: string,
  variant: MediaVariant,
  extension = "webp",
): string {
  assertUuid("event id", eventId);
  assertUuid("media id", mediaId);
  const ext = variant === "original" ? cleanExtension(extension) : "webp";
  return `events/${eventId}/${variant}/${mediaId}.${ext}`;
}

const COVER_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** `events/{event}/cover/{file}` for the organiser's cover photo. */
export function coverKey(eventId: string, fileName: string): string {
  assertUuid("event id", eventId);
  const name = fileName.toLowerCase();
  if (!COVER_NAME.test(name) || name.includes(".."))
    throw new Error(`Invalid cover file name: ${fileName}`);
  return `events/${eventId}/cover/${name}`;
}

/** Prefix holding everything of an event, used to purge it (R5). */
export function eventPrefix(eventId: string): string {
  assertUuid("event id", eventId);
  return `events/${eventId}/`;
}

/** The event a key belongs to, or null if it is not one of ours. */
export function eventIdOfKey(key: string): string | null {
  const match = /^events\/([0-9a-f-]{36})\//.exec(key);
  return match?.[1] && UUID.test(match[1]) ? match[1] : null;
}

/** Number of parts of a multipart upload of `bytes` (at least 1). */
export function multipartPartCount(bytes: number): number {
  if (bytes <= 0) throw new Error("A file must have a positive size");
  return Math.ceil(bytes / MULTIPART_PART_SIZE_BYTES);
}

/** Whether a file of `bytes` must be sent in parts (NF-013). */
export function needsMultipart(bytes: number): boolean {
  return bytes > MULTIPART_THRESHOLD_BYTES;
}
