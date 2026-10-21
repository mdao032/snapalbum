import {
  PrepareError,
  PutError,
  type PreparedMedia,
  type UploadIO,
} from "@snapalbum/shared/upload";
import type { SignedTarget } from "@snapalbum/shared/schemas";
import { fingerprint, resolveExtension, resolveMimeType, scaledSize } from "./files";

/** Longest side of the display version and of the thumbnail (SPEC 8.1). */
export const DISPLAY_MAX_PX = 2048;
export const THUMB_MAX_PX = 400;
const DISPLAY_QUALITY = 0.82;
const THUMB_QUALITY = 0.7;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * An image or a video frame as a WebP of at most `maxPx`, or a JPEG where the browser cannot
 * encode WebP. Re-encoding through a canvas drops every metadata block, GPS included (S-008).
 */
async function encodePreview(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxPx: number,
  quality: number,
): Promise<{ blob: Blob; format: "webp" | "jpeg"; width: number; height: number }> {
  const size = scaledSize(width, height, maxPx);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new PrepareError("unsupported_format");
  context.drawImage(source, 0, 0, size.width, size.height);

  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return { blob: webp, format: "webp", ...size };
  const jpeg = await canvasToBlob(canvas, "image/jpeg", Math.min(0.9, quality + 0.05));
  if (!jpeg) throw new PrepareError("corrupted");
  return { blob: jpeg, format: "jpeg", ...size };
}

async function preparePhoto(
  file: File,
  mimeType: string,
): Promise<Omit<PreparedMedia<Blob>, "sha256" | "extension" | "mimeType" | "bytes" | "original">> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // HEIC outside Safari cannot be read: the guest is told to pick another format.
    throw new PrepareError(/hei[cf]/.test(mimeType) ? "unsupported_format" : "corrupted");
  }
  try {
    const display = await encodePreview(
      bitmap,
      bitmap.width,
      bitmap.height,
      DISPLAY_MAX_PX,
      DISPLAY_QUALITY,
    );
    const thumb = await encodePreview(
      bitmap,
      bitmap.width,
      bitmap.height,
      THUMB_MAX_PX,
      THUMB_QUALITY,
    );
    return {
      kind: "photo",
      displayBytes: display.blob.size,
      thumbBytes: thumb.blob.size,
      previewFormat: display.format === "jpeg" || thumb.format === "jpeg" ? "jpeg" : "webp",
      width: bitmap.width,
      height: bitmap.height,
      takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      display: display.blob,
      thumb: thumb.blob,
    };
  } finally {
    bitmap.close();
  }
}

/** Loads a video's metadata and one frame (the thumbnail), within a time limit. */
async function prepareVideo(
  file: File,
): Promise<Omit<PreparedMedia<Blob>, "sha256" | "extension" | "mimeType" | "bytes" | "original">> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PrepareError("unsupported_format")), 15_000);
      video.onloadedmetadata = () => {
        // A moment into the clip rather than the (often black) first frame.
        video.currentTime = Math.min(1, (Number.isFinite(video.duration) ? video.duration : 0) / 2);
      };
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new PrepareError("unsupported_format"));
      };
      video.src = url;
    });
    if (!video.videoWidth || !video.videoHeight) throw new PrepareError("corrupted");
    const thumb = await encodePreview(
      video,
      video.videoWidth,
      video.videoHeight,
      THUMB_MAX_PX,
      THUMB_QUALITY,
    );
    return {
      kind: "video",
      thumbBytes: thumb.blob.size,
      previewFormat: thumb.format,
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Number.isFinite(video.duration)
        ? Math.round(video.duration * 10) / 10
        : undefined,
      takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      thumb: thumb.blob,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** Preparation of one file in the browser (SPEC 8.1, step 2). */
export async function prepareFile(file: File): Promise<PreparedMedia<Blob>> {
  const mimeType = resolveMimeType(file);
  const extension = resolveExtension(file);
  const isVideo = mimeType.startsWith("video/");
  if (!isVideo && !mimeType.startsWith("image/")) throw new PrepareError("unsupported_format");

  const prepared = isVideo ? await prepareVideo(file) : await preparePhoto(file, mimeType);
  return {
    ...prepared,
    sha256: await fingerprint(file),
    mimeType,
    extension,
    bytes: file.size,
    original: file,
  } as PreparedMedia<Blob>;
}

/** PUT with progress: `fetch` cannot report how much of a request body has gone out. */
export function putWithProgress(
  target: SignedTarget,
  body: Blob,
  onProgress: (sentBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      // The browser sets the length itself from the body, which is what was signed.
      if (name.toLowerCase() !== "content-length") request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new PutError(request.status));
    request.onerror = () => reject(new TypeError("Network error while uploading"));
    request.ontimeout = () => reject(new TypeError("Upload timed out"));
    request.timeout = 10 * 60_000;
    request.send(body);
  });
}

export const browserUploadIO: UploadIO<File, Blob> = {
  prepare: prepareFile,
  put: putWithProgress,
  slice: (body, start, end) => body.slice(start, end),
};
