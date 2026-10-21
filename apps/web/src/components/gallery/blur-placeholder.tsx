"use client";

import { decodeBlurhash } from "@snapalbum/shared/upload";
import { useEffect, useRef } from "react";

/** The blurred picture is drawn this small and stretched by the browser: that is the blur. */
const WIDTH = 32;
const HEIGHT = 24;

/**
 * The BlurHash of a photo drawn in the space of its thumbnail, shown until the thumbnail arrives
 * (F-053). A malformed hash simply leaves the tile in its neutral color.
 */
export function BlurPlaceholder({ hash }: { hash: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !hash) return;
    try {
      const context = element.getContext("2d");
      if (!context) return;
      const pixels = decodeBlurhash(hash, WIDTH, HEIGHT);
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT), 0, 0);
    } catch {
      // Not a valid hash: nothing to draw.
    }
  }, [hash]);

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden
      className="absolute inset-0 size-full"
    />
  );
}
