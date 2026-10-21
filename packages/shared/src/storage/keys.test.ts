import { describe, expect, it } from "vitest";
import {
  coverKey,
  eventIdOfKey,
  eventPrefix,
  mediaKey,
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_SIZE_BYTES,
  multipartPartCount,
  needsMultipart,
  READ_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./keys";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const MEDIA = "a1b2c3d4-0000-4000-8000-123456789abc";

describe("SPEC 9.1: clés des fichiers dans R2", () => {
  it("SPEC 9.1: organise les trois variantes comme la spécification", () => {
    expect(mediaKey(EVENT, MEDIA, "original", "HEIC")).toBe(
      `events/${EVENT}/original/${MEDIA}.heic`,
    );
    expect(mediaKey(EVENT, MEDIA, "display")).toBe(`events/${EVENT}/display/${MEDIA}.webp`);
    expect(mediaKey(EVENT, MEDIA, "thumb")).toBe(`events/${EVENT}/thumb/${MEDIA}.webp`);
    expect(coverKey(EVENT, "Couverture.JPG")).toBe(`events/${EVENT}/cover/couverture.jpg`);
  });

  it("SPEC 9.1: l'extension d'un original est limitée aux formats connus, avec ou sans point", () => {
    expect(mediaKey(EVENT, MEDIA, "original", ".mov")).toMatch(/\.mov$/);
    expect(() => mediaKey(EVENT, MEDIA, "original", "exe")).toThrow();
    expect(() => mediaKey(EVENT, MEDIA, "original", "jpg/../../x")).toThrow();
  });

  it("S-002: refuse tout identifiant qui n'est pas un UUID (pas de chemin glissé dans la clé)", () => {
    expect(() => mediaKey("../other", MEDIA, "display")).toThrow();
    expect(() => mediaKey(EVENT, "x/../y", "display")).toThrow();
    expect(() => eventPrefix("*")).toThrow();
  });

  it("S-002: refuse un nom de couverture qui sort du dossier ou cache un fichier", () => {
    for (const name of ["../x.jpg", "a/b.jpg", ".htaccess", "a..b/../c", "", "x".repeat(101)]) {
      expect(() => coverKey(EVENT, name)).toThrow();
    }
  });

  it("R5: le préfixe d'un événement permet de tout purger, et lui seul", () => {
    expect(eventPrefix(EVENT)).toBe(`events/${EVENT}/`);
    expect(mediaKey(EVENT, MEDIA, "display").startsWith(eventPrefix(EVENT))).toBe(true);
  });

  it("SPEC 9.1: retrouve l'événement d'une clé, ou rien pour une clé étrangère", () => {
    expect(eventIdOfKey(mediaKey(EVENT, MEDIA, "thumb"))).toBe(EVENT);
    expect(eventIdOfKey("other/file.jpg")).toBeNull();
    expect(eventIdOfKey("events/not-a-uuid/thumb/x.webp")).toBeNull();
  });
});

describe("NF-013: envoi en morceaux", () => {
  it("NF-013: les vidéos de plus de 50 Mo passent en morceaux de 10 Mo", () => {
    expect(needsMultipart(50 * 1024 * 1024)).toBe(false);
    expect(needsMultipart(50 * 1024 * 1024 + 1)).toBe(true);
    expect(MULTIPART_PART_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("NF-013: compte les morceaux, le dernier pouvant être plus petit", () => {
    expect(multipartPartCount(1)).toBe(1);
    expect(multipartPartCount(MULTIPART_PART_SIZE_BYTES)).toBe(1);
    expect(multipartPartCount(MULTIPART_PART_SIZE_BYTES + 1)).toBe(2);
    expect(multipartPartCount(500 * 1024 * 1024)).toBe(50);
    expect(() => multipartPartCount(0)).toThrow();
  });

  it("NF-013: la plus grande vidéo autorisée (500 Mo) reste très en dessous de la limite de S3", () => {
    expect(multipartPartCount(500 * 1024 * 1024)).toBeLessThan(MULTIPART_MAX_PARTS);
  });
});

describe("SPEC 8.1 et 9.1: durée des adresses signées", () => {
  it("SPEC 8.1: envoi 15 minutes, lecture 1 heure", () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(READ_URL_TTL_SECONDS).toBe(3600);
  });
});
