import { PrepareError } from "@snapalbum/shared/upload";
import { fingerprint } from "./files";
import { prepareImage } from "./prepare-image";
import { CanvasUnavailableError } from "./surface";
import type { WorkerRequest, WorkerResponse } from "./prepare-protocol";

/**
 * The Web Worker of the preparation (SPEC 8.1, step 2): decoding, resizing, EXIF, BlurHash and
 * SHA-256 happen here so a phone's page stays responsive while dozens of photos are prepared.
 */

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.op === "hash") {
      scope.postMessage({
        id: request.id,
        ok: true,
        op: "hash",
        result: await fingerprint(request.file),
      });
      return;
    }
    scope.postMessage({
      id: request.id,
      ok: true,
      op: "photo",
      result: await prepareImage(request.file),
    });
  } catch (error) {
    if (error instanceof PrepareError) {
      scope.postMessage({ id: request.id, ok: false, reason: error.reason });
    } else if (error instanceof CanvasUnavailableError) {
      // This worker cannot draw: the page does the same work itself.
      scope.postMessage({ id: request.id, ok: false, reason: "unavailable" });
    } else {
      scope.postMessage({
        id: request.id,
        ok: false,
        reason: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
