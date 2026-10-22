// @ts-check
/**
 * Audience measurement with PostHog (SPEC 15), only after consent (G-003). It talks to PostHog's
 * capture endpoint directly: no SDK to download, no cookie, no recording, no automatic capture.
 * The visitor is a random identifier kept in local storage, erased when they refuse or change their mind.
 */

export const ANALYTICS_ID_KEY = "snapalbum:analytics-id";

/** @typedef {Pick<Storage, "getItem" | "setItem" | "removeItem">} StorageLike */
/**
 * @typedef {object} AnalyticsOptions
 * @property {string} key PostHog project key (public by design).
 * @property {string} host Ingestion address of the EU region.
 * @property {string} [platform] What the pages send as `platform` (SPEC 15).
 * @property {StorageLike | null} [storage]
 * @property {(url: string, body: string) => void} [send]
 * @property {() => string} [newId]
 */
/**
 * @typedef {object} Analytics
 * @property {() => void} start Starts measuring: from now on, `track` sends.
 * @property {() => void} stop Stops and forgets the visitor's identifier.
 * @property {() => boolean} isRunning
 * @property {(event: string, properties?: Record<string, string | number | boolean>) => void} track
 */

/**
 * @param {string} url
 * @param {string} body
 */
function defaultSend(url, body) {
  // `keepalive` lets the request finish while the page changes; a failure is of no importance.
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

/**
 * @param {AnalyticsOptions} options
 * @returns {Analytics}
 */
export function createAnalytics(options) {
  const storage = options.storage ?? null;
  const send = options.send ?? defaultSend;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const endpoint = `${options.host.replace(/\/$/, "")}/capture/`;
  let running = false;

  /** @returns {string} */
  function visitorId() {
    try {
      const known = storage?.getItem(ANALYTICS_ID_KEY);
      if (known) return known;
      const id = newId();
      storage?.setItem(ANALYTICS_ID_KEY, id);
      return id;
    } catch {
      return newId();
    }
  }

  return {
    start() {
      running = true;
    },
    stop() {
      running = false;
      try {
        storage?.removeItem(ANALYTICS_ID_KEY);
      } catch {
        // Nothing to erase when storage is blocked.
      }
    },
    isRunning: () => running,
    track(event, properties = {}) {
      if (!running) return;
      send(
        endpoint,
        JSON.stringify({
          api_key: options.key,
          event,
          distinct_id: visitorId(),
          properties: { ...properties, platform: options.platform ?? "web", $lib: "snapalbum-web" },
          timestamp: new Date().toISOString(),
        }),
      );
    },
  };
}

/**
 * The `$pageview` of PostHog for a path of this site (no query string, no address of a person).
 * @param {{ origin: string, pathname: string }} location
 * @returns {Record<string, string>}
 */
export function pageviewProperties(location) {
  return {
    $current_url: `${location.origin}${location.pathname}`,
    $host: new URL(location.origin).host,
    $pathname: location.pathname,
  };
}
