import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  clampView,
  distanceBetween,
  fitSize,
  midpointOf,
  swipeDirection,
  zoomAt,
} from "./gestures";

const stage = { width: 400, height: 800 };

describe("F-051: gestes de la visionneuse", () => {
  it("F-051: la photo tient entière dans l'écran sans être agrandie", () => {
    expect(fitSize({ width: 4000, height: 3000 }, stage)).toEqual({ width: 400, height: 300 });
    expect(fitSize({ width: 100, height: 50 }, stage)).toEqual({ width: 100, height: 50 });
    expect(fitSize({ width: 0, height: 50 }, stage)).toEqual({ width: 0, height: 0 });
  });

  it("F-051: le zoom pincé reste entre 1 et le maximum", () => {
    const view = { scale: 1, x: 0, y: 0 };
    expect(zoomAt(view, 0.2, { x: 0, y: 0 }).scale).toBe(1);
    expect(zoomAt(view, 100, { x: 0, y: 0 }).scale).toBe(MAX_ZOOM);
  });

  it("F-051: le point sous les doigts reste sous les doigts quand on zoome", () => {
    const point = { x: 100, y: -50 };
    const before = { scale: 1.5, x: 20, y: 10 };
    const after = zoomAt(before, 2, point);
    // Position of the photo's spot under `point`, in photo coordinates, before and after.
    const spot = (view: typeof before) => ({
      x: (point.x - view.x) / view.scale,
      y: (point.y - view.y) / view.scale,
    });
    expect(spot(after).x).toBeCloseTo(spot(before).x);
    expect(spot(after).y).toBeCloseTo(spot(before).y);
  });

  it("F-051: une photo non zoomée ne peut pas être déplacée, une photo zoomée oui jusqu'au bord", () => {
    const fitted = { width: 400, height: 300 };
    expect(clampView({ scale: 1, x: 80, y: 40 }, fitted, stage)).toEqual({ scale: 1, x: 0, y: 0 });
    // Zoom 3: the photo is 1200 wide in a 400 wide area, so it can move 400 px either way.
    expect(clampView({ scale: 3, x: 999, y: 0 }, fitted, stage).x).toBe(400);
    expect(clampView({ scale: 3, x: -999, y: 0 }, fitted, stage).x).toBe(-400);
    // Vertically 900 px of photo in an 800 px area: 50 px of play.
    expect(clampView({ scale: 3, x: 0, y: 999 }, fitted, stage).y).toBe(50);
  });

  it("F-051: distance et milieu de deux doigts", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpointOf({ x: 0, y: 10 }, { x: 10, y: 30 })).toEqual({ x: 5, y: 20 });
  });

  it.each([
    ["un long balayage vers la gauche passe à la suivante", -120, 5, 400, "next"],
    ["un long balayage vers la droite revient à la précédente", 120, -5, 400, "previous"],
    ["un balayage court mais vif compte", -40, 0, 50, "next"],
    ["un glissement court et lent ne compte pas", -40, 0, 600, null],
    ["un geste surtout vertical ne compte pas", -80, 200, 200, null],
    ["un simple appui ne compte pas", 2, 1, 80, null],
  ] as const)("F-051: %s", (_name, dx, dy, ms, expected) => {
    expect(swipeDirection(dx, dy, ms)).toBe(expected);
  });
});
