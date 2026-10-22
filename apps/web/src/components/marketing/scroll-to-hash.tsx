"use client";

import { useEffect } from "react";

/**
 * Brings the band named in the address (`/#comment-ca-marche`) into view once the page is ready.
 * The browser's own anchor scroll is lost when the page hydrates on some engines and phones, so
 * a link from another page could land on the top of the home page.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return null;
}
