import { describe, expect, it } from "vitest";
import { checkDeclaredFormat, detectFileFormat, isPreviewImage, matchesKind } from "./formats";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => Array.from(value, (c) => c.charCodeAt(0));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70);
const PNG = bytes(0x89, ...text("PNG"), 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = bytes(...text("RIFF"), 1, 2, 3, 4, ...text("WEBP"));
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0);
const ftyp = (brand: string) => bytes(0, 0, 0, 24, ...text("ftyp"), ...text(brand), 0, 0, 0, 0);

describe("S-002: signature binaire des fichiers", () => {
  it.each([
    ["jpeg", JPEG],
    ["png", PNG],
    ["webp", WEBP],
    ["webm", WEBM],
    ["heic", ftyp("heic")],
    ["heic", ftyp("mif1")],
    ["mp4", ftyp("isom")],
    ["mp4", ftyp("mp42")],
    ["mov", ftyp("qt  ")],
  ] as const)("S-002: reconnaît le format %s à ses premiers octets", (format, sample) => {
    expect(detectFileFormat(sample)).toBe(format);
  });

  it("S-002: ne reconnaît ni un exécutable, ni une page web, ni un fichier vide ou tronqué", () => {
    for (const sample of [
      new Uint8Array(),
      bytes(0xff),
      bytes(...text("MZ"), 0x90, 0),
      bytes(...text("<html><script>alert(1)</script>")),
      bytes(...text("%PDF-1.7 ....")),
      bytes(...text("GIF89a......")),
      bytes(...text("RIFF"), 1, 2, 3, 4, ...text("WAVE")),
    ]) {
      expect(detectFileFormat(sample)).toBeNull();
    }
  });

  it("S-002: une photo déclarée doit être une photo, une vidéo déclarée une vidéo", () => {
    expect(matchesKind(JPEG, "photo")).toBe(true);
    expect(matchesKind(ftyp("heic"), "photo")).toBe(true);
    expect(matchesKind(ftyp("mp42"), "video")).toBe(true);
    expect(matchesKind(WEBM, "video")).toBe(true);
    expect(matchesKind(JPEG, "video")).toBe(false);
    expect(matchesKind(ftyp("mp42"), "photo")).toBe(false);
    expect(matchesKind(bytes(...text("<html>")), "photo")).toBe(false);
  });

  it("S-002: les versions préparées sont du WebP ou du JPEG, rien d'autre", () => {
    expect(isPreviewImage(WEBP)).toBe(true);
    expect(isPreviewImage(JPEG)).toBe(true);
    expect(isPreviewImage(PNG)).toBe(false);
    expect(isPreviewImage(ftyp("mp42"))).toBe(false);
  });
});

describe("SPEC 8.1: types déclarés par l'appareil", () => {
  it.each([
    ["image/jpeg", "jpg", "photo"],
    ["image/jpeg", "JPEG", "photo"],
    ["image/heic", "heic", "photo"],
    ["image/heif", "heif", "photo"],
    ["video/quicktime", "mov", "video"],
    ["video/mp4", "mp4", "video"],
    ["video/webm", "webm", "video"],
  ] as const)("accepte %s en .%s comme %s", (mime, extension, kind) => {
    expect(checkDeclaredFormat(mime, extension, kind)).toBe(true);
  });

  it.each([
    ["image/gif", "gif", "photo"],
    ["application/pdf", "pdf", "photo"],
    ["text/html", "html", "photo"],
    ["image/jpeg", "png", "photo"],
    ["image/jpeg", "jpg", "video"],
    ["video/mp4", "mov", "video"],
    ["video/mp4", "mp4", "photo"],
  ] as const)("refuse %s en .%s comme %s", (mime, extension, kind) => {
    expect(checkDeclaredFormat(mime, extension, kind)).toBe(false);
  });
});
