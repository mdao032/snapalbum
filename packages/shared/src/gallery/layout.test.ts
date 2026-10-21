import { describe, expect, it } from "vitest";
import { aspectOf, buildRows, targetHeightFor, totalHeight } from "./layout";

const options = { width: 360, targetHeight: 120, gap: 4 };

describe("F-050: mise en page de la grille", () => {
  it("F-050: une ligne pleine remplit exactement la largeur", () => {
    const rows = buildRows(Array(30).fill(1.5), options);
    for (const row of rows.slice(0, -1)) {
      const used = row.cells.reduce((sum, cell) => sum + cell.width, 0);
      expect(used + 4 * (row.cells.length - 1)).toBe(360);
    }
  });

  it("F-050: la dernière ligne n'est pas étirée, elle garde la hauteur visée", () => {
    const rows = buildRows([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], options);
    expect(rows.at(-1)!.height).toBe(120);
    expect(rows.at(-1)!.cells.length).toBeLessThan(3);
  });

  it("F-050: chaque média est dans exactement une ligne, dans l'ordre", () => {
    const aspects = Array.from({ length: 57 }, (_, i) => 0.7 + (i % 5) * 0.4);
    const indexes = buildRows(aspects, options).flatMap((row) => row.cells.map((c) => c.index));
    expect(indexes).toEqual(aspects.map((_, i) => i));
  });

  it("F-050: les largeurs sont des pixels entiers et jamais nulles", () => {
    const aspects = Array.from({ length: 200 }, (_, i) =>
      aspectOf(1000 + i * 13, 700 + (i % 9) * 40),
    );
    for (const row of buildRows(aspects, options)) {
      for (const cell of row.cells) {
        expect(Number.isInteger(cell.width)).toBe(true);
        expect(cell.width).toBeGreaterThan(0);
      }
      expect(Number.isInteger(row.height)).toBe(true);
    }
  });

  it("F-050: une grille plus large met plus de photos par ligne", () => {
    const aspects = Array(60).fill(1.5);
    const narrow = buildRows(aspects, { ...options, width: 360 })[0]!.cells.length;
    const wide = buildRows(aspects, { ...options, width: 1200, targetHeight: 200 })[0]!.cells
      .length;
    expect(wide).toBeGreaterThan(narrow);
  });

  it("F-050: un panorama ne dépasse pas le rapport maximal, une photo inconnue vaut 4:3", () => {
    expect(aspectOf(10_000, 1000)).toBe(2.5);
    expect(aspectOf(1000, 10_000)).toBe(0.5);
    expect(aspectOf(null, 800)).toBeCloseTo(4 / 3);
    expect(aspectOf(0, 0)).toBeCloseTo(4 / 3);
  });

  it("F-050: sans largeur ou sans média il n'y a aucune ligne", () => {
    expect(buildRows([], options)).toEqual([]);
    expect(buildRows([1, 1], { ...options, width: 0 })).toEqual([]);
  });

  it("F-050: la hauteur totale compte les espaces entre les lignes, pas autour", () => {
    const rows = buildRows(Array(30).fill(1.5), options);
    const heights = rows.reduce((sum, row) => sum + row.height, 0);
    expect(totalHeight(rows, 4)).toBe(heights + 4 * (rows.length - 1));
    expect(totalHeight([], 4)).toBe(0);
  });

  it("F-050: la hauteur visée grandit avec l'écran", () => {
    expect(targetHeightFor(375)).toBeLessThan(targetHeightFor(700));
    expect(targetHeightFor(700)).toBeLessThan(targetHeightFor(1400));
  });
});
