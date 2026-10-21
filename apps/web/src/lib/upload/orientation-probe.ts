/**
 * Does this browser turn a photo upright by itself when it decodes it? Browsers differ (and the
 * answer is a decode option on some), so the preparation asks once with a tiny JPEG that is
 * stored sideways with EXIF orientation 6: 2 pixels wide and 1 tall as stored, 1 wide and 2 tall
 * once upright. If the decoded picture is taller than wide, the browser applies the orientation.
 *
 * The probe is a 325-byte JPEG (a red and a blue pixel) with a hand-made EXIF block.
 */
const PROBE_JPEG_BASE64 =
  "/9j/4QAiRXhpZgAASUkqAAgAAAABABIBAwABAAAABgAAAAAAAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABkQAAEFAAAAAAAAAAAAAAAAAAABAgMzcv/EABUBAQEAAAAAAAAAAAAAAAAAAAEG/8QAGhEAAAcAAAAAAAAAAAAAAAAAAAECBDNxsf/aAAwDAQACEQMRAD8ANS2v0pUNYEUWAczLs9H/2Q==";

export interface OrientationBehaviour {
  /** Options to pass to `createImageBitmap` so that it behaves as the probe found. */
  options: ImageBitmapOptions | undefined;
  /** The browser already turns photos upright: the preparation must not turn them again. */
  applied: boolean;
}

let probe: Promise<OrientationBehaviour> | undefined;

function probeBytes(): Uint8Array {
  const binary = atob(PROBE_JPEG_BASE64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function runProbe(): Promise<OrientationBehaviour> {
  const blob = new Blob([probeBytes() as BlobPart], { type: "image/jpeg" });
  // Asking for "from-image" is the modern default; very old browsers refuse the option itself.
  const candidates: (ImageBitmapOptions | undefined)[] = [
    { imageOrientation: "from-image" },
    undefined,
  ];
  for (const options of candidates) {
    try {
      const bitmap = await createImageBitmap(blob, options);
      const applied = bitmap.height > bitmap.width;
      bitmap.close();
      return { options, applied };
    } catch {
      // Try the next way of asking.
    }
  }
  // Cannot decode even this: assume the usual behaviour rather than turn photos twice.
  return { options: undefined, applied: true };
}

/** Asked once per page or worker, then remembered. */
export function orientationBehaviour(): Promise<OrientationBehaviour> {
  probe ??= runProbe();
  return probe;
}
