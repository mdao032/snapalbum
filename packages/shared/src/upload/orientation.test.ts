import { describe, expect, it } from "vitest";
import {
  isExifOrientation,
  orientationTransform,
  swapsAxes,
  type ExifOrientation,
  type TransformMatrix,
} from "./orientation";

/** Where a point of the stored picture lands once the transform is applied. */
function apply(matrix: TransformMatrix, x: number, y: number) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

// A stored picture of 6 x 4 whose top-left corner is the point to follow.
const W = 6;
const H = 4;

describe("SPEC 8.1: redressement d'une photo selon son orientation EXIF", () => {
  const cases: [ExifOrientation, string, { x: number; y: number }, boolean][] = [
    [1, "telle quelle", { x: 0, y: 0 }, false],
    [2, "miroir horizontal", { x: W, y: 0 }, false],
    [3, "retournée à 180°", { x: W, y: H }, false],
    [4, "miroir vertical", { x: 0, y: H }, false],
    [5, "transposée", { x: 0, y: 0 }, true],
    [6, "tournée de 90° dans le sens horaire", { x: H, y: 0 }, true],
    [7, "transposée à l'envers", { x: H, y: W }, true],
    [8, "tournée de 90° dans le sens antihoraire", { x: 0, y: W }, true],
  ];

  it.each(cases)(
    "SPEC 8.1: orientation %i (%s) : le coin haut gauche arrive au bon endroit",
    (orientation, _label, corner, swapped) => {
      const transform = orientationTransform(orientation, W, H);
      expect(apply(transform.matrix, 0, 0)).toEqual(corner);
      expect(swapsAxes(orientation)).toBe(swapped);
      expect(transform.width).toBe(swapped ? H : W);
      expect(transform.height).toBe(swapped ? W : H);
    },
  );

  it.each(cases)(
    "SPEC 8.1: orientation %i : les quatre coins restent dans l'image redressée",
    (orientation) => {
      const { matrix, width, height } = orientationTransform(orientation, W, H);
      for (const [x, y] of [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ] as const) {
        const point = apply(matrix, x, y);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(height);
      }
    },
  );

  it("SPEC 8.1: seules les valeurs 1 à 8 sont des orientations", () => {
    expect([0, 1, 8, 9, 6.5, "6", undefined, null].map(isExifOrientation)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
