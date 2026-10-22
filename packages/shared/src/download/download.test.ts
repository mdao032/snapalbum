import { describe, expect, it } from "vitest";
import {
  ZIP_PART_MAX_BYTES,
  downloadFileName,
  numberByGuest,
  partFileName,
  planParts,
  slugify,
} from "./download";

const GB = 1024 * 1024 * 1024;

describe("F-083: noms de fichiers lisibles", () => {
  it("F-083: date, heure, prénom et numéro, dans l'ordre où les photos ont été prises", () => {
    expect(
      downloadFileName({
        at: "2026-09-12T15:30:45.000Z",
        guestName: "Anna",
        index: 3,
        extension: "jpg",
      }),
    ).toBe("2026-09-12_153045_anna_3.jpg");
  });

  it("F-083: pas d'accent ni de caractère étrange, « invite » sans prénom, extension nettoyée", () => {
    expect(
      downloadFileName({
        at: "2026-01-02T03:04:05Z",
        guestName: "Élodie-Marie O'Neil !",
        index: 1,
        extension: ".JPG",
      }),
    ).toBe("2026-01-02_030405_elodie-marie-o-neil_1.jpg");
    expect(
      downloadFileName({ at: "2026-01-02T03:04:05Z", guestName: null, index: 2, extension: "mp4" }),
    ).toBe("2026-01-02_030405_invite_2.mp4");
    expect(
      downloadFileName({ at: "2026-01-02T03:04:05Z", guestName: "???", index: 1, extension: "" }),
    ).toBe("2026-01-02_030405_invite_1.bin");
  });

  it("F-083: une date illisible ne casse pas le nom", () => {
    expect(
      downloadFileName({ at: "pas une date", guestName: "Anna", index: 1, extension: "jpg" }),
    ).toBe("0000-00-00_000000_anna_1.jpg");
  });

  it("F-083: les numéros se comptent par invité, dans l'ordre", () => {
    expect(numberByGuest(["a", "b", "a", "a", "b"])).toEqual([1, 1, 2, 3, 2]);
    expect(numberByGuest([])).toEqual([]);
  });

  it("F-083: deux photos du même invité à la même seconde ont des noms différents", () => {
    const keys = ["anna", "anna"];
    const names = numberByGuest(keys).map((index) =>
      downloadFileName({ at: "2026-09-12T15:30:45Z", guestName: "Anna", index, extension: "jpg" }),
    );
    expect(new Set(names).size).toBe(2);
  });

  it("F-083: slugify garde le nom court et propre", () => {
    expect(slugify("Mariage de Léa & Tom !")).toBe("mariage-de-lea-tom");
    expect(slugify("x".repeat(100), 10)).toBe("x".repeat(10));
    expect(slugify("a-".repeat(30), 5)).toBe("a-a-a");
  });
});

describe("F-081: découpage en parties de 2 Go au plus", () => {
  it("F-081: la limite est de 2 Go", () => {
    expect(ZIP_PART_MAX_BYTES).toBe(2 * GB);
  });

  it("F-081: tout tient dans une partie quand c'est assez petit", () => {
    expect(planParts([1, 2, 3], 100)).toEqual([{ start: 0, end: 3, bytes: 6 }]);
    expect(planParts([])).toEqual([]);
  });

  it("F-081: une partie est fermée avant de dépasser la limite, dans l'ordre, sans oubli", () => {
    const parts = planParts([60, 30, 50, 50, 10], 100);
    expect(parts).toEqual([
      { start: 0, end: 2, bytes: 90 },
      { start: 2, end: 4, bytes: 100 },
      { start: 4, end: 5, bytes: 10 },
    ]);
    // Contiguous, covering every file once.
    expect(parts.map((part) => part.end - part.start).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("F-081: un fichier plus gros que la limite a sa propre partie au lieu d'être refusé", () => {
    expect(planParts([10, 500, 10], 100)).toEqual([
      { start: 0, end: 1, bytes: 10 },
      { start: 1, end: 2, bytes: 500 },
      { start: 2, end: 3, bytes: 10 },
    ]);
  });

  it("F-081: 5 Go de photos de 400 Mo font trois parties, jamais plus de 2 Go chacune", () => {
    const sizes = Array.from({ length: 13 }, () => 400 * 1024 * 1024);
    const parts = planParts(sizes);
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part.bytes).toBeLessThanOrEqual(ZIP_PART_MAX_BYTES);
  });

  it("F-081: une taille négative ou nulle compte pour rien et ne casse rien", () => {
    expect(planParts([-5, 0, 10], 100)).toEqual([{ start: 0, end: 3, bytes: 10 }]);
  });

  it("F-081: les parties se nomment d'après l'événement, sans numéro quand il n'y en a qu'une", () => {
    expect(partFileName("Mariage de Léa et Tom", 1, 1)).toBe("mariage-de-lea-et-tom.zip");
    expect(partFileName("Mariage de Léa et Tom", 2, 3)).toBe(
      "mariage-de-lea-et-tom_partie-2-sur-3.zip",
    );
    expect(partFileName("???", 1, 1)).toBe("album.zip");
  });
});
