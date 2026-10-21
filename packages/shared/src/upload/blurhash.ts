/**
 * BlurHash encoder (https://blurha.sh): a ~30 character placeholder for a photo, shown while the
 * thumbnail loads. The browser computes it during preparation (SPEC 8.1) and the server stores
 * it with the media; the gallery (phase 3) and the apps decode it.
 *
 * Written here rather than imported: it is fifty lines, runs unchanged in the Web Worker, the
 * apps and the tests, and avoids a dependency. Output is that of the reference encoders (checked
 * in `blurhash.test.ts`).
 */

const BASE83 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/** Every character a BlurHash can contain, to validate one received from a client. */
export const BLURHASH_PATTERN = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,100}$/;

/** Number of colour components along each axis (the default of the reference encoder). */
export const BLURHASH_COMPONENTS = { x: 4, y: 3 } as const;

/** The placeholder is computed from a picture at most this many pixels on its longest side. */
export const BLURHASH_SAMPLE_PX = 32;

function encode83(value: number, length: number): string {
  let result = "";
  for (let i = 1; i <= length; i += 1) {
    const digit = Math.floor(value / 83 ** (length - i)) % 83;
    result += BASE83.charAt(digit);
  }
  return result;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308
    ? Math.trunc(v * 12.92 * 255 + 0.5)
    : Math.trunc((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5);
}

function signPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

type Factor = [number, number, number];

function basisFactor(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  xComponent: number,
  yComponent: number,
): Factor {
  let r = 0;
  let g = 0;
  let b = 0;
  const normalisation = xComponent === 0 && yComponent === 0 ? 1 : 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const basis =
        Math.cos((Math.PI * xComponent * x) / width) *
        Math.cos((Math.PI * yComponent * y) / height);
      const offset = 4 * (x + y * width);
      r += basis * srgbToLinear(pixels[offset] ?? 0);
      g += basis * srgbToLinear(pixels[offset + 1] ?? 0);
      b += basis * srgbToLinear(pixels[offset + 2] ?? 0);
    }
  }
  const scale = normalisation / (width * height);
  return [r * scale, g * scale, b * scale];
}

function encodeDc([r, g, b]: Factor): number {
  return (linearToSrgb(r) << 16) + (linearToSrgb(g) << 8) + linearToSrgb(b);
}

function encodeAc([r, g, b]: Factor, maximum: number): number {
  const quantise = (value: number) =>
    Math.trunc(Math.max(0, Math.min(18, Math.floor(signPow(value / maximum, 0.5) * 9 + 9.5))));
  return quantise(r) * 19 * 19 + quantise(g) * 19 + quantise(b);
}

/**
 * The BlurHash of RGBA pixels (4 bytes per pixel, row after row). Pass a small picture
 * (`BLURHASH_SAMPLE_PX`): the cost grows with the number of pixels times the components.
 */
export function encodeBlurhash(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  componentX: number = BLURHASH_COMPONENTS.x,
  componentY: number = BLURHASH_COMPONENTS.y,
): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("BlurHash needs a picture of at least one pixel");
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError("BlurHash pixels do not match the width and height");
  }
  if (componentX < 1 || componentX > 9 || componentY < 1 || componentY > 9) {
    throw new RangeError("BlurHash components must be between 1 and 9");
  }

  const factors: Factor[] = [];
  for (let y = 0; y < componentY; y += 1) {
    for (let x = 0; x < componentX; x += 1) {
      factors.push(basisFactor(pixels, width, height, x, y));
    }
  }
  const [dc, ...ac] = factors as [Factor, ...Factor[]];

  let hash = encode83(componentX - 1 + (componentY - 1) * 9, 1);
  let maximum = 1;
  if (ac.length > 0) {
    const actualMaximum = Math.max(...ac.map((factor) => Math.max(...factor.map(Math.abs))));
    const quantised = Math.max(0, Math.min(82, Math.floor(actualMaximum * 166 - 0.5)));
    maximum = (quantised + 1) / 166;
    hash += encode83(quantised, 1);
  } else {
    hash += encode83(0, 1);
  }
  hash += encode83(encodeDc(dc), 4);
  for (const factor of ac) hash += encode83(encodeAc(factor, maximum), 2);
  return hash;
}

/** The sample size for a picture: at most `BLURHASH_SAMPLE_PX` on the longest side. */
export function blurhashSampleSize(width: number, height: number) {
  const scale = Math.min(1, BLURHASH_SAMPLE_PX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
