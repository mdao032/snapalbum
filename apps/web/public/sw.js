// Service worker of the guest page, for one job: Background Sync. When the connection comes back
// (Chrome on Android, even with the tab frozen), the browser fires `sync` and this worker wakes
// the open page, which resumes its uploads. It never uploads anything itself and never touches
// the network or the cache. iOS has no Background Sync: nothing is promised there.

const SYNC_TAG = "snapalbum-upload";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "snapalbum:retry" });
    }),
  );
});
