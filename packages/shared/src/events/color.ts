/** WCAG AA minimum contrast for normal text. */
export const MIN_ACCENT_CONTRAST = 4.5;

type Rgb = [number, number, number];

export function parseHexColor(hex: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match?.[1]) throw new Error(`Invalid color: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHexColor([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [
    relativeLuminance(parseHexColor(a)),
    relativeLuminance(parseHexColor(b)),
  ].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** An accent color is usable when white text on it is readable (buttons, badges). */
export function isAccentReadable(hex: string): boolean {
  return contrastRatio(hex, "#ffffff") >= MIN_ACCENT_CONTRAST;
}

/**
 * Darkens an accent color just enough for white text to meet WCAG AA, keeping its hue.
 * Returns the color unchanged when it is already readable.
 */
export function makeAccentReadable(hex: string): string {
  if (isAccentReadable(hex)) return hex.toLowerCase();
  const base = parseHexColor(hex);
  for (let step = 1; step <= 100; step += 1) {
    const factor = 1 - step / 100;
    const candidate = toHexColor(base.map((c) => c * factor) as Rgb);
    if (isAccentReadable(candidate)) return candidate;
  }
  return "#000000";
}
