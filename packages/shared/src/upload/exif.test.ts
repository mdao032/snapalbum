import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exifDateToInstant, looksLikeJpeg, parseExifDate, readJpegMetadata } from "./exif";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url)));

describe("SPEC 8.1: lecture de l'EXIF d'un JPEG", () => {
  it("SPEC 8.1: lit l'orientation, la date, le fuseau et la taille stockée d'une photo prise en travers", () => {
    const metadata = readJpegMetadata(fixture("jpeg-orientation-6.jpg"));
    expect(metadata).toMatchObject({
      orientation: 6,
      dateTime: "2026-06-14T16:45:10",
      offset: "+02:00",
      // Stockée couchée (96 x 64) : c'est l'orientation 6 qui la redresse en 64 x 96.
      width: 96,
      height: 64,
      hasExif: true,
      hasGps: false,
    });
  });

  it("S-008: repère la position GPS d'une photo, sans la lire", () => {
    const metadata = readJpegMetadata(fixture("jpeg-gps.jpg"));
    expect(metadata).toMatchObject({
      hasExif: true,
      hasGps: true,
      dateTime: "2025-08-02T09:15:30",
      width: 128,
      height: 96,
    });
    // Aucune coordonnée n'est exposée : l'objet n'a pas de champ pour elle.
    expect(Object.keys(metadata ?? {})).not.toContain("gps");
    expect(JSON.stringify(metadata)).not.toMatch(/48\.|2\.3/);
  });

  it("SPEC 8.1: un JPEG sans EXIF donne ses dimensions et rien d'autre", () => {
    expect(readJpegMetadata(fixture("jpeg-plain.jpg"))).toEqual({
      width: 96,
      height: 64,
      hasExif: false,
      hasGps: false,
    });
  });

  it("SPEC 8.1: une date vide (horloge non réglée) est ignorée", () => {
    const metadata = readJpegMetadata(fixture("jpeg-bad-exif.jpg"));
    expect(metadata?.dateTime).toBeUndefined();
    expect(metadata?.hasExif).toBe(true);
  });

  it("SPEC 8.1: ce qui n'est pas un JPEG n'est pas lu", () => {
    expect(readJpegMetadata(fixture("png-photo.png"))).toBeNull();
    expect(readJpegMetadata(fixture("not-an-image.jpg"))).toBeNull();
    expect(readJpegMetadata(new Uint8Array(0))).toBeNull();
    expect(looksLikeJpeg(fixture("jpeg-plain.jpg"))).toBe(true);
    expect(looksLikeJpeg(fixture("photo.heic"))).toBe(false);
  });

  it("SPEC 8.1: un fichier tronqué ou abîmé ne fait jamais échouer la lecture", () => {
    const whole = fixture("jpeg-orientation-6.jpg");
    for (let length = 0; length <= whole.length; length += 7) {
      expect(() => readJpegMetadata(whole.subarray(0, length))).not.toThrow();
    }
    // Les mêmes octets, un à un mis à mal : jamais d'exception non plus.
    for (let at = 0; at < Math.min(whole.length, 300); at += 1) {
      const damaged = new Uint8Array(whole);
      damaged[at] = (damaged[at] ?? 0) ^ 0xff;
      expect(() => readJpegMetadata(damaged)).not.toThrow();
    }
    expect(readJpegMetadata(fixture("corrupted.jpg"))?.orientation).toBeUndefined();
  });

  it("SPEC 8.1: l'orientation d'un fichier abîmé reste dans 1 à 8", () => {
    const whole = fixture("jpeg-orientation-6.jpg");
    for (let at = 0; at < 200; at += 1) {
      const damaged = new Uint8Array(whole);
      damaged[at] = 0x09;
      const orientation = readJpegMetadata(damaged)?.orientation;
      if (orientation !== undefined) {
        expect(orientation).toBeGreaterThanOrEqual(1);
        expect(orientation).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe("SPEC 8.1: date de prise de vue", () => {
  it("SPEC 8.1: convertit la date EXIF et refuse ce qui n'existe pas", () => {
    expect(parseExifDate("2026:10:20 14:30:12")).toBe("2026-10-20T14:30:12");
    expect(parseExifDate("2026:10:20 14:30:12\0")).toBe("2026-10-20T14:30:12");
    expect(parseExifDate("0000:00:00 00:00:00")).toBeUndefined();
    expect(parseExifDate("2026:02:31 10:00:00")).toBeUndefined();
    expect(parseExifDate("2026:13:01 10:00:00")).toBeUndefined();
    expect(parseExifDate("2026:10:20 25:00:00")).toBeUndefined();
    expect(parseExifDate("  :  :     :  :  ")).toBeUndefined();
    expect(parseExifDate(undefined)).toBeUndefined();
  });

  it("SPEC 8.1: le fuseau de l'appareil sert quand l'appareil photo n'en a pas noté", () => {
    // Paris en été (UTC+2) : 14 h 30 locale = 12 h 30 UTC.
    expect(exifDateToInstant("2026-06-14T14:30:12", undefined, 120)).toBe(
      "2026-06-14T12:30:12.000Z",
    );
    expect(exifDateToInstant("2026-01-14T14:30:12", undefined, 60)).toBe(
      "2026-01-14T13:30:12.000Z",
    );
  });

  it("SPEC 8.1: le fuseau noté par l'appareil photo prime sur celui de l'appareil", () => {
    expect(exifDateToInstant("2026-06-14T16:45:10", "+02:00", 0)).toBe("2026-06-14T14:45:10.000Z");
    expect(exifDateToInstant("2026-06-14T16:45:10", "-05:30", 120)).toBe(
      "2026-06-14T22:15:10.000Z",
    );
  });

  it("SPEC 8.1: le format rendu est celui que le serveur accepte, avec un Z final", () => {
    expect(exifDateToInstant("2026-06-14T14:30:12", undefined, 0)).toMatch(/Z$/);
    expect(exifDateToInstant("pas une date", undefined, 0)).toBeUndefined();
  });
});
