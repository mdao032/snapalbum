// @ts-check
/**
 * The cookie banner and the audience measurement it controls (G-003). Nothing is loaded, stored or
 * sent before an acceptance; refusing is as simple as accepting (two identical buttons) and changes
 * nothing else on the site; the choice can be changed from the footer. Not present on the pages a
 * guest sees: they have no tracker (and no weight to spare, NF-002).
 */
import { createAnalytics, pageviewProperties } from "./analytics.js";
import { CONSENT_CHANGED_EVENT, CONSENT_KEY, readConsent, writeConsent } from "./consent.js";

/**
 * @typedef {object} ConsentConfig
 * @property {string} key PostHog project key.
 * @property {string} host PostHog ingestion address.
 * @property {string} cookiesHref Address of the cookie policy, in the page's language.
 * @property {{ title: string, text: string, more: string, refuse: string, accept: string }} texts
 */

const BUTTON =
  "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-surface px-6 text-base font-medium text-foreground outline-none ring-1 ring-border transition-all duration-200 hover:bg-muted focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.98]";

const BANNER =
  "fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl flex-col gap-4 rounded-2xl bg-surface p-5 shadow-float ring-1 ring-border sm:inset-x-6 sm:bottom-6";

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Puts the banner on the page and starts the measurement if the visitor accepted.
 * @param {{
 *   config: ConsentConfig,
 *   doc?: Document,
 *   win?: Window,
 *   storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
 * }} options
 * @returns {{ destroy: () => void }}
 */
export function mountConsent({ config, doc = document, win = window, storage = win.localStorage }) {
  const analytics = createAnalytics({ key: config.key, host: config.host, storage });
  /** @type {HTMLElement | null} */
  let banner = null;
  let reopened = false;
  /** With blocked storage the choice cannot be written: it still holds for this page. */
  /** @type {"accepted" | "refused" | null} */
  let session = null;
  let lastPath = "";

  const choice = () => session ?? readConsent(Date.now(), storage)?.choice ?? null;

  function trackPageview() {
    const path = win.location.pathname;
    if (!analytics.isRunning() || path === lastPath) return;
    lastPath = path;
    analytics.track("$pageview", pageviewProperties(win.location));
  }

  /** Measures only while the visitor has accepted. */
  function syncMeasurement() {
    if (choice() === "accepted") {
      analytics.start();
      trackPageview();
    } else {
      analytics.stop();
      lastPath = "";
    }
  }

  function closeBanner() {
    banner?.remove();
    banner = null;
  }

  /** @param {"accepted" | "refused"} next */
  function decide(next) {
    writeConsent(next, Date.now(), storage);
    session = next;
    syncMeasurement();
    win.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: next }));
    closeBanner();
    if (reopened) {
      reopened = false;
      /** @type {HTMLElement | null} */ (doc.querySelector("[data-manage-cookies]"))?.focus();
    }
  }

  function openBanner() {
    if (banner) return;
    const { texts } = config;
    banner = element(doc, "section", BANNER);
    banner.setAttribute("aria-labelledby", "consent-title");
    banner.dataset.testid = "consent-banner";

    const copy = element(doc, "div", "flex flex-col gap-1.5");
    const title = element(doc, "h2", "font-semibold outline-none", texts.title);
    title.id = "consent-title";
    title.tabIndex = -1;
    const text = element(doc, "p", "text-sm text-muted-foreground", `${texts.text} `);
    const more = element(doc, "a", "underline hover:text-foreground", texts.more);
    more.setAttribute("href", config.cookiesHref);
    text.append(more);
    copy.append(title, text);

    const buttons = element(doc, "div", "flex flex-col gap-2 sm:flex-row");
    for (const [label, next] of /** @type {const} */ ([
      [texts.refuse, "refused"],
      [texts.accept, "accepted"],
    ])) {
      const button = element(doc, "button", BUTTON, label);
      button.setAttribute("type", "button");
      button.addEventListener("click", () => decide(next));
      buttons.append(button);
    }

    banner.append(copy, buttons);
    doc.body.append(banner);
    if (reopened) /** @type {HTMLElement} */ (title).focus();
  }

  /** @param {Event} event */
  function onClick(event) {
    if (event.target instanceof Element && event.target.closest("[data-manage-cookies]")) {
      reopened = true;
      openBanner();
      doc.getElementById("consent-title")?.focus();
    }
  }

  /** Another tab changed the choice. @param {StorageEvent} event */
  function onStorage(event) {
    if (event.key !== CONSENT_KEY) return;
    session = null;
    syncMeasurement();
    if (choice() === null) openBanner();
    else if (!reopened) closeBanner();
  }

  // One page view per page of the site: the router changes the address with the history API.
  const history = win.history;
  const { pushState, replaceState } = history;
  /** @param {typeof history.pushState} original */
  const wrap = (original) =>
    /** @type {typeof history.pushState} */ (
      function (...args) {
        const result = original.apply(history, args);
        win.setTimeout(trackPageview, 0);
        return result;
      }
    );
  history.pushState = wrap(pushState);
  history.replaceState = wrap(replaceState);
  const onPop = () => win.setTimeout(trackPageview, 0);

  doc.addEventListener("click", onClick);
  win.addEventListener("storage", onStorage);
  win.addEventListener("popstate", onPop);

  syncMeasurement();
  if (choice() === null) openBanner();

  return {
    destroy() {
      doc.removeEventListener("click", onClick);
      win.removeEventListener("storage", onStorage);
      win.removeEventListener("popstate", onPop);
      history.pushState = pushState;
      history.replaceState = replaceState;
      closeBanner();
    },
  };
}
