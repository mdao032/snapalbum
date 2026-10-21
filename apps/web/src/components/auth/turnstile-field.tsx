"use client";

import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")),
    );
    script.addEventListener("error", () => reject(new Error("Turnstile blocked")));
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Invisible Cloudflare Turnstile check (S-012). It adds a hidden `cf-turnstile-response` field to
 * the form it sits in. If the script cannot load (ad blocker, offline), the form is still sent and
 * the server decides: the person sees "reload the page" instead of a button that never works.
 * `resetKey` changes after each submission, because a token can be used only once.
 */
export function TurnstileField({
  siteKey,
  resetKey,
  onReadyChange,
}: {
  siteKey: string;
  resetKey: unknown;
  onReadyChange: (ready: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    onReadyChange(false);
    loadScript()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: () => onReadyChange(true),
          "error-callback": () => onReadyChange(true),
          "expired-callback": () => onReadyChange(false),
        });
      })
      .catch(() => onReadyChange(true));

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, resetKey, onReadyChange]);

  // The widget adds its own hidden `cf-turnstile-response` field to the form.
  return <div ref={container} />;
}
