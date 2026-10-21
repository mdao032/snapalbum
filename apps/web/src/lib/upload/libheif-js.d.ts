declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  import type { HeifModule } from "./libheif-types";

  /** Builds the decoder; the WebAssembly binary is inside the bundle. */
  const create: () => HeifModule;
  export default create;
}
