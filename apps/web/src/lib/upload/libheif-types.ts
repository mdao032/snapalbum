/**
 * The small part of `libheif-js` the preparation uses. The package ships its types for the whole
 * of libheif; only these calls are relied on.
 */

export interface HeifPixelBuffer {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: HeifPixelBuffer, done: (result: HeifPixelBuffer | null) => void): void;
}

export interface HeifModule {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
}
