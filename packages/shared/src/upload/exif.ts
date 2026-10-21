import { isExifOrientation, type ExifOrientation } from "./orientation";

/**
 * Reads what the preparation needs from a JPEG without decoding it: orientation, shooting date
 * and the stored size. Reading is defensive: a damaged or truncated file gives fewer fields,
 * never an exception. Nothing is written back: the display version and the thumbnail are
 * re-encoded from pixels, which drops every metadata block, GPS included (S-008).
 */

export interface ImageMetadata {
  /** Pixels as stored in the file (before the orientation is applied). */
  width?: number;
  height?: number;
  orientation?: ExifOrientation;
  /** Shooting date as the camera wrote it, a wall-clock time without a zone: `2026-10-20T14:30:12`. */
  dateTime?: string;
  /** Zone of `dateTime` when the camera recorded one: `+02:00`. */
  offset?: string;
  /** The file carries an EXIF block. */
  hasExif: boolean;
  /** The EXIF block carries a GPS block (a place the guest may not want to share). */
  hasGps: boolean;
}

const TAG = {
  orientation: 0x0112,
  dateTime: 0x0132,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  offsetTime: 0x9010,
  offsetTimeOriginal: 0x9011,
} as const;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;

interface Entry {
  type: number;
  count: number;
  /** Offset of the value, inside the TIFF block. */
  valueAt: number;
}

class TiffReader {
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly littleEndian: boolean,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  inside(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
  }

  u16(offset: number): number | undefined {
    return this.inside(offset, 2) ? this.view.getUint16(offset, this.littleEndian) : undefined;
  }

  u32(offset: number): number | undefined {
    return this.inside(offset, 4) ? this.view.getUint32(offset, this.littleEndian) : undefined;
  }

  /** The entries of one directory, by tag. */
  directory(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const count = this.u16(offset);
    if (count === undefined) return entries;
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      const tag = this.u16(at);
      const type = this.u16(at + 2);
      const valueCount = this.u32(at + 4);
      if (tag === undefined || type === undefined || valueCount === undefined) break;
      entries.set(tag, { type, count: valueCount, valueAt: at + 8 });
    }
    return entries;
  }

  short(entry: Entry | undefined): number | undefined {
    return entry && entry.type === TYPE_SHORT && entry.count >= 1
      ? this.u16(entry.valueAt)
      : undefined;
  }

  long(entry: Entry | undefined): number | undefined {
    if (!entry || entry.count < 1) return undefined;
    if (entry.type === TYPE_LONG) return this.u32(entry.valueAt);
    if (entry.type === TYPE_SHORT) return this.u16(entry.valueAt);
    return undefined;
  }

  ascii(entry: Entry | undefined): string | undefined {
    if (!entry || entry.type !== TYPE_ASCII || entry.count < 1 || entry.count > 64)
      return undefined;
    // Up to four characters live in the entry itself, longer text at the offset it holds.
    const start = entry.count <= 4 ? entry.valueAt : this.u32(entry.valueAt);
    if (start === undefined || !this.inside(start, entry.count)) return undefined;
    let text = "";
    for (let i = 0; i < entry.count; i += 1) {
      const code = this.bytes[start + i] ?? 0;
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }
}

/** `2026:10:20 14:30:12` to `2026-10-20T14:30:12`, or undefined for a blank or impossible date. */
export function parseExifDate(raw: string | undefined): string | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw ?? "");
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  // `Date` rolls 31 February over to March: refuse what does not exist.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(Math.min(second, 59))}`;
}

function parseOffset(raw: string | undefined): string | undefined {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(raw ?? "");
  if (!match) return undefined;
  const [, sign, hours, minutes] = match;
  return Number(hours) <= 14 && Number(minutes) <= 59 ? `${sign}${hours}:${minutes}` : undefined;
}

/**
 * The instant of a shooting date. Most cameras record no zone, so the zone of the guest's device
 * (`deviceOffsetMinutes`, minutes east of UTC) stands in for it: a guest photographs with the
 * phone they upload from, at the event.
 */
export function exifDateToInstant(
  dateTime: string,
  offset: string | undefined,
  deviceOffsetMinutes: number,
): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(dateTime);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  let offsetMinutes = deviceOffsetMinutes;
  const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  if (zone) {
    offsetMinutes = (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]));
  }
  const instant = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000,
  );
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

function readTiff(tiff: Uint8Array, into: ImageMetadata): void {
  if (tiff.length < 8) return;
  const order = String.fromCharCode(tiff[0] ?? 0, tiff[1] ?? 0);
  if (order !== "II" && order !== "MM") return;
  const reader = new TiffReader(tiff, order === "II");
  if (reader.u16(2) !== 42) return;
  const firstIfd = reader.u32(4);
  if (firstIfd === undefined) return;

  into.hasExif = true;
  const ifd0 = reader.directory(firstIfd);
  const orientation = reader.short(ifd0.get(TAG.orientation));
  if (isExifOrientation(orientation)) into.orientation = orientation;
  if (ifd0.has(TAG.gpsIfd)) into.hasGps = true;

  const exifPointer = reader.long(ifd0.get(TAG.exifIfd));
  const exif = exifPointer === undefined ? new Map<number, Entry>() : reader.directory(exifPointer);
  const dateTime =
    parseExifDate(reader.ascii(exif.get(TAG.dateTimeOriginal))) ??
    parseExifDate(reader.ascii(exif.get(TAG.dateTimeDigitized))) ??
    parseExifDate(reader.ascii(ifd0.get(TAG.dateTime)));
  if (dateTime) {
    into.dateTime = dateTime;
    into.offset =
      parseOffset(reader.ascii(exif.get(TAG.offsetTimeOriginal))) ??
      parseOffset(reader.ascii(exif.get(TAG.offsetTime)));
  }
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** True when the bytes start like a JPEG file. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Metadata of a JPEG, read from its first bytes (the EXIF block sits before the image data, in
 * the first tens of kilobytes). Null when the bytes are not a JPEG.
 */
export function readJpegMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (!looksLikeJpeg(bytes)) return null;
  const metadata: ImageMetadata = { hasExif: false, hasGps: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Standalone markers have no length; the scan data starts at SOS and holds no metadata.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(at + 2);
    if (length < 2) break;
    const body = at + 4;
    const end = Math.min(at + 2 + length, bytes.length);

    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && body + 5 <= end) {
      metadata.height = view.getUint16(body + 1);
      metadata.width = view.getUint16(body + 3);
    } else if (
      marker === 0xe1 &&
      !metadata.hasExif &&
      EXIF_HEADER.every((value, index) => bytes[body + index] === value)
    ) {
      readTiff(bytes.subarray(body + 6, end), metadata);
    }
    at += 2 + length;
  }
  return metadata;
}
