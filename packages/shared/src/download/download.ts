/**
 * Downloading the album (F-080, F-081, F-083): readable file names and the cut into parts of at
 * most 2 GB. Pure, so the web and the apps share the rules and they are tested without a browser.
 */

/** A part of the album is a ZIP of at most this many bytes (F-081): what every system opens. */
export const ZIP_PART_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Lower case, no accents, letters and digits joined by hyphens, cut at `max` characters. */
export function slugify(text: string, max = 40): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export interface DownloadNameInput {
  /** When the photo was taken, or sent when the device did not say (ISO). */
  at: string;
  /** The guest's first name, or null for a guest without one. */
  guestName: string | null;
  /** Position among that guest's photos, from 1: keeps two shots of the same second apart. */
  index: number;
  /** File extension without the dot. */
  extension: string;
}

/**
 * `2026-09-12_153045_anna_3.jpg` (F-083): date and time (UTC) first so the files sort in the order
 * they were taken, then the guest, then a number. A guest without a name is `invite`.
 */
export function downloadFileName({ at, guestName, index, extension }: DownloadNameInput): string {
  const date = new Date(at);
  const iso = Number.isNaN(date.getTime()) ? "0000-00-00T000000" : date.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replaceAll(":", "");
  const who = slugify(guestName ?? "", 30) || "invite";
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${day}_${time}_${who}_${index}.${ext}`;
}

/** The number of each file among its guest's, counted in the order the files come. */
export function numberByGuest(guestKeys: readonly string[]): number[] {
  const seen = new Map<string, number>();
  return guestKeys.map((key) => {
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    return next;
  });
}

export interface Part {
  /** Position of the first file of the part in the list, and one past its last. */
  start: number;
  end: number;
  bytes: number;
}

/**
 * Cuts the files, in order, into parts of at most `max` bytes (F-081). A file bigger than the
 * limit gets a part of its own rather than being refused. Sizes are those the server declares.
 */
export function planParts(sizes: readonly number[], max: number = ZIP_PART_MAX_BYTES): Part[] {
  const parts: Part[] = [];
  let current: Part | null = null;
  sizes.forEach((size, index) => {
    const bytes = Math.max(0, size);
    if (current && current.bytes + bytes > max && current.end > current.start) {
      parts.push(current);
      current = null;
    }
    if (!current) current = { start: index, end: index, bytes: 0 };
    current.end = index + 1;
    current.bytes += bytes;
  });
  if (current) parts.push(current);
  return parts;
}

/** `mariage-de-lea-et-tom_partie-2-sur-3.zip`, or no suffix when everything fits in one. */
export function partFileName(title: string, part: number, total: number): string {
  const base = slugify(title, 40) || "album";
  return total <= 1 ? `${base}.zip` : `${base}_partie-${part}-sur-${total}.zip`;
}
