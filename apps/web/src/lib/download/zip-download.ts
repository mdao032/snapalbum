/**
 * Builds one ZIP of the album in the browser and saves it (F-080). The files are fetched straight
 * from the storage with short-lived addresses asked for group by group, streamed into the ZIP
 * (`client-zip`, no compression: photos and videos are compressed already) and written to disk as
 * they come where the browser allows it (File System Access API: Chrome, Edge). Elsewhere the part
 * is kept in memory and saved at the end, which is why parts stop at 2 GB (F-081).
 * Loaded only when a download starts.
 */

/** Files whose addresses are asked in one go. */
const SIGN_GROUP = 100;
/** Tries per file before the part fails (a network hiccup should not lose a 2 GB part). */
const FETCH_TRIES = 3;

export interface ZipEntry {
  mediaId: string;
  name: string;
  /** Last modification date of the entry: when the photo was taken. */
  at: string;
}

export interface Progress {
  files: number;
  bytes: number;
}

interface SaveFilePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
}

/** Whether this browser can write the ZIP to disk as it is built. */
export function canStreamToDisk(): boolean {
  return typeof (window as unknown as SaveFilePicker).showSaveFilePicker === "function";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, signal: AbortSignal): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < FETCH_TRIES; attempt += 1) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok && response.body) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
    }
    await wait(500 * 2 ** attempt);
  }
  throw last;
}

/** Counts the bytes of a body as they pass, for the progress bar. */
function counted(body: ReadableStream<Uint8Array>, onBytes: (count: number) => void) {
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onBytes(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Saves what is in `blob` under `name` through a temporary link (browsers without streaming). */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Downloads one part of the album as a ZIP named `fileName`. `sign` returns fresh addresses for a
 * group of files. Stops cleanly when `signal` is aborted. Resolves `false` when the person closed
 * the save dialog (nothing was downloaded), `true` when the file was saved.
 */
export async function downloadZipPart(options: {
  entries: readonly ZipEntry[];
  fileName: string;
  sign: (mediaIds: string[]) => Promise<{ mediaId: string; url: string }[]>;
  onProgress: (progress: Progress) => void;
  signal: AbortSignal;
}): Promise<boolean> {
  const { entries, fileName, sign, onProgress, signal } = options;
  const { downloadZip } = await import("client-zip");
  const progress: Progress = { files: 0, bytes: 0 };

  async function* files() {
    for (let start = 0; start < entries.length; start += SIGN_GROUP) {
      const group = entries.slice(start, start + SIGN_GROUP);
      const addresses = new Map(
        (await sign(group.map((entry) => entry.mediaId))).map((file) => [file.mediaId, file.url]),
      );
      for (const entry of group) {
        const url = addresses.get(entry.mediaId);
        // A file that left the album meanwhile (hidden, deleted) is simply not in the ZIP.
        if (!url) continue;
        const response = await fetchWithRetry(url, signal);
        const body = counted(response.body!, (count) => {
          progress.bytes += count;
          onProgress({ ...progress });
        });
        yield { name: entry.name, lastModified: new Date(entry.at), input: new Response(body) };
        progress.files += 1;
        onProgress({ ...progress });
      }
    }
  }

  const zip = downloadZip(files());

  const picker = (window as unknown as SaveFilePicker).showSaveFilePicker;
  if (picker) {
    let writable: WritableStream<Uint8Array>;
    try {
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
      });
      writable = await handle.createWritable();
    } catch (error) {
      // The person closed the dialog: not a failure.
      if ((error as { name?: string }).name === "AbortError") return false;
      throw error;
    }
    await zip.body!.pipeTo(writable, { signal });
    return true;
  }

  saveBlob(await zip.blob(), fileName);
  return true;
}
