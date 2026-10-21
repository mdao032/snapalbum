import { PrepareError } from "@snapalbum/shared/upload";
import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  deviceOffsetAt,
  fingerprint,
  resolveExtension,
  resolveMimeType,
  resolveTakenAt,
  scaledSize,
} from "@/lib/upload/files";

describe("F-031: type et extension d'un fichier choisi sur un téléphone", () => {
  it("F-031: garde le type déclaré et corrige image/jpg", () => {
    expect(resolveMimeType({ name: "a.jpg", type: "image/jpg" })).toBe("image/jpeg");
    expect(resolveMimeType({ name: "a.png", type: "image/png" })).toBe("image/png");
  });

  it("F-031: retrouve le type par l'extension quand il est vide ou générique", () => {
    expect(resolveMimeType({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(resolveMimeType({ name: "clip.MOV", type: "application/octet-stream" })).toBe(
      "video/quicktime",
    );
  });

  it("F-031: l'extension vient du nom, sinon du type", () => {
    expect(resolveExtension({ name: "photo.JPEG", type: "image/jpeg" })).toBe("jpeg");
    expect(resolveExtension({ name: "image", type: "image/webp" })).toBe("webp");
    expect(resolveExtension({ name: "video.bin", type: "video/mp4" })).toBe("mp4");
  });

  it("F-031: un type inconnu est refusé comme format non pris en charge", () => {
    expect(() => resolveExtension({ name: "doc.pdf", type: "application/pdf" })).toThrow(
      PrepareError,
    );
  });
});

describe("NF-012: empreinte d'un fichier", () => {
  it("NF-012: empreinte SHA-256 complète pour un fichier courant", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await fingerprint(new NodeBlob([bytes]) as unknown as Blob)).toBe(expected);
  });

  it("NF-012: deux contenus différents donnent deux empreintes", async () => {
    const a = await fingerprint(new NodeBlob([new Uint8Array([1])]) as unknown as Blob);
    const b = await fingerprint(new NodeBlob([new Uint8Array([2])]) as unknown as Blob);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SPEC 8.1: taille des versions d'affichage", () => {
  it("réduit sans déformer, jamais en dessous de 1 px, jamais agrandi", () => {
    expect(scaledSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(3000, 4000, 400)).toEqual({ width: 300, height: 400 });
    expect(scaledSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(10000, 1, 400)).toEqual({ width: 400, height: 1 });
  });
});

describe("SPEC 8.1: date de prise de vue d'un fichier", () => {
  const modified = Date.UTC(2026, 9, 21, 8, 0, 0);

  it("SPEC 8.1: la date EXIF prime sur la date du fichier", () => {
    expect(
      resolveTakenAt(
        { lastModified: modified },
        { dateTime: "2026-06-14T16:45:10", offset: "+02:00" },
        () => 0,
      ),
    ).toBe("2026-06-14T14:45:10.000Z");
  });

  it("SPEC 8.1: sans fuseau noté, celui de l'appareil à cette date est utilisé", () => {
    expect(
      resolveTakenAt({ lastModified: modified }, { dateTime: "2026-06-14T16:45:10" }, () => 120),
    ).toBe("2026-06-14T14:45:10.000Z");
  });

  it("SPEC 8.1: sans EXIF, la date de modification du fichier sert", () => {
    expect(resolveTakenAt({ lastModified: modified }, null, () => 0)).toBe(
      "2026-10-21T08:00:00.000Z",
    );
    expect(resolveTakenAt({ lastModified: modified }, { dateTime: undefined }, () => 0)).toBe(
      "2026-10-21T08:00:00.000Z",
    );
  });

  it("SPEC 8.1: sans aucune date, la photo n'en déclare pas", () => {
    expect(resolveTakenAt({ lastModified: 0 }, null, () => 0)).toBeUndefined();
  });

  it("SPEC 8.1: le fuseau de l'appareil est celui de la date demandée (heure d'été comprise)", () => {
    const summer = deviceOffsetAt("2026-07-01T12:00:00");
    const winter = deviceOffsetAt("2026-01-01T12:00:00");
    // Quelle que soit la zone de la machine de test : l'écart avec UTC est celui de l'instant.
    expect(summer).toBe(-new Date("2026-07-01T12:00:00").getTimezoneOffset());
    expect(winter).toBe(-new Date("2026-01-01T12:00:00").getTimezoneOffset());
    expect(deviceOffsetAt("pas une date")).toBe(0);
  });
});
