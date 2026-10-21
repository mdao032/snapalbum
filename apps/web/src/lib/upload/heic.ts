import type { HeifModule } from "./libheif-types";

/**
 * HEIC decoding for the browsers that cannot read it themselves (everything but Safari). It runs
 * libheif compiled to WebAssembly (`libheif-js`, LGPL-3.0, about 1.9 MB), which is loaded here and
 * nowhere else: a guest whose browser reads HEIC natively, and every other format, never download
 * it (SPEC 8.1, `decisions.md`).
 */

export interface DecodedHeic {
  width: number;
  height: number;
  /** RGBA, row after row; the rotation and mirroring stored in the file are already applied. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** The file is not a HEIC picture this decoder can read (as opposed to the decoder not loading). */
export class HeicDecodeError extends Error {
  constructor() {
    super("HEIC decoding failed");
    this.name = "HeicDecodeError";
  }
}

let loaded: Promise<HeifModule> | undefined;

function loadModule(): Promise<HeifModule> {
  // A failed load (connection lost) is not kept: the next file tries again.
  loaded ??= import("libheif-js/libheif-wasm/libheif-bundle.mjs")
    .then(({ default: create }) => create())
    .catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
  return loaded;
}

export async function decodeHeic(file: Blob): Promise<DecodedHeic> {
  const heif = await loadModule();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let image;
  try {
    const images = new heif.HeifDecoder().decode(bytes);
    image = images[0];
  } catch {
    throw new HeicDecodeError();
  }
  if (!image) throw new HeicDecodeError();

  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new HeicDecodeError();
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const decoded = await new Promise<typeof target | null>((resolve) => {
    image.display(target, (result) => resolve(result));
  });
  if (!decoded) throw new HeicDecodeError();
  return { width, height, data: decoded.data };
}
