import { describe, expect, it } from "vitest";
import { reserveUploadRequestSchema } from "../schemas/upload";
import { BLURHASH_PATTERN, blurhashSampleSize, encodeBlurhash } from "./blurhash";

/**
 * The picture the reference encoder was run on. The expected codes come from the npm `blurhash`
 * 2.0.5 encoder with one change: it finds the largest AC value without taking the sign, unlike
 * the C and Swift reference encoders, which use the absolute value (as this code does).
 */
function picture(width: number, height: number, seed: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = 4 * (x + y * width);
      pixels[at] = (x * 7 + seed * 37) & 255;
      pixels[at + 1] = (y * 11 + seed * 91) & 255;
      pixels[at + 2] = (x + y + seed * 13) & 255;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

describe("SPEC 8.1: blurhash de la miniature", () => {
  it("SPEC 8.1: donne exactement le résultat de l'implémentation de référence", () => {
    expect(encodeBlurhash(picture(32, 24, 1), 32, 24)).toBe("L#Iqkc2owxX6tfW:jtfjdef7fQf7");
    expect(encodeBlurhash(picture(9, 32, 2), 9, 32)).toBe("LfB~WqP6WothoIa{fQjshVg0fQg0");
    expect(encodeBlurhash(new Uint8ClampedArray(16 * 16 * 4).fill(255), 16, 16)).toBe(
      "LKTSUA~qfQ~q~qoffQoffQfQfQfQ",
    );
  });

  it("SPEC 8.1: une seule composante ne garde que la couleur moyenne", () => {
    expect(encodeBlurhash(picture(20, 20, 3), 20, 20, 1, 1)).toBe("00L39k");
  });

  it("SPEC 8.1: plus de composantes donnent un code plus long, de taille prévisible", () => {
    const hash = encodeBlurhash(picture(20, 20, 4), 20, 20, 6, 5);
    expect(hash).toBe("fsLM?m$z2D=cN[S|tfj@WpoKa|bGdKe;fQe;fQe;t5j@WpoKa|bGgbfjfQfjfQfj");
    // 1 (composantes) + 1 (maximum) + 4 (couleur moyenne) + 2 par composante restante.
    expect(hash).toHaveLength(6 + 2 * (6 * 5 - 1));
  });

  it("SPEC 8.1: le résultat tient dans la colonne de la base (100 caractères) et dans le format accepté", () => {
    const hash = encodeBlurhash(picture(32, 24, 1), 32, 24);
    expect(hash.length).toBeLessThanOrEqual(100);
    expect(hash).toMatch(BLURHASH_PATTERN);
  });

  it("SPEC 8.1: refuse une image vide, des pixels qui ne correspondent pas ou des composantes absurdes", () => {
    expect(() => encodeBlurhash(new Uint8ClampedArray(0), 0, 0)).toThrow(RangeError);
    expect(() => encodeBlurhash(new Uint8ClampedArray(12), 2, 2)).toThrow(RangeError);
    expect(() => encodeBlurhash(picture(4, 4, 1), 4, 4, 0, 3)).toThrow(RangeError);
    expect(() => encodeBlurhash(picture(4, 4, 1), 4, 4, 4, 10)).toThrow(RangeError);
  });

  it("SPEC 8.1: une couleur unie se retrouve dans la couleur moyenne du code", () => {
    // Orange (255, 128, 0): la couleur moyenne occupe les caractères 2 à 5 en base 83.
    const orange = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < orange.length; i += 4) orange.set([255, 128, 0, 255], i);
    const hash = encodeBlurhash(orange, 8, 8);
    const alphabet =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
    const average = [...hash.slice(2, 6)].reduce(
      (sum, char) => sum * 83 + alphabet.indexOf(char),
      0,
    );
    expect([average >> 16, (average >> 8) & 255, average & 255]).toEqual([255, 128, 0]);
  });

  it("SPEC 8.1: l'échantillon d'une grande photo tient en 32 px sur le grand côté", () => {
    expect(blurhashSampleSize(4000, 3000)).toEqual({ width: 32, height: 24 });
    expect(blurhashSampleSize(3000, 4000)).toEqual({ width: 24, height: 32 });
    expect(blurhashSampleSize(10, 8)).toEqual({ width: 10, height: 8 });
    expect(blurhashSampleSize(1000, 1)).toEqual({ width: 32, height: 1 });
  });
});

describe("S-002: le blurhash reçu d'un client est validé", () => {
  const request = {
    eventCode: "k7m2x9qvbr",
    kind: "photo",
    sha256: "a".repeat(64),
    mimeType: "image/jpeg",
    extension: "jpg",
    bytes: 1000,
    displayBytes: 500,
    thumbBytes: 100,
  };

  it("S-002: un blurhash valide est accepté, son absence aussi (clients déjà publiés)", () => {
    expect(
      reserveUploadRequestSchema.safeParse({ ...request, blurhash: "L#Iqkc2owxX6tfW:jtfjdef7fQf7" })
        .success,
    ).toBe(true);
    expect(reserveUploadRequestSchema.safeParse(request).success).toBe(true);
  });

  it("S-002: un blurhash trop long, vide ou avec des caractères étrangers est refusé", () => {
    for (const blurhash of [
      "",
      "x".repeat(101),
      "<script>alert(1)</script>",
      "L#Iqkc 2owx",
      "L#Iq\nkc2owx",
    ]) {
      expect(reserveUploadRequestSchema.safeParse({ ...request, blurhash }).success).toBe(false);
    }
  });
});
