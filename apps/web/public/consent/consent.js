// @ts-check
/**
 * The visitor's cookie choice (G-003): kept on their own device, never sent anywhere. Pure
 * functions plus a small storage wrapper that never throws (a private window or blocked storage
 * simply means "no choice yet").
 *
 * This folder is plain JavaScript served as it is, outside the bundler, on purpose: the guest page
 * has a JavaScript budget of 150 KB (NF-002) and any chunk the bundler adds to the pages that share
 * its code weighs on it. The files are checked by TypeScript (`checkJs`) and unit tested.
 */

export const CONSENT_KEY = "snapalbum:consent";

/** The choice is asked again after six months (the CNIL advises renewing it regularly). */
export const CONSENT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 182;

/** Window event sent when the choice changes, so that every reader of it updates. */
export const CONSENT_CHANGED_EVENT = "snapalbum:consent-changed";

/** @typedef {"accepted" | "refused"} ConsentChoice */
/** @typedef {{ choice: ConsentChoice, at: number }} Consent */
/** @typedef {Pick<Storage, "getItem" | "setItem" | "removeItem">} StorageLike */

/**
 * @param {ConsentChoice} choice
 * @param {number} now
 * @returns {string}
 */
export function serializeConsent(choice, now) {
  /** @type {Consent} */
  const consent = { choice, at: now };
  return JSON.stringify(consent);
}

/**
 * A stored value, or null when it is missing, damaged or too old.
 * @param {string | null} raw
 * @param {number} now
 * @returns {Consent | null}
 */
export function parseConsent(raw, now) {
  if (!raw) return null;
  try {
    /** @type {unknown} */
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { choice, at } = /** @type {Record<string, unknown>} */ (value);
    if (choice !== "accepted" && choice !== "refused") return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (at > now + 60_000 || now - at > CONSENT_MAX_AGE_MS) return null;
    return { choice, at };
  } catch {
    return null;
  }
}

/** @returns {StorageLike | null} */
function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {number} [now]
 * @param {StorageLike | null} [storage]
 * @returns {Consent | null}
 */
export function readConsent(now = Date.now(), storage = browserStorage()) {
  try {
    return parseConsent(storage?.getItem(CONSENT_KEY) ?? null, now);
  } catch {
    return null;
  }
}

/**
 * @param {ConsentChoice} choice
 * @param {number} [now]
 * @param {StorageLike | null} [storage]
 * @returns {void}
 */
export function writeConsent(choice, now = Date.now(), storage = browserStorage()) {
  try {
    storage?.setItem(CONSENT_KEY, serializeConsent(choice, now));
  } catch {
    // Storage blocked: the choice only lasts for this page, and nothing is tracked.
  }
}
