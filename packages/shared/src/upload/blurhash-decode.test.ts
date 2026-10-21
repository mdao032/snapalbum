import { describe, expect, it } from "vitest";
import { blurhashComponents, decodeBlurhash, encodeBlurhash } from "./blurhash";

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

const near = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe("F-053: décodage du blurhash", () => {
  it("F-053: la couleur moyenne d'une couleur unie se retrouve sur toute l'image décodée", () => {
    const orange = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < orange.length; i += 4) orange.set([255, 128, 0, 255], i);
    const pixels = decodeBlurhash(encodeBlurhash(orange, 8, 8, 1, 1), 6, 4);
    expect(pixels).toHaveLength(6 * 4 * 4);
    for (let at = 0; at < pixels.length; at += 4) {
      near(pixels[at]!, 255, 2);
      near(pixels[at + 1]!, 128, 2);
      near(pixels[at + 2]!, 0, 2);
      expect(pixels[at + 3]).toBe(255);
    }
  });

  it("F-053: décoder le code d'une photo garde la couleur d'ensemble de la photo", () => {
    const source = picture(32, 24, 1);
    const decoded = decodeBlurhash(encodeBlurhash(source, 32, 24), 32, 24);
    const mean = (pixels: Uint8ClampedArray, channel: number) => {
      let sum = 0;
      for (let at = channel; at < pixels.length; at += 4) sum += pixels[at]!;
      return sum / (pixels.length / 4);
    };
    for (const channel of [0, 1, 2]) near(mean(decoded, channel), mean(source, channel), 12);
  });

  it("F-053: un code à une seule composante donne une image unie", () => {
    const pixels = decodeBlurhash("00L39k", 4, 4);
    for (let at = 4; at < pixels.length; at += 4) {
      expect([pixels[at], pixels[at + 1], pixels[at + 2]]).toEqual([
        pixels[0],
        pixels[1],
        pixels[2],
      ]);
    }
  });

  it("F-053: refuse un code mal formé ou de mauvaise longueur, sans planter", () => {
    expect(() => decodeBlurhash("trop-court", 4, 4)).toThrow(RangeError);
    expect(() => decodeBlurhash("L#Iqkc2owxX6tfW:jtfjdef7fQf", 4, 4)).toThrow(RangeError);
    expect(() => decodeBlurhash("é".repeat(28), 4, 4)).toThrow(RangeError);
    expect(() => decodeBlurhash("L#Iqkc2owxX6tfW:jtfjdef7fQf7", 0, 4)).toThrow(RangeError);
    expect(blurhashComponents("L#Iqkc2owxX6tfW:jtfjdef7fQf7")).toEqual({ x: 4, y: 3 });
    expect(blurhashComponents("nope")).toBeNull();
  });
});
