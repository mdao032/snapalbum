import { describe, expect, it } from "vitest";
import { neighbourhood, urlsAreStale, URL_REFRESH_MARGIN_SECONDS } from "./urls";

describe("SPEC 9.1: renouvellement des adresses signées", () => {
  it("SPEC 9.1: des adresses toutes neuves ne sont pas à renouveler", () => {
    expect(urlsAreStale(1_000_000, 3600, 1_000_000)).toBe(false);
  });

  it("SPEC 9.1: elles sont renouvelées avant leur expiration, avec une marge", () => {
    const issued = 1_000_000;
    const limit = issued + (3600 - URL_REFRESH_MARGIN_SECONDS) * 1000;
    expect(urlsAreStale(issued, 3600, limit - 1)).toBe(false);
    expect(urlsAreStale(issued, 3600, limit)).toBe(true);
    expect(limit).toBeLessThan(issued + 3600 * 1000);
  });

  it("F-051: le voisinage d'une photo : elle d'abord, puis les suivantes et les précédentes", () => {
    expect(neighbourhood(5, 10, 2)).toEqual([5, 6, 4, 7, 3]);
    expect(neighbourhood(0, 10, 2)).toEqual([0, 1, 2]);
    expect(neighbourhood(9, 10, 1)).toEqual([9, 8]);
    expect(neighbourhood(3, 0, 2)).toEqual([]);
    expect(neighbourhood(12, 10, 2)).toEqual([]);
  });
});
