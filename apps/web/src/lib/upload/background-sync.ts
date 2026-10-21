/**
 * Background Sync where the browser has it (Chrome on Android): asks to be woken when the
 * connection returns so the page resumes its uploads even if the tab was frozen. It is a
 * convenience on top of the `online` and `visibilitychange` resumes, never a promise: iOS has no
 * Background Sync, and a page that was closed does not upload (only the apps will, phase 7).
 */

export const SYNC_TAG = "snapalbum-upload";
const RETRY_MESSAGE = "snapalbum:retry";

interface SyncRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> };
}

export interface BackgroundSync {
  /** Whether this browser can wake the page at all. */
  supported: boolean;
  /** Asks for a wake-up when the connection returns. */
  request(): void;
}

const NONE: BackgroundSync = { supported: false, request: () => undefined };

/** `onWake` is called when the browser wakes the page: resume the uploads. */
export function startBackgroundSync(onWake: () => void): BackgroundSync {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return NONE;
  if (typeof window === "undefined" || !("SyncManager" in window)) return NONE;

  const registration = navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready as Promise<SyncRegistration>);
  // A refused registration (private mode, blocked) just leaves the other resumes in charge.
  registration.catch(() => undefined);

  navigator.serviceWorker.addEventListener("message", (event) => {
    if ((event.data as { type?: string } | null)?.type === RETRY_MESSAGE) onWake();
  });

  return {
    supported: true,
    request() {
      registration.then((ready) => ready.sync?.register(SYNC_TAG)).catch(() => undefined);
    },
  };
}
