import { PrepareError } from "@snapalbum/shared/upload";
import { fingerprint } from "./files";
import { prepareImage, type PreparedImage } from "./prepare-image";
import type { WorkerRequest, WorkerResponse } from "./prepare-protocol";
import { CanvasUnavailableError } from "./surface";

/**
 * Runs the preparation in a Web Worker when the browser has workers and `OffscreenCanvas`, and on
 * the main thread otherwise or when the worker cannot start (SPEC 8.1). Both run the same code.
 */

interface Pending {
  request: WorkerRequest;
  resolve: (value: PreparedImage | string) => void;
  reject: (error: unknown) => void;
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

/** The work itself, on the main thread: the fallback, and the answer to "this worker can't draw". */
async function runHere(request: WorkerRequest): Promise<PreparedImage | string> {
  try {
    return request.op === "hash"
      ? await fingerprint(request.file)
      : await prepareImage(request.file);
  } catch (error) {
    // Not even the page can draw: this device cannot prepare pictures.
    if (error instanceof CanvasUnavailableError) throw new PrepareError("unsupported_format");
    throw error;
  }
}

function settle(response: WorkerResponse) {
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  if (response.ok) return entry.resolve(response.result);
  if (response.reason === "unavailable") {
    runHere(entry.request).then(entry.resolve, entry.reject);
  } else if (response.reason === "error") {
    entry.reject(new Error(response.message));
  } else {
    entry.reject(new PrepareError(response.reason));
  }
}

/** The worker stopped answering (it failed to load or crashed): the page takes over. */
function abandonWorker() {
  worker?.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const entry of waiting) runHere(entry.request).then(entry.resolve, entry.reject);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  try {
    const created = new Worker(new URL("./prepare.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => settle(event.data);
    created.onerror = abandonWorker;
    created.onmessageerror = abandonWorker;
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

function call(request: WorkerRequest): Promise<PreparedImage | string> {
  const active = getWorker();
  if (!active) return runHere(request);
  return new Promise((resolve, reject) => {
    pending.set(request.id, { request, resolve, reject });
    try {
      active.postMessage(request);
    } catch (error) {
      pending.delete(request.id);
      reject(error);
    }
  });
}

export async function preparePhoto(file: File): Promise<PreparedImage> {
  return (await call({ id: (nextId += 1), op: "photo", file })) as PreparedImage;
}

/** SHA-256 of a file (the original of a video), off the main thread where possible. */
export async function hashFile(file: Blob): Promise<string> {
  return (await call({ id: (nextId += 1), op: "hash", file })) as string;
}
