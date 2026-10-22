// @ts-check
import { mountConsent } from "./banner.js";

/**
 * Starts the cookie banner (G-003): the texts come from the page (`#consent-config`), the tracker's
 * key from `/api/analytics-config`. With no tracker set up there is no banner and no "Manage
 * cookies" link; with a damaged answer, nothing is tracked.
 * @param {{ doc?: Document, win?: Window, fetcher?: typeof fetch }} [options]
 * @returns {Promise<{ destroy: () => void } | null>}
 */
export async function boot({ doc = document, win = window, fetcher = fetch } = {}) {
  const holder = doc.getElementById("consent-config");
  if (!holder?.textContent) return null;
  try {
    const page = JSON.parse(holder.textContent);
    const response = await fetcher("/api/analytics-config", { credentials: "omit" });
    if (response.status !== 200) return null;
    const tracker = await response.json();
    if (typeof tracker?.key !== "string" || typeof tracker?.host !== "string") return null;
    for (const button of doc.querySelectorAll("[data-manage-cookies]")) {
      button.removeAttribute("hidden");
    }
    return mountConsent({ config: { ...page, key: tracker.key, host: tracker.host }, doc, win });
  } catch {
    return null;
  }
}

void boot();
