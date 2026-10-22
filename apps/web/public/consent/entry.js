// @ts-check
import { mountConsent } from "./banner.js";

/** Starts the banner with the configuration the server wrote in the page (`#consent-config`). */
const holder = document.getElementById("consent-config");
if (holder?.textContent) {
  try {
    mountConsent({ config: JSON.parse(holder.textContent) });
  } catch {
    // A damaged configuration means no banner and no measurement: nothing is tracked.
  }
}
