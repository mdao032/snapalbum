import type { PreparedImage } from "./prepare-image";

/** Messages between the page and the preparation Web Worker. */

export type WorkerRequest =
  { id: number; op: "photo"; file: File } | { id: number; op: "hash"; file: Blob };

export type WorkerResponse =
  | { id: number; ok: true; op: "photo"; result: PreparedImage }
  | { id: number; ok: true; op: "hash"; result: string }
  | { id: number; ok: false; reason: "unsupported_format" | "corrupted" }
  /** The worker cannot draw: do it on the page. */
  | { id: number; ok: false; reason: "unavailable" }
  | { id: number; ok: false; reason: "error"; message: string };
