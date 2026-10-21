import {
  PrepareError,
  PutError,
  type PreparedMedia,
  type UploadIO,
} from "@snapalbum/shared/upload";
import type { SignedTarget } from "@snapalbum/shared/schemas";
import { resolveExtension, resolveMimeType } from "./files";
import { blurhashOf, encodeThumbnail, thumbnailOf } from "./prepare-image";
import { hashFile, preparePhoto } from "./prepare-client";
import { CanvasUnavailableError } from "./surface";

type PreparedParts = Omit<
  PreparedMedia<Blob>,
  "sha256" | "extension" | "mimeType" | "bytes" | "original"
>;

/** A photo is prepared in the Web Worker (or on the page where there is none). */
async function preparePhotoFile(file: File): Promise<PreparedParts & { sha256: string }> {
  const image = await preparePhoto(file);
  return {
    kind: "photo",
    sha256: image.sha256,
    displayBytes: image.display.size,
    thumbBytes: image.thumb.size,
    previewFormat: image.previewFormat,
    width: image.width,
    height: image.height,
    takenAt: image.takenAt,
    blurhash: image.blurhash,
    display: image.display,
    thumb: image.thumb,
  };
}

/** Loads a video's metadata and one frame (the thumbnail), within a time limit (SPEC 8.2). */
async function prepareVideo(file: File): Promise<PreparedParts> {
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
    const surface = thumbnailOf(video, video.videoWidth, video.videoHeight);
    const thumb = await encodeThumbnail(surface);
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
      blurhash: blurhashOf(surface),
      thumb: thumb.blob,
    };
  } catch (error) {
    if (error instanceof CanvasUnavailableError) throw new PrepareError("unsupported_format");
    throw error;
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

  // A video's hash is computed off the page while its frame is extracted.
  const prepared = isVideo
    ? await Promise.all([prepareVideo(file), hashFile(file)]).then(([video, sha256]) => ({
        ...video,
        sha256,
      }))
    : await preparePhotoFile(file);
  return {
    ...prepared,
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
  previewUrl: (media) => URL.createObjectURL(media.thumb),
};
