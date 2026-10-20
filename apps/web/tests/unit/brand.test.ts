import { BRAND_COLORS } from "@snapalbum/shared/brand";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function cssToken(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
}

describe("brand.ts reste la source des couleurs", () => {
  it("les jetons CSS reproduisent BRAND_COLORS", () => {
    expect(cssToken("primary")).toBe(BRAND_COLORS.primary);
    expect(cssToken("warm")).toBe(BRAND_COLORS.warm);
    expect(cssToken("foreground")).toBe(BRAND_COLORS.ink);
    expect(cssToken("background")).toBe(BRAND_COLORS.canvas);
  });
});
